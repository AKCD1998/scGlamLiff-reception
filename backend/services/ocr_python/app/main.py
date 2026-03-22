import logging
from uuid import uuid4

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import JSONResponse

from .logging_utils import log_exception, log_info
from .services.paddle_ocr_service import extract_receipt_text, initialize_ocr_engine
from .services.preprocess_service import preprocess_receipt_image
from .services.receipt_parser import parse_receipt_text

logger = logging.getLogger("ocr_python.main")

app = FastAPI(
    title="scGlam Receipt OCR Service",
    description="Receipt OCR service using OpenCV preprocessing + PaddleOCR.",
    version="0.1.0",
)


@app.on_event("startup")
async def startup_event():
    log_info(logger, "ocr_app_startup", stage="engine_init")
    try:
        initialize_ocr_engine(source="startup")
    except Exception:
        log_exception(logger, "ocr_app_startup_engine_init_failed")


@app.middleware("http")
async def log_unhandled_exceptions(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:
        log_exception(
            logger,
            "ocr_http_unhandled_exception",
            method=request.method,
            path=request.url.path,
            query=str(request.url.query or ""),
        )
        raise


@app.get("/health")
async def health_check():
    return {"ok": True, "service": "ocr-python", "mode": "python-paddleocr"}


def _build_error_response(code: str, message: str, *, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "code": code,
            "message": message,
            "errorCode": code,
            "errorMessage": message,
            "ocrStatus": "error",
            "mode": "python-paddleocr",
            "rawText": "",
            "ocrText": "",
            "parsed": {
                "receiptLine": "",
                "receiptLines": [],
                "totalAmount": "",
                "totalAmountValue": None,
                "receiptDate": "",
                "receiptTime": "",
                "merchant": "",
                "merchantName": "",
            },
            "receiptLine": "",
            "receiptLines": [],
            "totalAmount": "",
            "totalAmountTHB": None,
            "receiptDate": "",
            "receiptTime": "",
            "merchant": "",
            "merchantName": "",
            "ocrMetadata": {},
            "error": {
                "code": code,
                "message": message,
            },
        },
    )


@app.post("/ocr/receipt")
async def ocr_receipt(receipt: UploadFile = File(...)):
    request_id = uuid4().hex[:12]
    filename = receipt.filename or ""
    content_type = receipt.content_type or ""

    log_info(
        logger,
        "ocr_request_received",
        requestId=request_id,
        filename=filename,
        contentType=content_type,
    )

    if not receipt.content_type or not receipt.content_type.startswith("image/"):
        return _build_error_response(
            "OCR_INVALID_FILE_TYPE",
            "receipt must be an image file",
            status_code=400,
        )

    try:
        try:
            image_bytes = await receipt.read()
        except Exception:
            log_exception(
                logger,
                "ocr_file_read_failed",
                requestId=request_id,
                filename=filename,
                contentType=content_type,
            )
            raise

        log_info(
            logger,
            "ocr_file_bytes_read",
            requestId=request_id,
            filename=filename,
            contentType=content_type,
            fileSizeBytes=len(image_bytes),
        )

        if not image_bytes:
            return _build_error_response(
                "OCR_EMPTY_FILE",
                "receipt image is empty",
                status_code=400,
            )

        try:
            preprocessed_image = preprocess_receipt_image(
                image_bytes,
                filename=filename,
                content_type=content_type,
                request_id=request_id,
            )
        except Exception:
            log_exception(
                logger,
                "ocr_preprocess_failed",
                requestId=request_id,
                filename=filename,
                contentType=content_type,
                fileSizeBytes=len(image_bytes),
            )
            raise

        try:
            ocr_result = extract_receipt_text(
                preprocessed_image,
                filename=filename,
                content_type=content_type,
                request_id=request_id,
            )
        except Exception:
            log_exception(
                logger,
                "ocr_inference_failed",
                requestId=request_id,
                filename=filename,
                contentType=content_type,
                fileSizeBytes=len(image_bytes),
            )
            raise

        try:
            raw_text = ocr_result.get("rawText", "")
            parsed = parse_receipt_text(
                raw_text,
                ocr_lines=ocr_result.get("lines"),
                request_id=request_id,
            )
            ocr_status = "success" if parsed.get("receiptLine") and parsed.get("totalAmount") else "partial"
        except Exception:
            log_exception(
                logger,
                "ocr_parse_failed",
                requestId=request_id,
                filename=filename,
                contentType=content_type,
                fileSizeBytes=len(image_bytes),
            )
            raise

        log_info(
            logger,
            "ocr_request_completed",
            requestId=request_id,
            filename=filename,
            contentType=content_type,
            fileSizeBytes=len(image_bytes),
            ocrStatus=ocr_status,
            receiptLineFound=bool(parsed.get("receiptLine")),
            totalAmountFound=bool(parsed.get("totalAmount")),
        )

        return {
            "success": True,
            "code": "OCR_OK",
            "message": "Receipt OCR completed",
            "errorCode": "",
            "errorMessage": "",
            "ocrStatus": ocr_status,
            "mode": ocr_result.get("mode", "python-paddleocr"),
            "rawText": raw_text,
            "ocrText": raw_text,
            "parsed": parsed,
            "receiptLine": parsed.get("receiptLine", ""),
            "receiptLines": parsed.get("receiptLines", []),
            "totalAmount": parsed.get("totalAmount", ""),
            "totalAmountTHB": parsed.get("totalAmountValue"),
            "receiptDate": parsed.get("receiptDate", ""),
            "receiptTime": parsed.get("receiptTime", ""),
            "merchant": parsed.get("merchant", ""),
            "merchantName": parsed.get("merchantName", ""),
            "ocrMetadata": ocr_result.get("meta", {}),
        }
    except ValueError as error:
        return _build_error_response(
            "OCR_BAD_REQUEST",
            str(error),
            status_code=400,
        )
    except Exception as error:  # pragma: no cover - depends on OCR runtime
        return _build_error_response(
            "OCR_PROCESSING_FAILED",
            str(error),
            status_code=500,
        )
