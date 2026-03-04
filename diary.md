<!-- ===== BEGIN legacy: PROJECT_DIARY.md ===== -->
<!-- source_path: C:\Users\scgro\Desktop\Webapp training project\scGlamLiff-reception\PROJECT_DIARY.md -->
<!-- captured_at: 2026-03-04T08:32:16.4035828+07:00 -->
# Project Diary

## 2026-02-13 13:53:57 +07:00 — Runtime pinning + install stability + env/CI standardization (no Docker)

### Runtime decision
- Pinned Node version: `20.19.0` via `.nvmrc`.
- Rationale: frontend uses `vite@7` which requires Node `^20.19.0 || >=22.12.0`; pinning to `20.19.0` keeps a stable LTS baseline across branches while satisfying the strict minimum.

### Runtime/install changes
- Added `engines` in root `package.json` (`node` + `npm`) to align with the pinned runtime.
- Added `engines` in `backend/package.json` for consistency when running backend scripts.
- Verified lockfile presence: `package-lock.json` already existed; no lockfile regeneration was needed.

### Env standardization
- Added `.env.example` (names only, no secrets).
- Standardized tracked env patterns:
  - `.env.development` (local-safe defaults)
  - `.env.staging` (placeholders)
  - `.env.production` (placeholders)
- Refactored frontend/env readers to prefer `VITE_API_BASE_URL` and keep fallback support for legacy `VITE_API_BASE`.
- Removed hardcoded frontend workbench redirect URL in `Bookingpage` by deriving from current location.

### CI and test suite
- `test:suite` remains the single command for branch/PR checks (`vitest run` + Playwright E2E).
- Added `.github/workflows/ci.yml`:
  - uses Node from `.nvmrc`
  - runs `npm ci`
  - installs Playwright browser
  - runs `npm run test:suite`
- Updated deploy workflow to also use `.nvmrc`.

### Local commands
```bash
nvm use
npm ci
npm run test:suite
```

### Verification notes
- `npm run test:run` passed after:
  - scoping Vitest to `src/**/*.test.*` and excluding `tests/e2e/**`
  - updating one stale UI assertion in `src/pages/WorkbenchPage.test.jsx`
- `npm ci` could not be fully validated in this active local session due Windows file locks on binaries inside `node_modules` while Node/Vite processes were still running. This is documented in `BLUNDER.md`. CI remains configured to use `npm ci`.

## 2026-02-13 14:52:13 +07:00 — Render production 400 on `/api/appointments/queue` hardening

### What was broken
- Production requests were observed as `GET https://<static-site>.onrender.com/api/appointments/queue?limit=50` returning `400`.
- Root cause class: frontend API base misconfiguration risk (static site origin used as API host or implicit same-origin `/api` without intentional rewrite).

### Fix implemented
- Frontend API base guardrails:
  - `src/utils/runtimeEnv.js`
  - Warn in non-dev when API base is empty.
  - Warn on Render host when API base is empty or same-origin without explicit opt-in.
  - Added `VITE_ALLOW_SAME_ORIGIN_API=true` opt-in for intentional `/api` rewrite mode.
- Frontend queue error diagnostics:
  - `src/utils/appointmentsApi.js`
  - Queue call now logs status/url/response payload on failure and throws with structured message/details.
- Local-dev proxy-safe behavior:
  - `src/utils/appointmentsApi.js`
  - `src/utils/adminUsersApi.js`
  - Missing API base is now allowed only in local dev (relative `/api` use case), still blocked in non-dev.
- Backend queue 400 diagnostics:
  - `backend/src/controllers/appointmentsQueueController.js`
  - Structured bad-request JSON added:
    - `{ ok: false, error: "Bad Request", message, details }`
  - Validation improved for:
    - `date` format (`YYYY-MM-DD`)
    - `branch_id` format (uuid)
  - `limit` normalization improved:
    - invalid/non-positive -> default applied with warning
    - over max -> capped with warning
    - warning returned in `meta.warnings`.
- Env/doc updates:
  - `.env.example`, `.env.development`, `.env.staging`, `.env.production`
  - `README.md` Environment section now clarifies static URL vs backend URL and optional rewrite mode.

