# scGlamLiff Backend Test Baseline

Generated: 2026-05-10

This document records the current backend test posture before integrating scGlamLiff into the shared service. It intentionally lists environment variable names only.

## Current Test Setup

The active backend already has a lightweight Node test suite using the built-in `node --test` runner.

Run from the repo root:

```powershell
npm --prefix backend test
```

Run from `backend/`:

```powershell
npm test
```

Current backend test files:

- `backend/src/app.liffHosting.test.js`
- `backend/src/routes/auth.test.js`
- `backend/src/services/appointmentReceiptEvidenceService.test.js`
- `backend/src/services/appointmentReceiptUploadService.test.js`
- `backend/src/services/adminAppointmentStatusService.test.js`
- `backend/src/services/appointmentAddonService.test.js`
- `backend/src/services/packageContinuity.test.js`
- `backend/src/services/appointmentDraftsService.test.js`
- `backend/src/services/lineLiffIdentityService.test.js`
- `backend/src/services/branchDeviceRegistrationsService.test.js`
- `backend/src/controllers/branchDeviceRegistrationsController.test.js`
- `backend/src/middlewares/branchDeviceRegistrationStaffAuth.test.js`
- `backend/src/services/staffAuthService.test.js`
- `backend/src/services/monthlyKpiDashboardService.test.js`
- `backend/src/utils/branchContract.test.js`
- `backend/src/utils/staffAuthSession.test.js`

The root frontend has Vitest and Playwright scripts, but those are separate from the backend baseline:

```powershell
npm test
npm run test:e2e
```

## What Existing Tests Cover

- LIFF static hosting path behavior.
- Auth route behavior.
- Staff auth session cookie options.
- Branch-device registration middleware, controller, and service behavior.
- LINE LIFF identity service behavior.
- Appointment receipt evidence and upload service behavior.
- Appointment drafts service behavior.
- Appointment add-on and package continuity behavior.
- Admin appointment status behavior.
- Monthly KPI dashboard service behavior.
- Branch contract utility behavior.

## What Is Not Covered Yet

- A shared-service namespace smoke test such as `GET /api/scglamliff/health`.
- A target Express 5 integration smoke test through `currentSC-official-website-project`.
- Import safety for the database layer when no test database is configured.
- A guard proving tests cannot connect to a production or shared Render database by accident.
- End-to-end smoke coverage of each mounted route under `/api/scglamliff`.
- CORS preflight behavior from the current scGlamLiff frontend origin to the shared backend.
- Cookie login behavior after moving from the old backend host to the shared backend host.
- Receipt upload behavior in the shared service runtime.
- Python OCR service behavior; it is separate from the Node backend migration.

## Required Baseline Before Target Integration

Before adding the module to the target repo, add or verify these tests:

1. `NODE_ENV=test` is set by the test command or test bootstrap.
2. Tests refuse to run if `DATABASE_URL` or `SCGLAMLIFF_DATABASE_URL` points at a non-local host unless an explicit allowlist is set.
3. `backend/src/db.js` import does not create a live production connection during tests.
4. `createApp()` or the future module router can be imported without a real database.
5. `GET /api/health` or the future `GET /api/scglamliff/health` returns an expected status and JSON shape.
6. Auth-protected routes return expected `401`/`403` status codes without fake success.
7. Public routes that perform writes or expose customer data are explicitly listed and reviewed.
8. Receipt upload route is either tested with mocked storage or left disabled until storage env is confirmed.

## Current Run Status

The existing backend test suite was not run during this first documentation pass because local backend `.env` files contain live-looking secret values and `backend/src/db.js` reads `DATABASE_URL` at import time. Running tests safely should happen after the database test guard is added or after the user confirms a safe local/test database.

## Routes To Smoke Test After Namespacing

Expected namespace: `/api/scglamliff`

- `GET /api/scglamliff/health` should return `200`.
- `GET /api/scglamliff/auth/me` without cookie should return `401`.
- `POST /api/scglamliff/auth/logout` should return a stable success response.
- `GET /api/scglamliff/appointments/queue` without cookie should return `401`.
- `GET /api/scglamliff/reporting/kpi-dashboard` without cookie should return `401`.
- `GET /api/scglamliff/ocr/health` should be tested only after receipt upload/storage behavior is approved.
- Destructive appointment routes should not be smoke-tested against a real database.

## Environment And Safety Requirements

- Do not use real user data in fixtures.
- Do not run seed, migration, cleanup, backfill, or repair scripts in tests.
- Do not use the shared target `DATABASE_URL` for scGlamLiff tests.
- Use `SCGLAMLIFF_DATABASE_URL` for the migrated module and require explicit test allowlisting.
- Use `SCGLAMLIFF_JWT_SECRET` for migrated auth tests.
- Keep cookie settings explicit when testing cross-origin browser behavior: `SameSite=None`, `Secure=true`, and no broad cookie domain unless intentionally required.

## Recommended Target Smoke Tests

Add tests in the target repo after plan approval:

- Existing target health endpoint still works.
- Existing target `/api/auth/ping` still works.
- Existing modules `/api/reactnjob`, `/api/rx1011`, and `/api/digitalpjk` remain mounted.
- New module `/api/scglamliff/health` is mounted.
- Auth-protected scGlamLiff routes return `401` without a valid scGlamLiff cookie.
- The module fails fast when `SCGLAMLIFF_DATABASE_URL` or `SCGLAMLIFF_JWT_SECRET` is missing, instead of falling back to shared env names.
