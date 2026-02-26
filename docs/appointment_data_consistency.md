# Appointment Data Consistency

## What Was Wrong
- Identity handling in UI used loose fallbacks (`row.id` / `booking.id`) in some flows instead of enforcing `appointment_id`.
- Legacy sheet linkage in `GET /api/visits` used a non-deterministic join (`appointments.raw_sheet_uuid = sheet_uuid`) that could pick different rows if bad historical duplicates existed.
- This made it possible for list rows and mutation actions to drift from the appointment that `AdminEditAppointment` was editing.

## Canonical Source and Endpoints
- Canonical list source for Homepage + Booking queue: `GET /api/appointments/queue`
- Canonical detail source for admin edit: `GET /api/admin/appointments/:appointmentId`
- Canonical mutation target: `POST /api/appointments/:appointmentId/*` (`complete`, `cancel`, `no-show`, `revert`, `sync-course`)

## ID Rules
- Primary identity everywhere in UI/actions: `appointment_id` (same as `appointments.id` UUID).
- `raw_sheet_uuid` is legacy linkage metadata only; it must not be used as action identity in Homepage/Booking/Service modal flows.
- Homepage delete flow and Booking service confirmation flow now resolve and pass `appointment_id` only.

## Backend Guardrails
- `backend/src/controllers/visitsController.js` now uses deterministic linkage for sheet source:
  - `LEFT JOIN LATERAL (...) ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1`
- Keep/ensure unique linkage for legacy bridge:
  - `appointments.id` is already unique (PK).
  - ensure `appointments.raw_sheet_uuid` uniqueness when present:
    - `node backend/scripts/migrate_appointments_raw_sheet_uuid_unique.js`

## How To Verify

### 1) Dev-side side-by-side log (temporary)
- Utility: `src/utils/appointmentConsistencyDebug.js`
- It compares:
  - Homepage endpoint (`/api/appointments/queue`)
  - Admin detail endpoint (`/api/admin/appointments/:id`)
  - for appointment IDs:
    - `216cb944-5d28-4945-b4a8-56c90b42cc89`
    - `a0a94f48-2978-4b31-86c5-550907087ffe`
- Output fields:
  - `appointment_id`, `raw_sheet_uuid`, `scheduled_at`, `branch_id`, `customer_full_name`, `phone`, `treatment_id`, `treatment_item_text`, `status`, `staff_name`
- Runs only outside production (and skips test mode); can be forced with:
  - `VITE_DEBUG_APPOINTMENT_CONSISTENCY=true`

### 2) Backend regression script
- Script: `backend/scripts/verify_appointment_consistency.js`
- Command:
  - `cd backend`
  - `npm run verify:appointment-consistency`
- Optional env:
  - `API_BASE_URL` (default `http://localhost:5050`)
  - `AUTH_COOKIE` or `AUTH_BEARER` for authenticated endpoints
  - `APPOINTMENT_IDS` (comma-separated) or CLI `--id/--ids`
- PASS condition:
  - For each `appointment_id`, queue row and admin detail must match:
    - `customer_full_name`, `scheduled_at`, `branch_id`, `treatment_id`, `status`