### Render checklist (production)
- Static site service env:
  - `VITE_API_BASE_URL=https://<your-backend-service>.onrender.com`
  - `VITE_ALLOW_SAME_ORIGIN_API=false` (default; set `true` only with intentional rewrite)
- Backend service env:
  - `FRONTEND_ORIGIN=https://scglamliff-reception-1.onrender.com`
  - Optional additional origins via `FRONTEND_ORIGINS` (comma-separated), e.g. local dev origin.
- Optional single-domain rewrite mode (only if intentionally used):
  - Render Static Rewrite: `/api/*` -> `https://<your-backend-service>.onrender.com/api/:splat`
  - Set `VITE_ALLOW_SAME_ORIGIN_API=true`.

### Verification commands and expected result
```bash
# Backend
cd backend
npm ci
npm run dev

# Frontend
cd ..
npm ci
npm run dev
```

```bash
# Queue endpoint check (requires auth/session)
curl -i "https://<your-backend-service>.onrender.com/api/appointments/queue?limit=50"
```

```bash
# Example invalid query check (should return structured 400 JSON)
curl -i "https://<your-backend-service>.onrender.com/api/appointments/queue?date=2026-99-99&limit=50"
```

- Browser Network pass criteria:
  - Queue request host is backend service host (not static host), unless rewrite mode is intentionally configured.
  - Error body includes JSON `message/details` for invalid params.

### Local command result in this session
- `npm ci` (repo root) failed with:
  - `EPERM: operation not permitted, unlink ...\\node_modules\\@rollup\\rollup-win32-x64-msvc\\rollup.win32-x64-msvc.node`
  - likely local file lock by active process/AV; aligns with existing `BLUNDER.md` note.
- `npm run build` (repo root) failed with:
  - `'vite' is not recognized as an internal or external command`
- Interpretation: local dependencies are not currently installed in this shell session; run `npm ci` before build verification.

## 2026-02-13 16:26:32 +07:00 — Queue status visibility + Thai labels + deduction policy

### Change summary
- Queue rows are now never filtered out by status on backend.
- Queue status labels were made explicit in Thai to prevent accidental collapse into "ยกเลิก".
- Course deduction policy is documented in backend status handler:
  - `completed` => deducts course via package usage flow
  - `no_show` => status only, no deduction
  - `cancelled` => status only, no deduction

### Files changed
- `backend/src/controllers/appointmentsQueueController.js`
  - Removed status-based exclusion filter in queue query builder.
- `backend/src/controllers/appointmentServiceController.js`
  - Added policy comment near status-only mutation function.
- `src/pages/booking/utils/bookingPageFormatters.js`
  - Updated `formatAppointmentStatus` mapping:
    - `completed` -> `ให้บริการแล้ว`
    - `no_show` -> `ลูกค้าไม่มารับบริการ`
    - `cancelled/canceled` -> `ยกเลิกการจอง`
    - `ensured/confirmed` -> `ยืนยันแล้ว`
    - `pending` -> `รอยืนยัน`
    - unknown -> `ไม่ทราบสถานะ (<raw>)`
- `src/pages/booking/utils/bookingPageFormatters.test.js`
  - Added unit tests for status mapping.

### Test execution note
- Attempted to run:
  - `npm run test:run -- src/pages/booking/utils/bookingPageFormatters.test.js`
- Local run failed in this shell because `vitest` binary is not currently available (`'vitest' is not recognized...`), consistent with earlier local dependency-install issues.

### Verification steps
1. Open queue table.
2. Mark one row as `no_show`.
3. Confirm row still visible with label `ลูกค้าไม่มารับบริการ`.
4. Mark one row as `cancelled`.
5. Confirm row still visible with label `ยกเลิกการจอง`.
6. Mark one row as `completed`.
7. Confirm row still visible with label `ให้บริการแล้ว` and package usage/course deduction follows completed flow.

## 2026-02-13 16:50:27 +07:00 — Revert support expanded for `no_show` + `cancelled/canceled`

