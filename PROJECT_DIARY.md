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
