# Receipt-Backed Appointment Implementation Log

Generated on `2026-03-17T15:35:20.3716730+07:00`

## Goal
- Add backend-side PostgreSQL and API support for receipt-backed appointment creation.
- Keep canonical appointments as the source of truth.
- Avoid breaking existing appointment-first flows.

## What Was Inspected
- `backend/API_CONTRACT.md`
- `backend/API_CHANGELOG_NOTES.md`
- `diary.md`
- `backend/package.json`
- `backend/src/app.js`
- `backend/src/db.js`
- `backend/src/routes/appointments.js`
- `backend/src/routes/adminAppointments.js`
- `backend/src/routes/customers.js`
- `backend/src/controllers/staffCreateAppointmentController.js`
- `backend/src/controllers/adminAppointmentsController.js`
- `backend/src/controllers/appointmentsQueueController.js`
- `backend/src/controllers/appointmentServiceController.js`
- `backend/src/controllers/customersController.js`
- `backend/src/controllers/appointmentsController.js`
- `backend/scripts/init_auth_tables.js`
- `backend/scripts/migrate_appointment_override_logs.js`
- `backend/scripts/migrate_appointment_events_constraints.js`
- `backend/scripts/migrate_treatments_catalog_fields.js`

## Findings From Existing Code
- Canonical appointment creation already lives in `POST /api/appointments` via `createStaffAppointment`.
- Canonical queue/calendar flow already uses PostgreSQL `appointments` as SSOT.
- There was no existing PostgreSQL table or backend service for receipt or OCR evidence.
- `POST /api/appointments` already accepts `branch_id`, but can fall back to `DEFAULT_BRANCH_ID` / `branch-003`.
- Normal appointment creation should remain unchanged when no receipt payload is supplied.
- Product now requires explicit branch selection for the new mobile receipt-backed booking flow, but normal legacy-compatible flows should remain unchanged.
- `GET /api/admin/appointments/:appointmentId` is the cleanest existing read endpoint for richer appointment detail.

## Design Decision

### Schema
- Chosen design: separate table `appointment_receipts`.
- Reason:
  - keeps `appointments` unchanged as the core scheduling table
  - allows optional receipt linkage without polluting ordinary appointments
  - keeps promo/special-event booking inside the normal appointment domain
  - supports future receipt/OCR metadata growth better than adding many nullable columns to `appointments`

### API
- Chosen design: extend canonical `POST /api/appointments` with optional nested `receipt_evidence`.
- Reason:
  - preserves the appointment-first design
  - ensures receipt-backed bookings still create real canonical appointments
  - avoids inventing a parallel booking endpoint or temporary promo record system
  - keeps existing non-receipt clients working unchanged

### Branch Handling
- Implemented rule:
  - `branch_id` remains backward-compatible/optional for normal appointment create
  - `branch_id` becomes required when `receipt_evidence` is sent
- Reason:
  - matches the new product decision for explicit branch selection
  - avoids changing old create callers that do not use receipt evidence

## Implemented Changes

### New Schema / Migration
- Added `backend/scripts/migrate_appointment_receipts.js`
- Added npm script `migrate:appointment-receipts`

`appointment_receipts` fields:
- `id`
- `appointment_id` unique FK to `appointments(id)` with `ON DELETE CASCADE`
- `receipt_image_ref`
- `receipt_number`
- `receipt_line`
- `receipt_identifier`
- `total_amount_thb`
- `ocr_status`
- `ocr_raw_text`
- `ocr_metadata`
- `verification_source`
- `verification_metadata`
- `created_at`
- `updated_at`

Constraints/indexes added:
- unique one-to-one linkage on `appointment_id`
- non-negative amount check
- JSON object checks for OCR and verification metadata
- indexes on `created_at` and `verification_source`

### Backend Code
- Added `backend/src/services/appointmentReceiptEvidenceService.js`
  - validates optional `receipt_evidence`
  - inserts linked receipt evidence
  - reads receipt evidence by `appointment_id`
- Updated `backend/src/controllers/staffCreateAppointmentController.js`
  - parses optional `receipt_evidence`
  - requires explicit `branch_id` for receipt-backed create
  - inserts `appointment_receipts` row in the same transaction as appointment create
  - returns `receipt_evidence` in the create response
  - returns `receipt_evidence: null` when no receipt payload is supplied
  - adds a receipt summary and `receipt_evidence_id` into the create event metadata
