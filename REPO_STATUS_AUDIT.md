# Repo Status Audit

## Audit Time
- `2026-03-22T11:00:09.6216262+07:00`

## Scope
- Repo audited: `C:\Users\scgro\Desktop\Webapp training project\scGlamLiff-reception`
- Cross-repo dependency also checked in the same pass:
  - `C:\Users\scgro\Desktop\Webapp training project\scGlamLiFFF\scGlamLiFF\backend\services\ocr_python`

## Files Read
- `backend/API_CONTRACT.md`
- `backend/API_CHANGELOG_NOTES.md`
- `backend/IMPLEMENTATION_LOG_RECEIPT_BOOKING.md`
- `backend/README-backend.md`
- `backend/src/app.js`
- `backend/src/routes/ocr.js`
- `backend/src/controllers/ocrController.js`
- `backend/src/middlewares/receiptUpload.js`
- `backend/src/services/ocr/receiptOcrService.js`
- `backend/src/services/ocr/pythonOcrClient.js`
- `backend/src/services/ocr/receiptParser.js`
- `backend/package.json`

## Summary
- This repo now owns the active public Bill Verification OCR route at `POST /api/ocr/receipt`.
- This repo now also exposes `GET /api/ocr/health` for deployment/debug verification.
- The route is mounted in the main Express app and accepts multipart upload field `receipt`.
- Startup logs now print the mounted OCR base path and endpoints during boot.
- OCR request logs now include method/path/origin when `/api/ocr/receipt` is hit.
- Python OCR source code is now also copied into this repo at `backend/services/ocr_python`.
- The old Python OCR folder in `scGlamLiFFF/scGlamLiFF/backend/services/ocr_python` remains a temporary duplicate until deployment cutover is complete.
- The route now returns a standardized success/error contract that includes:
  - `success`
  - `rawText`
  - `ocrText`
  - `parsed`
  - `merchant`
  - `receiptDate`
  - `totalAmount`
  - `receiptLines`
  - `errorCode`
  - `errorMessage`

## Blockers
- Real OCR still cannot run locally until the Python runtime dependencies are installed in `backend/services/ocr_python`.
- Production deployment status of the new OCR route is unverified in this pass.

## Next Actions
1. Run `backend` locally on port `5050`.
2. Run the Python OCR service from `backend/services/ocr_python` on port `8001`.
3. Verify `GET /api/ocr/health` returns the downstream reachability report.
4. Verify the LIFF frontend uploads into `POST /api/ocr/receipt`.
5. Deploy the Python OCR service from this repo on Render and then update `OCR_SERVICE_BASE_URL` if the downstream host changes.

## Open Questions
- Should the OCR route be added to `backend/API_CONTRACT.md` as a permanent public endpoint section if it becomes stable in production?
- When should Render cut over from the temporary duplicate to `backend/services/ocr_python` in this repo?

## Update 2026-03-22T12:41:44.6473621+07:00

### Summary
- Production checks now confirm the public backend OCR route in this repo is mounted on Render.
- Production checks also confirm a deeper integration gap:
  - downstream OCR health succeeds
  - but downstream `POST /ocr/receipt` is missing on the configured OCR service host
- This means the current production OCR failure is no longer explained by the main Express route in this repo.
- This pass also hardens the OCR health report so it checks the downstream receipt route, not only the downstream health route.

### Files Read
- `backend/src/app.js`
- `backend/src/routes/ocr.js`
- `backend/src/services/ocr/pythonOcrClient.js`
- `backend/src/services/ocr/receiptOcrService.js`
- `backend/src/controllers/authController.js`
- `backend/README-backend.md`

### Next Actions
1. Check Render env `OCR_SERVICE_BASE_URL`.
2. Confirm that the configured downstream OCR host serves `POST /ocr/receipt`, not only `GET /health`.
3. Redeploy the downstream OCR Render service if it is running older code than the repo.
4. Keep staff login investigation separate from OCR route mounting; auth routes are alive in production.

## Update 2026-03-22T14:06:04.9264876+07:00

### Summary
- Added `backend/services/ocr_python` so this repo now contains both:
  - the public Node OCR route
  - the Python OCR app source
- This is a safe migration step only:
  - no frontend behavior change
  - no public OCR path change
  - old frontend-repo Python OCR copy intentionally remains in place

### Files Added
- `backend/services/ocr_python/README.md`
- `backend/services/ocr_python/requirements.txt`
- `backend/services/ocr_python/app/__init__.py`
- `backend/services/ocr_python/app/main.py`
- `backend/services/ocr_python/app/services/__init__.py`
- `backend/services/ocr_python/app/services/preprocess_service.py`
- `backend/services/ocr_python/app/services/paddle_ocr_service.py`
- `backend/services/ocr_python/app/services/receipt_parser.py`

### Next Actions
1. Point the Render Python OCR service root directory to `backend/services/ocr_python`.
2. Use start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
3. Keep the old frontend-repo copy until the new Render service is confirmed healthy on `/health` and `POST /ocr/receipt`.

## Update 2026-03-22T14:18:31.7770729+07:00

### Summary
- Added Render deployment documentation for two separate services from this repo:
  - Node backend from `backend`
  - Python OCR backend from `backend/services/ocr_python`
- The docs now explicitly keep the current Node OCR bridge model:
  - Node backend calls the Python OCR service through `OCR_SERVICE_BASE_URL`
- No code behavior changed in this pass.

### Files Updated
- `backend/RENDER_DEPLOYMENT.md`
- `backend/README-backend.md`
- `OCR_INTEGRATION_STATUS.md`

### Post-Deploy Verification Focus
1. Verify Python OCR `/health`
2. Verify Node `/api/health`
3. Verify Node `/api/ocr/health`
4. Verify `OCR_SERVICE_BASE_URL` points at the Python OCR service URL, not a stale host

## Update 2026-03-22T14:18:31.7770729+07:00

### Summary
- Improved OCR observability in the Node backend without changing public routes.
- Startup now logs the active OCR downstream base URL and concrete downstream health/receipt URLs.
- OCR request entry logs now include the downstream receipt target URL.
- `/api/ocr/health` now returns clearer additive top-level downstream fields while preserving the older nested payloads.

### Files Updated
- `backend/server.js`
- `backend/src/controllers/ocrController.js`
- `backend/src/services/ocr/pythonOcrClient.js`
- `backend/src/services/ocr/receiptOcrService.js`
- `backend/README-backend.md`
- `OCR_INTEGRATION_STATUS.md`

### Verification
1. Check startup log event `ocr_downstream_config`
2. Check OCR route request log event `request_started`
3. Check bridge log events prefixed with `downstream_*`
4. Check `GET /api/ocr/health` for:
   - `routeMounted`
   - `mountedBasePath`
   - `downstreamBaseUrl`
   - `downstreamReachable`
