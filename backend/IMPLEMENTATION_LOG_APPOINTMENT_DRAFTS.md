# Appointment Draft Buffer Implementation Log

Generated on `2026-03-17T19:33:51.8252486+07:00`

## Goal
- Add PostgreSQL-backed draft buffer storage for promo/receipt-qualified bookings that are not real appointments yet.
- Keep draft storage in the same database as the existing backend.
- Submit complete drafts into the existing canonical appointment creation flow.

## What Was Inspected
- `backend/src/app.js`
- `backend/src/routes/appointments.js`
- `backend/src/controllers/staffCreateAppointmentController.js`
- `backend/src/services/appointmentReceiptEvidenceService.js`
- `backend/src/controllers/appointmentsQueueController.js`
- `backend/src/controllers/appointmentServiceController.js`
- `backend/src/middlewares/requireAuth.js`
- `backend/package.json`
- `backend/API_CONTRACT.md`
- `backend/API_CHANGELOG_NOTES.md`
- `backend/IMPLEMENTATION_LOG_RECEIPT_BOOKING.md`
- `diary.md`

## Key Findings
- Real appointments in this repo are created through canonical `POST /api/appointments`.
- That canonical path currently enforces booking business rules such as future-time validation, slot collision checks, customer resolution by phone, package inference, and optional receipt evidence linkage.
- The new promo draft flow must not create real appointments until missing booking details are known.
- The same PostgreSQL database is already the source of truth for the appointments-first system, so a second database server would add complexity without solving a real code-level problem.

## Design Decision

### Why a New Table Was Used Instead of a Second Database
- Chosen design: new table `appointment_drafts` in the existing PostgreSQL database.
- Reason:
  - keeps draft data close to the canonical appointment system
  - avoids a second persistence stack and cross-database consistency problems
  - allows transactional submit from draft -> appointment inside the same database connection
  - keeps draft data clearly separate from real appointments

### Draft Lifecycle
- `draft`
  - partial promo-qualified data may be stored
  - `scheduled_at` and `staff_name` may be missing
  - row remains persisted in PostgreSQL and can be reloaded after refresh
- `cancelled`
  - draft remains a buffer record but is not submittable
- `submitted`
  - real appointment has been created
  - draft keeps `submitted_appointment_id` and `submitted_at` for traceability

### Canonical Submit Reuse
- Chosen implementation:
  - extract canonical appointment create logic into `appointmentCreateService.js`
  - make `POST /api/appointments` call that service
  - make draft submit call that same service inside the draft transaction
- Reason:
  - avoids duplicating slot, customer, package, and receipt rules
  - keeps the real appointment system single-sourced

## Implemented Changes

### Database / Migration
- Added `backend/scripts/migrate_appointment_drafts.js`
- Added npm script `migrate:appointment-drafts`

`appointment_drafts` stores:
- draft identity/status
- partial booking fields
- `receipt_evidence` as JSONB
- source/flow metadata
- creator/updater staff user ids
- submit linkage to the created appointment
- timestamps

### Backend API
- Added `/api/appointment-drafts` route group
- Added endpoints:
  - `GET /api/appointment-drafts`
  - `POST /api/appointment-drafts`
  - `GET /api/appointment-drafts/:id`
  - `PATCH /api/appointment-drafts/:id`
  - `POST /api/appointment-drafts/:id/submit`
- `GET /api/appointment-drafts` is backed by PostgreSQL and returns persisted rows sorted by newest `updated_at` first
- Default list behavior returns `draft` and `submitted` rows; `status` filter supports `draft`, `submitted`, `cancelled`, or `all`

### Canonical Appointment Reuse
- Added `backend/src/services/appointmentCreateService.js`
- Refactored `backend/src/controllers/staffCreateAppointmentController.js` to call the shared canonical create service
- Draft submit now calls the same create service inside the draft transaction

### Branch Contract Hardening
- Added `backend/src/utils/branchContract.js`
- Centralized the current backend rule set:
  - write flows accept text-like `branch_id` values and preserve them as-is
  - canonical appointment create still falls back to `DEFAULT_BRANCH_ID` / `branch-003` when allowed
  - queue/calendar read filters only accept UUID-shaped `branch_id`
- No fake UUID remapping was introduced

## Files Changed
- `backend/package.json`
- `backend/src/app.js`
- `backend/src/routes/appointmentDrafts.js`
- `backend/src/controllers/appointmentDraftsController.js`
- `backend/src/controllers/staffCreateAppointmentController.js`
- `backend/src/services/appointmentCreateService.js`
- `backend/src/services/appointmentDraftsService.js`
- `backend/src/services/appointmentDraftsService.test.js`
- `backend/src/utils/branchContract.js`
- `backend/src/utils/branchContract.test.js`
- `backend/scripts/migrate_appointment_drafts.js`
- `backend/API_CONTRACT.md`
- `backend/API_CHANGELOG_NOTES.md`
- `backend/IMPLEMENTATION_LOG_APPOINTMENT_DRAFTS.md`

## Tests / Verification
- `node --check` on new/changed JS files
- `npm test` in `backend/`
- Focused service tests added for:
  - create incomplete draft
  - list persisted drafts in stable order
  - reload drafts after create/update
  - filter drafts by status
  - patch draft later with `scheduled_at` and `staff_name`
  - submit complete draft into real appointment
  - reject submit when required fields are missing
  - reject duplicate submit on already-submitted draft
  - preserve `submitted_appointment_id` linkage
  - branch helper contract for write values vs queue/calendar filters

## Branch Contract
- The draft table keeps `branch_id` as text.
- This is deliberate and matches the current canonical create path, which still tolerates text-like values such as `branch-003`.
- Queue/calendar filtering remains stricter and UUID-shaped on read side.
- The backend now makes this split explicit through shared helper logic and documentation.
- No fake UUID mapping was introduced.

## Remaining Follow-Ups
- Draft submit currently requires the draft to carry explicit `staff_name`, even though direct canonical create can fall back to the session user display name. This stricter submit rule is intentional for the product flow described in this task.
- There is still no dedicated delete endpoint for drafts; current retirement path is `PATCH /api/appointment-drafts/:id` with `status=cancelled`.
- The underlying branch domain model is still mixed: write paths accept opaque text, while queue/calendar branch filters require UUID input.