- Updated `backend/src/controllers/adminAppointmentsController.js`
  - returns `receipt_evidence` in admin appointment detail
  - tolerates a missing `appointment_receipts` table on read by returning `null` instead of crashing the endpoint

## Files Changed
- `backend/package.json`
- `backend/src/controllers/staffCreateAppointmentController.js`
- `backend/src/controllers/adminAppointmentsController.js`
- `backend/src/services/appointmentReceiptEvidenceService.js`
- `backend/scripts/migrate_appointment_receipts.js`
- `backend/API_CONTRACT.md`
- `backend/API_CHANGELOG_NOTES.md`
- `backend/IMPLEMENTATION_LOG_RECEIPT_BOOKING.md`

## Documentation Updates
- Updated `backend/API_CONTRACT.md` to document:
  - new optional `receipt_evidence` contract on `POST /api/appointments`
  - explicit branch requirement for receipt-backed create
  - receipt-backed bookings remain canonical appointments
  - admin detail now exposes `receipt_evidence`
- Updated `backend/API_CHANGELOG_NOTES.md` with the quick integration caveats for this change set.

## Verification Performed
- Source inspection of route/controller/migration patterns before editing
- `node --check backend/src/controllers/staffCreateAppointmentController.js`
- `node --check backend/src/controllers/adminAppointmentsController.js`
- `node --check backend/src/services/appointmentReceiptEvidenceService.js`
- `node --check backend/scripts/migrate_appointment_receipts.js`

## Remaining Uncertainties
- `branch_id` format remains inconsistent repo-wide; this implementation only enforces explicit presence for receipt-backed create, not UUID shape.
- There is no dedicated patch/delete endpoint for receipt evidence yet; current support is create-time insert plus admin read.
- Queue rows were intentionally left unchanged, so integrations needing receipt evidence must use the create response or admin detail read path.
- If deployment order runs code before the migration, normal create without `receipt_evidence` still works, admin detail is tolerant, but receipt-backed create still depends on the new table existing.

## 2026-03-22 10:14 +07:00 — OCR receipt route added for Bill Verification

### Goal
- Add the active public OCR route to the backend SSOT repo so the Bill Verification frontend can call the real backend path.

### What changed
- Added `POST /api/ocr/receipt` and mounted it in `backend/src/app.js`.
- Added multipart upload handling for `receipt`.
- Added backend OCR controller, upload middleware, parser, service, and Python bridge under `backend/src`.
- Standardized the OCR response contract with:
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
- Kept the Python OCR runtime external to this repo for now, using the sibling repo path `scGlamLiFFF/scGlamLiFF/backend/services/ocr_python`.

### Active path after this update
1. `backend/src/app.js`
2. `backend/src/routes/ocr.js`
3. `backend/src/controllers/ocrController.js`
4. `backend/src/middlewares/receiptUpload.js`
5. `backend/src/services/ocr/receiptOcrService.js`
6. `backend/src/services/ocr/pythonOcrClient.js`
7. `scGlamLiFFF/scGlamLiFF/backend/services/ocr_python/app/main.py`

### Legacy / fallback path
- `rawTextOverride`
- mock fallback only when explicitly configured
- older local backend OCR modules inside `scGlamLiFFF/scGlamLiFF/backend`

### Validation in this pass
- `node --check backend/src/app.js`
- `node --check backend/src/routes/ocr.js`
- `node --check backend/src/controllers/ocrController.js`
- `node --check backend/src/middlewares/receiptUpload.js`
- `node --check backend/src/services/ocr/receiptOcrService.js`
- `node --check backend/src/services/ocr/pythonOcrClient.js`
- `node --check backend/src/services/ocr/receiptParser.js`

### Remaining blocker
- Real OCR still depends on Python packages not installed in the current local environment:
  - `fastapi`
  - `paddle`
  - `paddleocr`
  - `python_multipart`

## 2026-03-22 11:00 +07:00 — OCR route deployment-safety checks

### Goal
- Make the OCR route easier to verify in runtime and safer to diagnose after deployment.

