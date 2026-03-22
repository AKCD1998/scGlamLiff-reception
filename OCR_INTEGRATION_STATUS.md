# OCR Integration Status

## Updated At
- `2026-03-22T11:00:09.6216262+07:00`

## Active OCR Path
1. Frontend upload UI:
   - `..\scGlamLiFFF\scGlamLiFF\src\components\NewBillRecipientModal.jsx`
2. Frontend OCR caller:
   - `..\scGlamLiFFF\scGlamLiFF\src\services\receiptOcrService.js`
3. Backend app mount:
   - `backend/src/app.js`
4. OCR route:
   - `backend/src/routes/ocr.js`
5. OCR controller and upload middleware:
   - `backend/src/controllers/ocrController.js`
   - `backend/src/middlewares/receiptUpload.js`
6. OCR service and Python bridge:
   - `backend/src/services/ocr/receiptOcrService.js`
   - `backend/src/services/ocr/pythonOcrClient.js`
   - `backend/src/services/ocr/receiptParser.js`
7. Python OCR runtime in sibling repo:
   - `..\scGlamLiFFF\scGlamLiFF\backend\services\ocr_python\app\main.py`
   - `..\scGlamLiFFF\scGlamLiFF\backend\services\ocr_python\app\services\receipt_parser.py`

## Path Classification

### Active
- `POST /api/ocr/receipt` in this repo is now the active public backend route for Bill Verification OCR.
- `GET /api/ocr/health` in this repo is the deployment/debug endpoint for OCR route visibility and downstream reachability.

### Legacy
- `rawTextOverride` in `backend/src/services/ocr/receiptOcrService.js`
- Any older Node OCR route/modules still living in `scGlamLiFFF/scGlamLiFF/backend`

### WIP
- Merchant extraction quality
- Receipt parsing quality across more real receipt formats

### Uncertain
- Whether the deployed production host already includes this new OCR route
- Whether the Python OCR runtime will stay in the sibling repo long-term

## Request Contract
- Method: `POST`
- Path: `/api/ocr/receipt`
- Content type: `multipart/form-data`
- File field: `receipt`

## OCR Debug Health Endpoint
- Method: `GET`
- Path: `/api/ocr/health`
- Response style: `{ ok: true, data: ... }`
- Current fields returned:
  - `routeMounted`
  - `mountedBasePath`
  - `receiptPath`
  - `healthPath`
  - `ocrServiceBaseUrl`
  - `ocrServiceEnabled`
  - `ocrServiceFallbackToMock`
  - `downstream.reachable`
  - `downstream.status`
  - `downstream.code`
  - `downstream.message`
  - `downstream.url`

## Standardized Response Contract

### Success
```json
{
  "success": true,
  "code": "OCR_OK",
  "message": "Receipt OCR completed",
  "errorCode": "",
  "errorMessage": "",
  "ocrStatus": "success",
  "mode": "python-paddleocr",
  "rawText": "17/03/2026 08:36 BNO:S2603004002-0006510\nTotal 1.00 Items\n324 00",
  "ocrText": "17/03/2026 08:36 BNO:S2603004002-0006510\nTotal 1.00 Items\n324 00",
  "parsed": {
    "receiptLine": "17/03/2026 08:36 BNO:S2603004002-0006510",
    "receiptLines": [
      "17/03/2026 08:36 BNO:S2603004002-0006510",
      "Total 1.00 Items",
      "324 00"
    ],
    "totalAmount": "324.00 THB",
    "totalAmountValue": 324,
    "receiptDate": "2026-03-17",
    "receiptTime": "08:36",
    "merchant": "",
    "merchantName": ""
  },
  "receiptLine": "17/03/2026 08:36 BNO:S2603004002-0006510",
  "receiptLines": [
    "17/03/2026 08:36 BNO:S2603004002-0006510",
    "Total 1.00 Items",
    "324 00"
  ],
  "totalAmount": "324.00 THB",
  "totalAmountTHB": 324,
  "receiptDate": "2026-03-17",
  "receiptTime": "08:36",
  "merchant": "",
  "merchantName": "",
  "ocrMetadata": {}
}
```

### Error
```json
{
  "success": false,
  "code": "OCR_SERVICE_UNAVAILABLE",
  "message": "OCR service request failed",
  "errorCode": "OCR_SERVICE_UNAVAILABLE",
  "errorMessage": "OCR service request failed",
  "ocrStatus": "error",
  "mode": "node-receipt-ocr",
  "rawText": "",
  "ocrText": "",
  "parsed": {
    "receiptLine": "",
    "receiptLines": [],
    "totalAmount": "",
    "totalAmountValue": null,
    "receiptDate": "",
    "receiptTime": "",
    "merchant": "",
    "merchantName": ""
  },
  "receiptLine": "",
  "receiptLines": [],
  "totalAmount": "",
  "totalAmountTHB": null,
  "receiptDate": "",
  "receiptTime": "",
  "merchant": "",
  "merchantName": "",
  "ocrMetadata": {},
  "error": {
    "code": "OCR_SERVICE_UNAVAILABLE",
    "message": "OCR service request failed"
  }
}
```

## Diagnostics
- Startup logs:
  - `ocr_routes_mounted`
  - `ocr_runtime_ready`
- Controller logs:
  - `request_started`
  - `request_succeeded`
  - `request_failed`
  - `health_requested`
  - `health_succeeded`
  - `health_failed`
- Upload middleware returns structured OCR error payloads for invalid image type and upload errors.
- OCR service returns explicit `OCR_SERVICE_DISABLED` and `OCR_SERVICE_UNAVAILABLE` responses when real OCR is not reachable.

## Runtime
- Backend port in local `.env`: `5050`
- Python OCR base URL default:
  - `http://127.0.0.1:8001`

## Current Local Blocker
- Real OCR cannot run locally until the sibling Python service installs:
  - `fastapi`
  - `paddle`
  - `paddleocr`
  - `python_multipart`

## Validation
- `node --check backend/src/app.js`
- `node --check backend/src/routes/ocr.js`
- `node --check backend/src/controllers/ocrController.js`
- `node --check backend/src/middlewares/receiptUpload.js`
- `node --check backend/src/services/ocr/receiptOcrService.js`
- `node --check backend/src/services/ocr/pythonOcrClient.js`
- `node --check backend/src/services/ocr/receiptParser.js`
- temporary app-instance runtime check for:
  - `GET /api/ocr/health` -> `200`
  - `POST /api/ocr/receipt` without file -> `400 OCR_IMAGE_REQUIRED`