### What changed
- Expanded revert support in service modal and backend so admin/owner can revert these statuses back to the same target used by existing revert flow (`booked`):
  - `completed` -> `booked` (existing flow retained)
  - `no_show` -> `booked` (new)
  - `cancelled` / `canceled` -> `booked` (new)
- Queue visibility policy remains unchanged: rows stay visible regardless of status.

### Files changed
- `src/components/ServiceConfirmationModal.jsx`
  - Added `isRevertableStatus` helper and expanded `canRevert` condition.
  - Revert button now shows for `completed/no_show/cancelled/canceled` with Thai label: `ย้อนกลับเป็นสถานะจอง/ยืนยันแล้ว`.
  - Added confirm dialog before revert and inline success/error feedback.
  - Updated modal status Thai labels to avoid ambiguous wording.
- `src/components/ServiceConfirmationModal.css`
  - Added `.scm-state--success` style for inline success feedback.
- `src/utils/appointmentsApi.js`
  - Added structured API error builder and wired appointment action path to surface backend status/message/details more clearly.
- `backend/src/controllers/appointmentServiceController.js`
  - Added allowed revert source statuses (`completed`, `no_show`, `cancelled`, `canceled`).
  - Revert now performs status-only revert for `no_show/cancelled/canceled` (no package usage mutation).
  - For `completed`, keeps usage-undo behavior when usage record exists.
- `src/components/ServiceConfirmationModal.test.jsx`
  - Added unit tests for allowed revert status transitions.

### Verification checklist (manual)
1. Set an appointment to `no_show` in modal, then click revert.
2. Confirm row remains in queue and status returns to `จองแล้ว`/target revert status.
3. Set an appointment to `cancelled`, then click revert.
4. Confirm row remains in queue and status returns to `จองแล้ว`/target revert status.
5. Set an appointment to `completed`, then click revert.
6. Confirm revert still works and completed usage rollback behavior remains consistent with existing flow.

### Local command note
- Attempted to run targeted tests:
  - `npm run test:run -- src/components/ServiceConfirmationModal.test.jsx`
- Result in this shell: failed because `vitest` command is not currently available (`'vitest' is not recognized...`).

## 2026-02-13 17:11:50 +07:00 — Safe E2E test-data isolation (UI filter + guarded cleanup tool)

### Problem observed
- Booking queue/customer lists were polluted by automated test records (`e2e_*`, `verify-*`), making production UI noisy.
- Source is API-backed data (not hardcoded):
  - Queue: `GET /api/appointments/queue` (`rows` -> `QueuePanel`/`QueueTable`)
  - Customers: `GET /api/customers` (`rows` -> `CustomerTable`)

### Safe changes implemented
- Added shared conservative matcher at `src/utils/isTestRecord.js`:
  - allowlist markers only: `^e2e_`, `^e2e_workflow_`, `^verify-` (case-insensitive)
  - exports: `isE2EName`, `isTestRecord`, `shouldHideTestRecordsByDefault`
- Added UI toggles (non-invasive) in both queue and customer views:
  - label: `แสดงข้อมูลทดสอบ (E2E)`
  - production default: hidden (`import.meta.env.PROD`)
  - can override with env: `VITE_HIDE_E2E_RECORDS=true|false`
- Real business logic/status handling remains unchanged.
- Added env placeholders for this flag in `.env.example`, `.env.development`, `.env.staging`, `.env.production`.

### Optional cleanup tool (guarded)
- Added `backend/scripts/cleanup-e2e-data.js` (+ backend script `cleanup:e2e`).
- Safety behavior:
  - dry-run by default (no DB modifications)
  - strict allowlist only (`^e2e_`, `^e2e_workflow_`, `^verify-`)
  - prints only counts + sample IDs (max 10), no secrets/no full PII dump
  - actual deletion only when `CLEANUP_E2E_CONFIRM=true`
- Cleanup targets only matched records and dependencies in safe order (children first).

### How to run cleanup tool
```bash
cd backend
node scripts/cleanup-e2e-data.js
```
( dry run by default )