### What changed
- Added a shared OCR route config module so mount/log path strings are not duplicated by hand.
- Added `GET /api/ocr/health` for deployment/debug inspection.
- Added startup logs showing:
  - OCR base path
  - OCR health path
  - OCR receipt path
  - OCR service base URL
  - OCR service enable/fallback flags
- Expanded OCR controller logs so receipt requests include:
  - method
  - path
  - origin

### Runtime verification added
- `GET /api/ocr/health` now returns:
  - `routeMounted`
  - mounted paths
  - current OCR service base URL
  - whether downstream OCR is reachable
- `POST /api/ocr/receipt` no longer needs a successful OCR run just to prove route existence.
  - hitting it without a file now returns `400 OCR_IMAGE_REQUIRED` instead of `404`.

## 2026-03-22 18:10 +07:00 — add receipt upload metadata table for deferred OCR

### Goal
- Add the minimal PostgreSQL schema needed to persist uploaded receipt image metadata now that OCR processing is moving out of the LIFF runtime path.

### Design Decision
- Chosen design: separate table `appointment_receipt_uploads`.
- Reason:
  - keeps `appointments` unchanged
  - avoids overloading `appointment_receipts`, which is still the appointment-level evidence table
  - supports one or more uploaded images per appointment if needed later
  - allows rows to be linked by `appointment_id` when available or by a fallback `booking_reference`

### New Schema / Migration
- Added `backend/scripts/migrate_appointment_receipt_uploads.js`
- Added npm script `migrate:appointment-receipt-uploads`

`appointment_receipt_uploads` fields:
- `id`
- `appointment_id`
- `booking_reference`
- `receipt_image_ref`
- `original_filename`
- `mime_type`
- `file_size_bytes`
- `uploaded_at`
- `ocr_status` default `pending`
- `ocr_processed_at`
- `ocr_error_message`

Constraints/indexes added:
- require at least one linkage target: `appointment_id` or non-empty `booking_reference`
- non-empty checks for file reference, filename, and MIME type
- non-negative file size check
- OCR status check for `pending`, `processing`, `processed`, `failed`
- indexes for uploaded time, appointment lookup, booking reference lookup, and OCR status queueing

### Rollback Note
- Repo migration style is forward-only.
- Manual rollback only if no dependent production data exists:
  - `DROP TABLE IF EXISTS public.appointment_receipt_uploads;`

### Validation in this pass
- `node --check backend/src/services/ocr/ocrRouteConfig.js`
- `node --check backend/src/services/ocr/pythonOcrClient.js`
- `node --check backend/src/services/ocr/receiptOcrService.js`
- `node --check backend/src/controllers/ocrController.js`
- `node --check backend/src/routes/ocr.js`
- `node --check backend/src/app.js`
- `node --check backend/server.js`
- temporary app-instance runtime check:
  - `GET /api/ocr/health` -> `200`
  - `POST /api/ocr/receipt` without file -> `400 OCR_IMAGE_REQUIRED`

## 2026-03-22 12:41 +07:00 — downstream OCR route mismatch found in production

### What was observed
- Production `GET /api/ocr/health` said the OCR route was mounted and the downstream OCR host was reachable.
- Production `POST /api/ocr/receipt` without a file confirmed the public backend route exists.
- But production upload with a real file still failed because the configured downstream OCR host returned:
  - `404 Cannot POST /ocr/receipt`

### Root cause found
- The configured downstream OCR host on Render is alive on `/health` but does not expose the expected upload route.
- That means the current failure is likely:
  - wrong `OCR_SERVICE_BASE_URL`
  - or an outdated/downstream OCR deployment on Render

### Code changes in this pass
- Updated `backend/src/services/ocr/pythonOcrClient.js`
  - upstream `404`/`405` on the Python OCR host now normalize to `503 OCR_DOWNSTREAM_ROUTE_NOT_FOUND`
  - added a downstream receipt-route probe for health reporting
- Updated `backend/src/services/ocr/receiptOcrService.js`
  - `/api/ocr/health` now includes the downstream receipt-route probe result

### Why this matters
- Before this change, a downstream OCR-host `404` could bubble up in a way that the frontend misread as if the main backend route were missing.
- After this change, the backend reports the failure as a downstream OCR integration error instead.

## 2026-03-22 14:06 +07:00 — copied Python OCR app into backend repo as migration-safe source of truth

