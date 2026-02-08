# Option A Migration (appointments-first SSOT)

This repo is migrating to **Option A**: `public.appointments` is the single source of truth (SSOT) for runtime queue + booking flows. Legacy Google Sheet ingestion tables remain for audit/backfill/admin-only tools.

## PostgreSQL tables (SSOT vs legacy)

**SSOT (runtime)**
- `public.appointments` — primary queue/booking records (status, scheduled_at, treatment_id, branch_id, customer_id)
- `public.customers`, `public.customer_identities` — customer resolution by normalized phone (`provider='PHONE'`)
- `public.appointment_events` — audit trail for create/status changes/backdate

**Legacy (admin-only / ingestion)**
- `public.sheet_visits_raw`, `public.sheet_visits_deletions`

## Before (hybrid: sheet-first)

Runtime behavior previously depended on sheet tables:
- Queue reads: `GET /api/visits` → `backend/src/controllers/visitsController.js:listVisits` (reads `sheet_visits_raw LEFT JOIN appointments`)
- Booking create: `POST /api/visits` → `backend/src/controllers/visitsController.js:createVisit` (writes `sheet_visits_raw`)
- Delete: `POST /api/sheet-visits/:sheetUuid/delete` → `backend/src/controllers/sheetVisitsController.js:deleteSheetVisit` (updates `sheet_visits_raw.deleted_at`)
- Service modal bridge: `POST /api/appointments/from-sheet/:sheetUuid/ensure` → `backend/src/controllers/appointmentServiceController.js:ensureAppointmentFromSheet`

## During (staged changes implemented)

### Step 1 — Queue reads appointments-only
- Backend queue endpoint: `GET /api/appointments/queue`
  - Implementation: `backend/src/controllers/appointmentsQueueController.js:listAppointmentsQueue`
  - Joins: `appointments` + `customers` + `customer_identities(PHONE/LINE/EMAIL)` + `treatments`
  - Default excludes: `status IN ('cancelled','canceled','no_show')`
- Frontend switched to queue endpoint:
  - Workbench/Home: `src/pages/workbench/useAppointments.js` → `getAppointmentsQueue()`
  - Booking queue: `src/pages/Bookingpage.jsx` → `getAppointmentsQueue()`

### Step 2 — Booking create writes to appointments (stop writing to sheet)
- Backend create endpoint (staff-auth only): `POST /api/appointments`
  - Implementation: `backend/src/controllers/staffCreateAppointmentController.js:createStaffAppointment`
  - Creates/links customer by normalized phone into `customers` + `customer_identities(provider='PHONE')`
  - Inserts `appointments` row with `line_user_id='__STAFF__'`, `source='WEB'`, `status='booked'`
  - Writes audit row to `appointment_events` (`event_type='created'`, `meta.source='staff_create'`)
  - Blocks double-booking at app level for same `branch_id + scheduled_at` when status is `booked/rescheduled`
- Frontend create call:
  - `src/utils/appointmentsApi.js:appendAppointment` now POSTs to `/api/appointments`

### Step 3 — Legacy sheet endpoints gated (admin-only by default)
- Legacy endpoints now return **410 Gone** for non-admin unless `LEGACY_SHEET_MODE=true`:
  - `GET/POST /api/visits` (routes: `backend/src/routes/visits.js`, guard: `backend/src/middlewares/legacySheetGuard.js`)
  - `POST /api/sheet-visits/:sheetUuid/delete` (routes: `backend/src/routes/sheetVisits.js`)
- Sheet→appointments bridge is now **admin-only**:
  - `POST /api/appointments/from-sheet/:sheetUuid/ensure` requires admin (`backend/src/routes/appointments.js`)
- Workbench “delete” now cancels appointment (appointments SSOT), and cancel notes are recorded:
  - Frontend uses `src/utils/appointmentsApi.js:cancelAppointment`
  - Backend stores optional `note` in `appointment_events.note` in `backend/src/controllers/appointmentServiceController.js:setAppointmentStatus`

## After (Option A: appointments-first SSOT)

**Runtime UI reads/writes**
- Queue reads are appointments-only via `GET /api/appointments/queue`
- New bookings are created in `appointments` via `POST /api/appointments`
- Cancellations mutate `appointments.status` via `POST /api/appointments/:id/cancel` (with optional audit `note`)
- Backdated (past) records are created via admin-only `POST /api/appointments/admin/backdate` and audited (`event_type='ADMIN_BACKDATE_CREATE'`)

**Legacy usage**
- Sheet tables remain available for admin/backfill/import workflows only.
- `LEGACY_SHEET_MODE=true` temporarily re-enables legacy sheet endpoints for authenticated non-admin staff (migration safety switch).

## Index notes (recommended)

- Queue query benefits from an index on `(branch_id, scheduled_at)` if the dataset grows (common filter/order).
- Legacy linkage safety: ensure `appointments.raw_sheet_uuid` is unique when present:
  - Script: `backend/scripts/migrate_appointments_raw_sheet_uuid_unique.js`

