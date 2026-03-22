# OCR Integration Status

## Updated At
- `2026-03-22T14:06:04.9264876+07:00`

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
7. Python OCR source of truth in this repo:
   - `backend/services/ocr_python/app/main.py`
   - `backend/services/ocr_python/app/services/receipt_parser.py`
8. Temporary duplicate retained during migration:
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
- Whether Render has been cut over yet to run the Python OCR service from this repo-owned source tree

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
  - `downstreamBaseUrl`
  - `downstreamHealthUrl`
  - `downstreamReceiptUrl`
  - `ocrServiceEnabled`
  - `ocrServiceFallbackToMock`
  - `downstreamReachable`
  - `downstreamReceiptRouteReachable`
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
  - `ocr_downstream_config`
  - `ocr_routes_mounted`
  - `ocr_runtime_ready`
- Controller logs:
  - `request_started`
  - `request_succeeded`
  - `request_failed`
  - `health_requested`
  - `health_succeeded`
  - `health_failed`
- Bridge logs:
  - `downstream_request_started`
  - `downstream_request_succeeded`
  - `downstream_request_failed`
  - `downstream_request_rejected`
  - `downstream_health_probe_started`
  - `downstream_health_probe_finished`
  - `downstream_health_probe_failed`
  - `downstream_receipt_probe_started`
  - `downstream_receipt_probe_finished`
  - `downstream_receipt_probe_failed`
- Upload middleware returns structured OCR error payloads for invalid image type and upload errors.
- OCR service returns explicit `OCR_SERVICE_DISABLED` and `OCR_SERVICE_UNAVAILABLE` responses when real OCR is not reachable.

## Runtime
- Backend port in local `.env`: `5050`
- Python OCR base URL default:
  - `http://127.0.0.1:8001`

## Current Local Blocker
- Real OCR cannot run locally until the in-repo Python service installs:
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

## Update 2026-03-22T12:41:44.6473621+07:00

### Production Reality Check
- Verified on production:
  - `GET https://scglamliff-reception.onrender.com/api/ocr/health` returns the OCR route as mounted
  - `POST https://scglamliff-reception.onrender.com/api/ocr/receipt` without a file returns `OCR_IMAGE_REQUIRED`
  - backend reports `ocrServiceBaseUrl=https://scglamliff.onrender.com`
- Verified on the configured downstream OCR host:
  - `GET https://scglamliff.onrender.com/health` returns `200`
  - `POST https://scglamliff.onrender.com/ocr/receipt` returns `404 Cannot POST /ocr/receipt`

### Interpretation
- The public backend route in this repo is healthy.
- The downstream OCR host configured through Render is alive but does not expose the expected upload route.
- Plausible causes:
  - `OCR_SERVICE_BASE_URL` points at the wrong Render service
  - or the Python OCR Render service is deployed with older code than `backend/services/ocr_python/app/main.py`

### Health Endpoint Improvement
- `backend/src/services/ocr/pythonOcrClient.js` now also probes the downstream receipt route itself.
- `GET /api/ocr/health` now includes `downstreamReceiptRoute` so Render misconfiguration is visible without needing a real customer upload.

### Error Normalization Improvement
- upstream downstream-route failures (`404` / `405` from the Python OCR host) are now normalized into:
  - status `503`
  - code `OCR_DOWNSTREAM_ROUTE_NOT_FOUND`
- This avoids making the frontend think the main backend OCR route is missing when only the downstream OCR service route is missing.

## Update 2026-03-22T14:06:04.9264876+07:00

### Source-of-Truth Migration Step
- Copied the Python OCR app source into this repo at `backend/services/ocr_python`.
- Route paths stay unchanged:
  - Python health: `GET /health`
  - Python OCR upload: `POST /ocr/receipt`
- No frontend behavior changed in this step.
- No public Node route changed in this step.

### Current Ownership After This Step
- Backend repo source of truth:
  - `backend/services/ocr_python/**`
- Temporary duplicate still retained:
  - `..\scGlamLiFFF\scGlamLiFF\backend\services\ocr_python/**`

### Render Runtime Notes
- Recommended Python OCR Render root directory:
  - `backend/services/ocr_python`
- Recommended start command:
  - `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Required app env vars:
  - no custom OCR env vars
  - Render `PORT` is required by the start command

### Two-Service Render Layout
- Service A:
  - repo root directory `backend`
  - build `npm install`
  - start `npm start`
  - health `GET /api/health`
- Service B:
  - repo root directory `backend/services/ocr_python`
  - build `pip install -r requirements.txt`
  - start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - health `GET /health`
- Node bridge behavior stays unchanged:
  - Node still calls the Python service over HTTP through `OCR_SERVICE_BASE_URL`

## Update 2026-03-22T14:18:31.7770729+07:00

### Observability Update
- Startup now logs the configured OCR downstream target explicitly, including:
  - `ocrServiceBaseUrl`
  - downstream health URL
  - downstream receipt URL
- OCR request entry logs now include the downstream OCR target URL.
- Bridge-level logs now show which downstream path is being called for:
  - live OCR upload
  - downstream `/health` probe
  - downstream `/ocr/receipt` probe
- `/api/ocr/health` now returns additive top-level fields for faster debugging:
  - `downstreamBaseUrl`
  - `downstreamHealthUrl`
  - `downstreamReceiptUrl`
  - `downstreamReachable`
  - `downstreamReceiptRouteReachable`

### Public Behavior
- No public route path changed.
- No frontend behavior changed.
- Existing health payload fields were preserved; new fields were added without removing old ones.

## Update 2026-03-22T16:03:00+07:00

### Python OCR Request Logging
- Added structured per-request logs inside `backend/services/ocr_python/app/`.
- `POST /ocr/receipt` now logs:
  - request received
  - uploaded filename
  - content type
  - file size after read
  - decode start/finish
  - OCR inference start/finish
  - receipt parse start/finish
- Each major stage now logs traceback details before re-raising stage exceptions.
- Public route paths and the OCR response contract are unchanged.

## Update 2026-03-22T16:17:00+07:00

### Python OCR Startup Initialization
- The Python OCR service now initializes the shared OCR engine during FastAPI startup.
- Startup logs now show OCR engine initialization start/success/failure explicitly.
- `/health` remains available without requiring an OCR request first.
- The `/ocr/receipt` response schema and route paths are unchanged.

## Update 2026-03-22T16:29:00+07:00

### Runtime Failure Debugging
- Added top-level HTTP middleware logging for uncaught runtime exceptions.
- Split OCR inference tracing into clearer stages so logs now distinguish:
  - before PaddleOCR call
  - during PaddleOCR prediction
  - after prediction during OCR result post-processing
- Image decode and receipt parsing remain separate logged helper stages.
- No route path or response schema changed.