### Goal
- Make `scGlamLiff-reception` the repository source of truth for OCR backend code without changing current frontend behavior or deleting the old frontend-repo copy yet.

### What changed
- Added Python OCR source under:
  - `backend/services/ocr_python/README.md`
  - `backend/services/ocr_python/requirements.txt`
  - `backend/services/ocr_python/app/main.py`
  - `backend/services/ocr_python/app/services/*`
- Preserved Python route paths:
  - `GET /health`
  - `POST /ocr/receipt`
- Added backend-repo documentation for:
  - Render root directory
  - build command
  - start command
  - required env vars
- Kept the old Python OCR folder in `scGlamLiFFF/scGlamLiFF/backend/services/ocr_python` as a temporary duplicate during migration.

### Why this is safe
- The active public Node OCR route in this repo is unchanged.
- Frontend callers are unchanged.
- `OCR_SERVICE_BASE_URL` behavior is unchanged.
- Production cutover is still a separate step.

### Next migration step
- Deploy the Python OCR service from this repo and only then remove the temporary duplicate from `scGlamLiFFF`.

## 2026-03-22 14:18 +07:00 — documented dual Render deployment from one repo

### Goal
- Document how `scGlamLiff-reception` should be deployed as two separate Render services without changing the current Node-to-Python OCR bridge behavior.

### What changed
- Added `backend/RENDER_DEPLOYMENT.md` with explicit settings for:
  - Service A: main Node backend
  - Service B: Python OCR backend
- Documented for each service:
  - root directory
  - build command
  - start command
  - required env vars
  - health endpoint
- Added a concise Render checklist and curl verification steps.
- Updated `backend/README-backend.md` and `OCR_INTEGRATION_STATUS.md` to point at the new deployment source of truth.

### Important invariant
- Node OCR bridge behavior is unchanged in this documentation step.
- The main backend must still call the Python OCR service through `OCR_SERVICE_BASE_URL`.

## 2026-03-22 14:18 +07:00 — improved OCR observability in Node backend

### Goal
- Make OCR routing/debug failures easier to diagnose from backend logs and `GET /api/ocr/health` without changing public behavior.

### What changed
- Updated `backend/server.js`
  - startup now logs `ocr_downstream_config`
  - startup log includes:
    - `ocrServiceBaseUrl`
    - downstream health URL
    - downstream receipt URL
- Updated `backend/src/controllers/ocrController.js`
  - OCR request-entry logs now include downstream base/receipt URLs
  - OCR health logs now include downstream base/health/receipt URLs
- Updated `backend/src/services/ocr/pythonOcrClient.js`
  - bridge logs now record downstream target path and full target URL for:
    - live OCR requests
    - downstream `/health` probe
    - downstream `/ocr/receipt` probe
- Updated `backend/src/services/ocr/receiptOcrService.js`
  - `/api/ocr/health` now adds top-level downstream clarity fields:
    - `downstreamBaseUrl`
    - `downstreamHealthUrl`
    - `downstreamReceiptUrl`
    - `downstreamReachable`
    - `downstreamReceiptRouteReachable`

### Public behavior
- No route paths changed.
- No request/response fields were removed.
- Existing clients remain compatible; health response only gained additive fields.

## 2026-03-22 16:03 +07:00 — added structured logs inside Python OCR receipt flow

### Goal
- Make the Python OCR service debuggable during real `/ocr/receipt` uploads without changing the public response contract.

### What changed
- Added `backend/services/ocr_python/app/logging_utils.py` for structured JSON log events.
- Updated `backend/services/ocr_python/app/main.py`
  - logs request receipt with filename/content type
  - logs file bytes read with file size
  - wraps preprocess, inference, and parse stages with exception logging before re-raise
- Updated `backend/services/ocr_python/app/services/preprocess_service.py`
  - logs image decode start/finish
  - logs decode traceback on failure
- Updated `backend/services/ocr_python/app/services/paddle_ocr_service.py`
  - logs OCR inference start/finish
  - logs variant-level inference failures
  - logs stage traceback on fatal inference failure
- Updated `backend/services/ocr_python/app/services/receipt_parser.py`
  - logs receipt parse start/finish
  - logs parse traceback on failure