```bash
cd backend
CLEANUP_E2E_CONFIRM=true node scripts/cleanup-e2e-data.js
```
( executes deletion only for allowlist-matched IDs )

### Safety note
- Tool never performs broad deletes; it only acts on records matched by the allowlist prefixes above.

## 2026-02-13 17:27:07 +07:00 — Homepage E2E visibility filter applied

- Added the same E2E visibility control to `Homepage` table view (workbench home).
- `Homepage.jsx` now filters rows through `isTestRecord` with the same default policy:
  - hide in production by default
  - toggle available to show test data when needed
- Added a compact toggle UI in `AppointmentsTablePanel`:
  - `แสดงข้อมูลทดสอบ (E2E)`
  - shows hidden count when test data is hidden.
- Styling added in `WorkbenchPage.css` under `.table-e2e-toggle`.

## 2026-02-13 17:59:49 +07:00 — Home auto-sync on focus/visibility + return to Home tab

### What changed
- Updated `src/pages/workbench/useAppointments.js` to auto-refetch queue data when:
  - window gains focus
  - document becomes visible (`visibilitychange` -> `visible`)
- Added throttle guard (2.5s) to prevent spam refetch from repeated focus/visibility events.
- Kept race safety via existing request-id stale-response protection in `reloadAppointments`.
- Added `refetch()` return from `useAppointments` for on-demand refresh.
- Updated `src/pages/WorkbenchPage.jsx` to call `refetch()` when user switches back to Home tab.

### Behavior kept intentionally
- Existing fetch-on-mount and fetch-on-dependency-change behavior remains.
- Home query limit remains `50` (no change).

### How to verify
1. Open Home tab and note a row/status.
2. Switch to Booking tab; perform an action (complete/no_show/cancel/revert or create/update booking).
3. Switch back to Home tab.
4. Expected: Home refetches automatically and shows updated rows/status within ~0–1s.
5. Optional: switch browser tab away and back (focus/visibility); Home should refetch again (throttled to avoid rapid repeats).

## 2026-02-18 12:10:00 +07:00 — SSOT alignment for staff/contact + hard-fail on missing staff

### What changed
- Enforced one resolver for appointment identity fields (phone, email/line, staff) across:
  - `GET /api/appointments/queue`
  - `GET /api/admin/appointments/:appointmentId`
  - `GET /api/visits?source=appointments`
- Source of truth is now strictly appointments/events + customer_identities (no sheet fallback in queue).
- Queue fallback mode to legacy sheet rows was removed.
- Added hard-fail behavior:
  - if resolved SSOT staff is missing in queue/admin detail/visits(appointments source), endpoint returns `500` with `code=SSOT_STAFF_MISSING`.
- Added write-time event validation requiring `meta.staff_name` or `meta.staff_id` for all appointment event inserts.

### Files changed
- Added shared resolver + guard:
  - `backend/src/services/appointmentIdentitySql.js`
  - `backend/src/services/appointmentEventStaffGuard.js`
- Updated controllers:
  - `backend/src/controllers/appointmentsQueueController.js`
  - `backend/src/controllers/adminAppointmentsController.js`
  - `backend/src/controllers/appointmentServiceController.js`
  - `backend/src/controllers/staffCreateAppointmentController.js`
  - `backend/src/controllers/visitsController.js`
- Added data-hygiene report script:
  - `backend/scripts/report_ssot_mismatches.js`
  - `backend/package.json` script: `report:ssot-mismatches`
- Added E2E parity tests:
  - `tests/e2e/specs/08_ssot_consistency.spec.ts`

### Watch-outs
- Because fallback was removed, data issues now fail fast instead of being masked.
- If production has records without resolvable SSOT staff, queue/admin detail will return `500` until records are fixed.
- Use:
  - `cd backend && npm run report:ssot-mismatches`
  to inspect legacy-vs-SSOT mismatches before/after backfill.
<!-- ===== END legacy: PROJECT_DIARY.md ===== -->

<!-- ===== BEGIN legacy: MIGRATION.md ===== -->
<!-- source_path: C:\Users\scgro\Desktop\Webapp training project\scGlamLiff-reception\MIGRATION.md -->
<!-- captured_at: 2026-03-04T08:32:16.4068977+07:00 -->
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

