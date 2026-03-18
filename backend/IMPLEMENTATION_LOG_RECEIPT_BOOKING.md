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