### Public behavior
- No route path changed.
- No response JSON field changed.
- The OCR service still exposes:
  - `GET /health`
  - `POST /ocr/receipt`

## 2026-03-22 16:17 +07:00 — initialized shared OCR engine at FastAPI startup

### Goal
- Avoid first-request OCR engine creation by initializing the shared PaddleOCR engine during app startup.

### What changed
- Updated `backend/services/ocr_python/app/main.py`
  - added FastAPI startup hook
  - startup logs now show OCR app startup and engine init failure if preload fails
- Updated `backend/services/ocr_python/app/services/paddle_ocr_service.py`
  - added `initialize_ocr_engine(...)`
  - startup path now warms the same cached OCR engine used by `/ocr/receipt`

### Public behavior
- No route path changed.
- `/health` response is unchanged.
- `/ocr/receipt` response contract is unchanged.

## 2026-03-22 16:29 +07:00 — hardened Python OCR runtime failure logging

### Goal
- Improve runtime debugging so failures can be separated into decode, PaddleOCR prediction, post-processing, parse, and uncaught HTTP exception layers.

### What changed
- Updated `backend/services/ocr_python/app/main.py`
  - added top-level HTTP middleware logging for uncaught exceptions
- Updated `backend/services/ocr_python/app/services/paddle_ocr_service.py`
  - added `_predict_variant_with_ocr(...)`
  - added `_build_candidate_from_prediction(...)`
  - logs now distinguish:
    - prediction started/finished/failed
    - post-processing started/finished/failed

### Public behavior
- No route path changed.
- No response schema changed.

## 2026-03-22 17:05 +07:00 — switched receipt upload route to upload-only mode

### Goal
- Keep the receipt upload route alive while removing all downstream OCR-service calls from the active Node backend path.

### What changed
- Updated `backend/src/services/ocr/receiptOcrService.js`
  - removed downstream OCR request/health logic from the route path
  - now stores uploaded receipts locally under a generated file reference
  - returns `ocrStatus: "pending"` with backward-compatible empty OCR result fields
- Updated `backend/src/controllers/ocrController.js`
  - route logs now reflect upload-only mode and stored receipt reference
- Updated `backend/server.js`
  - startup logs no longer advertise downstream OCR bridge config

### Public behavior
- `POST /api/ocr/receipt` still accepts multipart field `receipt`
- `GET /api/ocr/health` still exists
- OCR result fields are no longer populated by backend OCR in this path

## 2026-03-22 20:57 +07:00 — persisted upload metadata and rewired receipt storage to Cloudflare R2

### Goal
- Finish the upload-only receipt path so successful uploads are stored durably and linked to PostgreSQL metadata without reintroducing OCR into the LIFF path.

### What changed
- Added `backend/src/services/appointmentReceiptUploadService.js`
  - inserts one row into `appointment_receipt_uploads` for each successful upload
  - accepts `appointment_id` when present, otherwise uses `booking_reference`
  - logs insert success and failure
- Updated `backend/src/controllers/ocrController.js`
  - route now reads optional `appointment_id` / `booking_reference` from multipart form fields
  - request/response logs now include upload record linkage where available
- Updated `backend/src/services/ocr/receiptOcrService.js`
  - upload route now persists upload metadata after the file/object is stored
  - storage backend now prefers Cloudflare R2 when `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_ENDPOINT` are configured
  - local disk storage remains as a fallback only when R2 is not configured
  - `receiptImageRef` now points to an R2 object reference when R2 is active
  - health payload now reports storage backend details including R2 configuration status
- Updated `backend/src/app.js`
  - local static receipt serving is now mounted only when the backend is using local disk storage
- Updated `backend/server.js`
  - startup logs now include the active receipt storage backend
- Updated backend dependency manifest
  - added `@aws-sdk/client-s3` for Cloudflare R2 uploads

### Runtime outcome
- The active receipt path is now:
  1. validate multipart upload
  2. store receipt image in Cloudflare R2 when configured
  3. insert metadata row into `appointment_receipt_uploads`
  4. return upload success with `ocrStatus: "pending"`

### Public behavior
- No route path changed.
- `POST /api/ocr/receipt` remains upload-only and does not call OCR.
- Response shape stays backward-compatible; additive metadata now includes the persisted upload record.

## 2026-03-23 16:35 +07:00 — added temporary LIFF-only receipt promo booking path

