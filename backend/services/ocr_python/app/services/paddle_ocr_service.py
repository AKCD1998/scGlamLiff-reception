from __future__ import annotations

import json
import logging
import os
import re
from functools import lru_cache
from statistics import mean

from ..logging_utils import log_exception, log_info
from .receipt_parser import parse_receipt_text

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

logger = logging.getLogger("ocr_python.paddle")

try:
    from paddleocr import PaddleOCR
except ImportError:  # pragma: no cover - handled at runtime when deps are missing
    PaddleOCR = None


def _normalize_line(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _payload_values(payload: dict, key: str) -> list:
    values = payload.get(key)
    if values is None:
        return []

    if isinstance(values, list):
        return values

    try:
        return list(values)
    except TypeError:
        return []


def _parse_result_payload(item) -> dict:
    if isinstance(item, dict):
        payload = item
    elif hasattr(item, "json"):
        payload = item.json
        if callable(payload):
            payload = payload()
        if isinstance(payload, str):
            payload = json.loads(payload)
    elif hasattr(item, "res"):
        payload = {"res": item.res}
    else:
        payload = {}

    if not isinstance(payload, dict):
        return {}

    result_payload = payload.get("res")
    if isinstance(result_payload, dict):
        return result_payload

    return payload


def _normalize_bbox(payload: dict, index: int) -> tuple[float, float, float, float]:
    rec_boxes = _payload_values(payload, "rec_boxes")
    rec_polys = _payload_values(payload, "rec_polys")

    if index < len(rec_boxes):
        box = rec_boxes[index]
        if isinstance(box, (list, tuple)) and len(box) == 4:
            return float(box[0]), float(box[1]), float(box[2]), float(box[3])

    if index < len(rec_polys):
        poly = rec_polys[index]
        if isinstance(poly, (list, tuple)) and poly:
            xs = [float(point[0]) for point in poly]
            ys = [float(point[1]) for point in poly]
            return min(xs), min(ys), max(xs), max(ys)

    return 0.0, 0.0, 0.0, 0.0


def _extract_lines_and_scores(prediction_result) -> tuple[list[dict], list[float]]:
    lines: list[dict] = []
    scores: list[float] = []

    for item in prediction_result:
        payload = _parse_result_payload(item)
        texts = payload.get("rec_texts") or []
        text_scores = payload.get("rec_scores") or []

        for index, text in enumerate(texts):
            normalized_text = _normalize_line(text)
            if normalized_text:
                x1, y1, x2, y2 = _normalize_bbox(payload, index)
                lines.append(
                    {
                        "text": normalized_text,
                        "score": float(text_scores[index]) if index < len(text_scores) else 0.0,
                        "x1": x1,
                        "y1": y1,
                        "x2": x2,
                        "y2": y2,
                        "xCenter": (x1 + x2) / 2,
                        "yCenter": (y1 + y2) / 2,
                    }
                )

            if index < len(text_scores):
                try:
                    scores.append(float(text_scores[index]))
                except (TypeError, ValueError):
                    pass

    unique_lines: list[dict] = []
    seen_lines: set[tuple] = set()
    for line in lines:
        dedupe_key = (
            line["text"],
            round(line["x1"], 1),
            round(line["y1"], 1),
            round(line["x2"], 1),
            round(line["y2"], 1),
        )
        if dedupe_key not in seen_lines:
            unique_lines.append(line)
            seen_lines.add(dedupe_key)

    return unique_lines, scores


@lru_cache(maxsize=1)
def _get_ocr_engine():
    if PaddleOCR is None:
        raise RuntimeError("paddleocr dependencies are not installed")

    # PP-OCRv4 mobile English models are used as the first-pass baseline here
    # because they worked reliably on Windows CPU during local validation.
    # TODO: revisit the model choice after collecting more real receipt samples.
    return PaddleOCR(
        lang="en",
        ocr_version="PP-OCRv4",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        enable_mkldnn=False,
    )


def initialize_ocr_engine(*, source: str = "startup") -> None:
    log_info(logger, "ocr_engine_init_started", source=source)
    try:
        _get_ocr_engine()
    except Exception:
        log_exception(logger, "ocr_engine_init_failed", source=source)
        raise

    log_info(logger, "ocr_engine_init_finished", source=source)


def _predict_variant_with_ocr(
    ocr_engine,
    variant_image,
    *,
    request_id: str = "",
    filename: str = "",
    content_type: str = "",
    variant_name: str = "",
):
    log_info(
        logger,
        "ocr_variant_predict_started",
        requestId=request_id,
        filename=filename,
        contentType=content_type,
        variant=variant_name,
    )

    try:
        prediction_result = ocr_engine.predict(variant_image)
    except Exception:
        log_exception(
            logger,
            "ocr_variant_predict_failed",
            requestId=request_id,
            filename=filename,
            contentType=content_type,
            variant=variant_name,
        )
        raise

    log_info(
        logger,
        "ocr_variant_predict_finished",
        requestId=request_id,
        filename=filename,
        contentType=content_type,
        variant=variant_name,
    )

    return prediction_result


def _build_candidate_from_prediction(
    prediction_result,
    *,
    preprocessed_image: dict,
    request_id: str = "",
    filename: str = "",
    content_type: str = "",
    variant_name: str = "",
) -> dict:
    log_info(
        logger,
        "ocr_variant_postprocess_started",
        requestId=request_id,
        filename=filename,
        contentType=content_type,
        variant=variant_name,
    )

    try:
        lines, scores = _extract_lines_and_scores(prediction_result)
        raw_text = "\n".join(line["text"] for line in lines)
        average_score = mean(scores) if scores else 0.0
        parsed = parse_receipt_text(
            raw_text,
            ocr_lines=lines,
            request_id=request_id,
            log_stage=False,
        )
        score = _score_candidate(parsed, len(lines), average_score)

        if preprocessed_image.get("cropFound") and variant_name.startswith("cropped"):
            score += 1.5

        if parsed.get("receiptLine"):
            score += 4

        if parsed.get("totalAmount"):
            score += 4

        candidate = {
            "variant": variant_name,
            "rawText": raw_text,
            "lines": lines,
            "parsed": parsed,
            "lineCount": len(lines),
            "averageScore": average_score,
            "score": score,
        }
    except Exception:
        log_exception(
            logger,
            "ocr_variant_postprocess_failed",
            requestId=request_id,
            filename=filename,
            contentType=content_type,
            variant=variant_name,
        )
        raise

    log_info(
        logger,
        "ocr_variant_postprocess_finished",
        requestId=request_id,
        filename=filename,
        contentType=content_type,
        variant=variant_name,
        lineCount=candidate["lineCount"],
        averageScore=round(candidate["averageScore"], 4),
        receiptLineFound=bool(candidate["parsed"].get("receiptLine")),
        totalAmountFound=bool(candidate["parsed"].get("totalAmount")),
    )

    return candidate


def _score_candidate(parsed: dict, line_count: int, average_score: float) -> float:
    score = min(line_count, 8) + (average_score * 5)

    if parsed.get("receiptLine"):
        score += 14

    if parsed.get("totalAmount"):
        score += 9

    return score


def extract_receipt_text(
    preprocessed_image: dict,
    *,
    filename: str = "",
    content_type: str = "",
    request_id: str = "",
) -> dict:
    _ = filename, content_type

    log_info(
        logger,
        "ocr_inference_started",
        requestId=request_id,
        filename=filename,
        contentType=content_type,
        variantCount=len(preprocessed_image.get("variants", [])),
        cropFound=bool(preprocessed_image.get("cropFound")),
        imageWidth=preprocessed_image.get("width"),
        imageHeight=preprocessed_image.get("height"),
    )

    try:
        ocr_engine = _get_ocr_engine()
        candidates = []
        errors = []

        for variant in preprocessed_image.get("variants", []):
            variant_name = variant.get("name", "unknown")
            variant_image = variant.get("image")

            if variant_image is None:
                continue

            try:
                prediction_result = _predict_variant_with_ocr(
                    ocr_engine,
                    variant_image,
                    request_id=request_id,
                    filename=filename,
                    content_type=content_type,
                    variant_name=variant_name,
                )
                candidate = _build_candidate_from_prediction(
                    prediction_result,
                    preprocessed_image=preprocessed_image,
                    request_id=request_id,
                    filename=filename,
                    content_type=content_type,
                    variant_name=variant_name,
                )
                candidates.append(candidate)
            except Exception as error:  # pragma: no cover - depends on OCR runtime
                errors.append(f"{variant_name}: {error}")

        if not candidates:
            detail = "; ".join(errors) if errors else "PaddleOCR did not return any text"
            raise RuntimeError(detail)

        best_candidate = max(candidates, key=lambda item: item["score"])

        if not best_candidate["rawText"]:
            raise RuntimeError("PaddleOCR did not return any text")

        log_info(
            logger,
            "ocr_inference_finished",
            requestId=request_id,
            filename=filename,
            contentType=content_type,
            bestVariant=best_candidate["variant"],
            candidateCount=len(candidates),
            lineCount=best_candidate["lineCount"],
            averageScore=round(best_candidate["averageScore"], 4),
        )

        return {
            "mode": "python-paddleocr",
            "rawText": best_candidate["rawText"],
            "lines": best_candidate["lines"],
            "meta": {
                "engine": "paddleocr",
                "variant": best_candidate["variant"],
                "candidateCount": len(candidates),
                "lineCount": best_candidate["lineCount"],
                "averageScore": round(best_candidate["averageScore"], 4),
                "cropFound": bool(preprocessed_image.get("cropFound")),
                "parsedHints": {
                    "receiptLineFound": bool(best_candidate["parsed"].get("receiptLine")),
                    "totalAmountFound": bool(best_candidate["parsed"].get("totalAmount")),
                },
                "image": {
                    "width": preprocessed_image.get("width"),
                    "height": preprocessed_image.get("height"),
                },
            },
        }
    except Exception:
        log_exception(
            logger,
            "ocr_inference_failed",
            requestId=request_id,
            filename=filename,
            contentType=content_type,
        )
        raise
