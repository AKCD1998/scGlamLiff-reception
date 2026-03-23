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

## Update 2026-03-22T16:03:00+07:00

### Summary
- Added structured request-stage logging to the Python OCR service under `backend/services/ocr_python/app/`.
- The OCR runtime now emits explicit logs for:
  - request received
  - file bytes read
  - image decode start/finish
  - OCR inference start/finish
  - receipt parse start/finish
- Stage-level exceptions now log traceback details before being re-raised into the existing response handler.

### Files Updated
- `backend/services/ocr_python/app/logging_utils.py`
- `backend/services/ocr_python/app/main.py`
- `backend/services/ocr_python/app/services/preprocess_service.py`
- `backend/services/ocr_python/app/services/paddle_ocr_service.py`
- `backend/services/ocr_python/app/services/receipt_parser.py`
- `OCR_INTEGRATION_STATUS.md`

## Update 2026-03-22T16:17:00+07:00

### Summary
- Moved Python OCR engine initialization to FastAPI startup while keeping a single shared cached engine instance for the process lifecycle.
- Startup now logs engine init start/success/failure.
- `/health` behavior is unchanged and does not require a prior OCR request.

### Files Updated
- `backend/services/ocr_python/app/main.py`
- `backend/services/ocr_python/app/services/paddle_ocr_service.py`
- `OCR_INTEGRATION_STATUS.md`

## Update 2026-03-22T16:29:00+07:00

### Summary
- Added top-level middleware logging for uncaught HTTP exceptions in the Python OCR service.
- Split OCR inference tracing into distinct prediction and post-processing helper logs so runtime failures can be localized more precisely.
- Image decode and receipt parsing remain separate logged stages.

### Files Updated
- `backend/services/ocr_python/app/main.py`
- `backend/services/ocr_python/app/services/paddle_ocr_service.py`
- `OCR_INTEGRATION_STATUS.md`

## Update 2026-03-22T17:05:00+07:00

### Summary
- Refactored `POST /api/ocr/receipt` into a receipt-upload-only endpoint in the Node backend.
- The route now stores receipt files locally, returns a file reference plus metadata, and defaults `ocrStatus` to `pending`.
- Removed the active Node backend path's dependency on the downstream OCR bridge.

### Files Updated
- `backend/src/controllers/ocrController.js`
- `backend/src/services/ocr/receiptOcrService.js`
- `backend/server.js`
- `OCR_INTEGRATION_STATUS.md`

## Update 2026-03-22T18:10:00+07:00

### Summary
- Added a new PostgreSQL migration for receipt upload metadata that can be processed by OCR later outside the LIFF request path.
- Chosen table: `public.appointment_receipt_uploads`.
- The table links uploaded receipt image references to an existing `appointment_id` when known, or to a fallback `booking_reference` when the appointment linkage is not yet available.
- OCR state now has a DB-native queue/status field with default `pending`.

### Files Updated
- `backend/scripts/migrate_appointment_receipt_uploads.js`
- `backend/package.json`
- `backend/API_CHANGELOG_NOTES.md`
- `backend/IMPLEMENTATION_LOG_RECEIPT_BOOKING.md`

### Next Actions
1. Run `npm run migrate:appointment-receipt-uploads` in `backend/`.
2. Update the upload-only receipt route to insert a metadata row into `appointment_receipt_uploads`.
3. Decide whether later offline OCR processing should read rows by `ocr_status='pending'` or via a separate queue worker.

## Update 2026-03-22T20:57:00+07:00

### Summary
- Wired the active upload-only receipt route to persist runtime metadata into `appointment_receipt_uploads`.
- Replaced the default receipt storage path with a storage abstraction that now prefers Cloudflare R2 and falls back to local disk only when R2 is not configured.
- Local static serving of uploaded receipts is now disabled automatically when Cloudflare R2 is the active storage backend.

### Files Updated
- `backend/src/services/appointmentReceiptUploadService.js`
- `backend/src/services/ocr/receiptOcrService.js`
- `backend/src/app.js`
- `backend/server.js`
- `backend/package.json`
- `backend/package-lock.json`
- `backend/IMPLEMENTATION_LOG_RECEIPT_BOOKING.md`
- `OCR_INTEGRATION_STATUS.md`

### Current State
- `POST /api/ocr/receipt` remains upload-only.
- Successful uploads now:
  1. store the image in R2 when configured
  2. insert metadata into PostgreSQL
  3. return `ocrStatus: "pending"`
- The LIFF path no longer depends on OCR runtime availability.

## Update 2026-03-23T16:35:00+07:00

### Summary
- Added a temporary LIFF-only promo booking path for receipt-backed bookings.
- Chosen model: treat the promo as a one-off `treatments` catalog row, not as a `packages` row.
- `GET /api/appointments/booking-options` can now return a promo-only option list when called with the dedicated LIFF promo channel.
- Final appointment creation now guards the promo by active window and required LIFF promo verification metadata.

### Files Updated
- `backend/src/config/liffReceiptPromoCampaign.js`
- `backend/scripts/migrate_liff_receipt_promo_treatment.js`
- `backend/package.json`
- `backend/src/controllers/appointmentsQueueController.js`
- `backend/src/services/appointmentCreateService.js`

### Next Actions
1. Run `npm run migrate:liff-receipt-promo-treatment` in `backend/`.
2. Redeploy backend so the promo-only booking options endpoint and create guards are live.
3. Verify `GET /api/appointments/booking-options?channel=liff_receipt_promo_q2_2026` returns one option during the active window.

## Update 2026-03-23T16:50:00+07:00

### Deployment / QA Checklist
- Deploy order:
  1. run `npm run migrate:liff-receipt-promo-treatment`
  2. deploy `scGlamLiff-reception`
  3. verify backend promo option endpoint
  4. deploy `scGlamLiFFF/scGlamLiFF`
  5. run mobile LIFF smoke test
- Pre-deploy:
  - verify R2 env is still valid
  - verify `appointment_receipt_uploads` migration is already applied
  - verify Bangkok promo window values remain correct
- Post-deploy:
  - `GET /api/appointments/booking-options?channel=liff_receipt_promo_q2_2026` returns one promo option during active window
  - `GET /api/ocr/health` still shows upload-only receipt mode
  - LIFF shows only promo option and still supports draft save with receipt attachment
- Rollback:
  - rollback frontend first if only LIFF UI fails
  - rollback backend if promo option endpoint or create guards fail
  - deactivate treatment code `promo_receipt_900_q2_2026` if promo data must be turned off quickly