### Goal
- Support a temporary LIFF-only promo booking flow for receipt-backed bookings without changing the core appointment creation algorithm.
- Keep the backend appointment/draft flow on the existing tables and APIs.

### What changed
- Added `backend/src/config/liffReceiptPromoCampaign.js`
  - defines the temporary promo treatment code, LIFF booking channel, fixed active window, and promo option builder
- Added `backend/scripts/migrate_liff_receipt_promo_treatment.js`
  - ensures one promo treatment row exists in `treatments`
- Updated `backend/package.json`
  - added `migrate:liff-receipt-promo-treatment`
- Updated `backend/src/controllers/appointmentsQueueController.js`
  - `GET /api/appointments/booking-options` now supports query `channel=liff_receipt_promo_q2_2026`
  - when this LIFF promo channel is requested during the active window, backend returns exactly one booking option for the temporary promo
  - when outside the active window, backend returns an empty option list for that promo channel
- Updated `backend/src/services/appointmentCreateService.js`
  - final canonical appointment create now blocks the temporary promo when it is outside the active window
  - final canonical appointment create now requires LIFF promo verification metadata when the promo treatment is used

### Design decision
- The temporary promo is modeled as a one-off `treatment`, not a `package`.
- Reason:
  - keeps package continuity logic unchanged
  - avoids touching `customer_packages` and `package_usages`
  - allows the appointment algorithm to stay on the canonical `appointments` path

### Assumption in this pass
- Promo eligibility is enforced at booking create / draft submit time.
- Active window used:
  - start: `2026-03-23T00:00:00+07:00`
  - end: `2026-06-30T23:59:59.999+07:00`

### Runtime outcome
- LIFF can now request promo-only booking options from backend.
- Real appointment creation still uses the same canonical appointment create flow.
- If promo treatment is selected but required LIFF promo metadata is missing, backend rejects the request instead of silently creating a normal appointment.

## 2026-03-23 16:50 +07:00 — deployment and QA checklist for LIFF receipt promo

### Deploy order
1. Run backend data migration in `scGlamLiff-reception/backend`:
   - `npm run migrate:liff-receipt-promo-treatment`
2. Deploy backend `scGlamLiff-reception`
3. Verify backend promo booking-options endpoint and create guards
4. Deploy frontend `scGlamLiFFF/scGlamLiFF`
5. Run mobile LIFF smoke test against production

### Pre-deploy checks
- Confirm promo active window is still intended to be enforced at booking create / draft submit time:
  - start: `2026-03-23T00:00:00+07:00`
  - end: `2026-06-30T23:59:59.999+07:00`
- Confirm bucket/env for receipt upload are already valid in production:
  - `R2_BUCKET`
  - `R2_ACCESS_KEY_ID`
  - `R2_SECRET_ACCESS_KEY`
  - `R2_ENDPOINT`
  - optional `R2_KEY_PREFIX`
- Confirm PostgreSQL migration `appointment_receipt_uploads` has already been applied
- Confirm backend package install is up to date after adding promo migration script and prior R2 dependency changes

### Post-deploy smoke tests
- Backend:
  - `GET /api/appointments/booking-options?channel=liff_receipt_promo_q2_2026`
    - should return exactly one option during the active window
    - returned option should use source `promo`
  - `GET /api/ocr/health`
    - should still report upload-only receipt mode
    - should still show the active storage backend for receipt uploads
- Frontend / LIFF:
  - LIFF booking modal should show only the temporary promo option
  - smooth package options should not appear in LIFF
  - receipt upload should succeed without waiting for OCR extraction
  - saving draft with receipt attached should remain possible when date/time are incomplete
  - final submit should still create a normal appointment through the canonical backend flow

### DB verification checklist
- `treatments`
  - promo row exists with code `promo_receipt_900_q2_2026`
  - row is active
- `appointment_receipt_uploads`
  - new upload creates a row with:
    - `appointment_id` or `booking_reference`
    - `receipt_image_ref`
    - `original_filename`
    - `mime_type`
    - `file_size_bytes`
    - `uploaded_at`
    - `ocr_status = 'pending'`
- `appointment_drafts`
  - draft payload keeps `receipt_evidence.receipt_image_ref`
  - promo booking metadata remains present in draft flow metadata