<!-- ===== END legacy: MIGRATION.md ===== -->

<!-- ===== BEGIN legacy: diary.md ===== -->
<!-- source_path: C:\Users\scgro\Desktop\Webapp training project\scGlamLiff-reception\diary.md -->
<!-- captured_at: 2026-03-04T08:32:16.4068977+07:00 -->
# Diary

## 2026-02-24 - Course Continuity via `customer_packages.status`

- Kept appointment statuses unchanged (`booked`, `rescheduled`, `completed`, `cancelled`, `no_show`).
- Implemented course continuity as package state transitions:
  - Complete flow: deduct usage once, recompute remaining, and set package `active -> completed` when remaining reaches 0.
  - Revert flow: restore usage, recompute remaining, and set package `completed -> active` when remaining becomes > 0.
- Added idempotent complete behavior for already `completed` appointments to avoid double deduction.
- Returned updated package snapshot (`status`, `used/total`, `remaining`) in complete response payload.
- Added queue-level best-effort flag/badge data for continuous courses and rendered badge in booking queue UI.
- Added modal UI badge `คอร์สต่อเนื่อง` and helper text for completed appointments:
  - `รายการนี้ตัดแล้ว ต้องนัดใหม่สำหรับครั้งถัดไป`
- Added backend guard tests for continuity rules in `backend/src/services/packageContinuity.test.js`.

## 2026-02-24 - Confirm disabled guard adjustment

- Updated service mutation status guard (frontend + backend) to allow `ensured` / `confirmed` in addition to `booked` / `rescheduled`.
- Kept `completed` blocked for re-confirm to prevent double deduction on the same appointment.
- Added frontend unit test coverage for status mutability in `src/components/ServiceConfirmationModal.test.jsx`.

## 2026-03-04 - Incident analysis: booking save failed (09:44-09:55, +07)

- Observed symptom:
  - Staff reported booking action failed with a message equivalent to `บันทึกการจองไม่สำเร็จ` around `09:44`.
  - Booking flow returned to normal at `09:55` on the same day (about `11` minutes later).
  - Related request-log snippet: `clientIP=125.25.47.101 requestID=f25eaab4-7216-4e87 responseTimeMS=289 responseBytes=451 userAgent=Edge/145`.
- Most likely cause:
  - Temporary upstream/platform issue (reverse proxy/backend instance/database connectivity blip) during `POST /api/appointments`.
  - Reasoning: issue recovered automatically without code change, and response size pattern looks more like transient edge/gateway/app error response than normal success payload.
- Other plausible causes (lower confidence):
  - Short-lived database write failure/lock/connection pressure on the booking transaction path.
  - Temporary auth/cookie issue on the affected client session (`401`) and then recovered after session refresh.
  - Slot collision (`409`) for a specific time, though this usually affects only one slot, not a short outage window.
- Evidence limitation:
  - The provided log line does not include HTTP method, path, or status code, so this remains a best-effort root-cause hypothesis, not a confirmed RCA.
<!-- ===== END legacy: diary.md ===== -->

<!-- ===== BEGIN legacy: BLUNDER.md ===== -->
<!-- source_path: C:\Users\scgro\Desktop\Webapp training project\scGlamLiff-reception\BLUNDER.md -->
<!-- captured_at: 2026-03-04T08:32:16.4068977+07:00 -->
# Blunder Log

## 2026-02-13 14:00 +07:00 — `npm ci` blocked by local file locks
- Step: validate reproducible install with `npm ci`
- Expected: clean reinstall using `package-lock.json`
- Actual: `EPERM` unlink errors on locked binaries (for example `esbuild.exe`, `rollup.win32-x64-msvc.node`)
- Cause hypothesis: active local Node/Vite/backend processes still holding handles in `node_modules`
- Suggested fix:
  1. stop local dev/test Node processes
  2. retry `npm ci`
  3. if needed, run terminal with elevated permissions and exclude workspace from aggressive AV scanning
<!-- ===== END legacy: BLUNDER.md ===== -->