- `appointments`
  - final submitted promo booking creates a normal appointment row using the promo treatment id

### Rollback steps
1. If frontend LIFF promo flow fails but backend is healthy:
   - redeploy previous frontend release only
2. If backend promo-only booking-options or create guard fails:
   - redeploy previous backend release
3. If the promo treatment row itself causes issues:
   - set `treatments.is_active = false` for code `promo_receipt_900_q2_2026`
   - keep receipt upload route unchanged
4. If a full rollback is needed:
   - restore previous frontend
   - restore previous backend
   - leave `appointment_receipt_uploads` data intact
   - optionally keep the promo treatment row but inactive instead of deleting it

### Concise mobile tester script
1. Open LIFF on a staff/device account
2. Open the booking modal
3. Confirm only the temporary receipt promo is selectable
4. Attach a receipt image
5. Leave date/time incomplete and save draft
6. Confirm draft save succeeds
7. Re-open the draft
8. Confirm receipt attachment still appears as attached evidence, not OCR text
9. Complete date/time and submit booking
10. Confirm booking succeeds and no smooth package choice appears anywhere in the LIFF flow

## 2026-03-25 08:55 +07:00 — self-heal receipt upload metadata schema at runtime

### Goal
- Fix the backend root cause behind `Failed to persist receipt upload metadata`
  without changing LIFF draft/save gating or the public OCR upload contract.

### Root cause
- The insert path in `backend/src/services/appointmentReceiptUploadService.js`
  already sends a schema-compatible payload for the intended
  `appointment_receipt_uploads` table.
- The fragile part was the runtime assumption that the one-off migration had
  already been applied everywhere before the first real receipt upload.
- When the table or its supporting indexes were missing in a deployed
  environment, the upload storage step succeeded but the metadata insert failed,
  which then blocked LIFF draft/save because the frontend correctly treats the
  receipt upload as unresolved.

### What changed
- `backend/src/services/appointmentReceiptUploadService.js`
  - now ensures `appointment_receipt_uploads` exists with the expected core
    schema before inserting metadata
  - now inserts an explicit UUID `id` generated in Node instead of relying on a
    database-side default
  - now logs a structured, safe insert-attempt payload and richer PG error
    fields (`table`, `column`, `where`, `constraint`, `detail`, `code`)
- Added `backend/src/services/appointmentReceiptUploadService.test.js`
  - covers fallback booking-reference generation
  - covers happy-path metadata persistence
  - covers invalid appointment id rejection
  - covers schema-ensure DDL execution

### Operational meaning
- A successful receipt file/object write is no longer followed by an avoidable
  metadata insert failure just because the receipt-upload migration was missed on
  one environment.
- Frontend draft/save gating stays unchanged; the backend now makes it much more
  likely that receipt upload resolves to success as designed.

## 2026-03-25 10:20 +07:00 — unblock promo draft/save after receipt upload recovery

### Goal
- Keep the receipt-upload success path intact while fixing the next two LIFF
  blockers:
  - `POST /api/appointment-drafts` returning a generic `Server error`
  - direct promo booking create failing with
    `Temporary LIFF receipt promo requires LIFF promo booking metadata`

### Root cause
- Draft save still assumed the `appointment_drafts` table/indexes had already
  been migrated in every environment.
- Direct appointment create and draft create were no longer symmetric:
  the draft payload reused the shared LIFF promo verification metadata builder,
  but the direct create payload omitted `verification_metadata.booking_channel`,
  so backend promo validation correctly rejected the create request.

### What changed
- `backend/src/services/appointmentDraftsService.js`
  - now ensures the `appointment_drafts` schema/indexes exist before draft
    create/list/get/patch/submit operations
- `backend/src/controllers/appointmentDraftsController.js`
  - now logs structured internal draft failures for production debugging
- `scGlamLiFFF/scGlamLiFF/src/services/appointmentContract.js`
  - direct create now uses the same LIFF promo verification metadata builder as
    the draft flow, including `booking_channel` for promo selections

### Regression protection
- Draft service tests now tolerate the schema-bootstrap DDL path and keep the
  existing draft-flow assertions intact.
- Frontend appointment contract tests now verify that promo create payloads
  include `booking_channel=liff_receipt_promo_q2_2026`.
