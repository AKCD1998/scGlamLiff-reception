# scGlamLiff Backend Structure

Generated: 2026-05-10

This document is read-only migration inventory for moving the scGlamLiff reception backend into a shared web service. It intentionally lists environment variable names only. No secret values were copied.

## Executive Summary

The repo is a Vite React frontend with two backend folders:

- `backend/`: the active scGlamLiff reception backend, implemented as an ESM Express 4 app with PostgreSQL, cookie-based staff JWT auth, LIFF static hosting, receipt upload/OCR-adjacent routes, Google Apps Script integration, LINE LIFF identity checks, and migration/maintenance scripts.
- `server/`: a deprecated CommonJS Google Apps Script proxy with only `/api/appointments` GET/POST behavior.

For shared-service migration, the active backend should be isolated as a project module under a namespace such as `/api/scglamliff`. The deprecated `server/` proxy should not be migrated unless there is a confirmed dependency on it.

## Safety Findings

- P0: `DATABASE_URL` and `JWT_SECRET` are generic backend variables and collide with the shared target backend. The migrated module must use project-scoped names such as `SCGLAMLIFF_DATABASE_URL` and `SCGLAMLIFF_JWT_SECRET`.
- P0: local backend `.env` files exist and include live-looking secret values. Do not copy values into docs, code, tests, commits, screenshots, or chat.
- P0: `backend/src/db.js` creates a PostgreSQL pool at import time and throws when `DATABASE_URL` is unset. This must be changed during integration so tests/imports cannot accidentally connect to the shared or production database.
- P0: database migration scripts exist and must not be run automatically. A backup and explicit user confirmation are required before any database mutation.
- P1: the backend uses cookie JWT auth with a cookie named `token`. In a shared service this can collide with other modules if paths/domains overlap. Use a project-scoped cookie name or a project-specific auth boundary during integration.
- P1: receipt upload uses multer memory storage with a 10 MB limit and can write to local disk or Cloudflare R2. Storage behavior must be reviewed before enabling this route in the shared service.
- P1: a separate Python OCR service exists under `backend/services/ocr_python`. Keep it separate from the HTTP migration unless explicitly approved.
- P1: some destructive appointment routes are not protected by `requireAuth` in the route file and need careful review before exposing them under the shared service.

See `ENV_VAR_COLLISION_AUDIT.md` for the env collision report.

## Package Manager And Runtime

- Package manager: npm, with `package-lock.json` files.
- Source frontend runtime: Vite React, ESM, Node `^20.19.0 || >=22.12.0`, npm `>=10`.
- Active backend runtime: `backend/package.json`, ESM, Express 4, Node `^20.19.0 || >=22.12.0`, npm `>=10`.
- Deprecated proxy runtime: `server/package.json`, CommonJS, Express 4.

Important source scripts:

- root: `dev`, `dev:backend`, `dev:local:stack`, `build`, `test`, `test:e2e`, `test:all`
- backend: `start`, `dev`, `test`, `seed:admin`, `seed:user`, `cleanup:e2e`, `migrate:*`, `verify:*`, `backfill:*`, `fix:*`
- server: `start`

## Active Backend Entry Points

- `backend/server.js`: production start entry. Imports `createApp`, imports `query`, starts the HTTP server, and logs required PostgreSQL table presence.
- `backend/src/app.js`: Express app factory. Configures CORS for `/api`, JSON parsing, `cookie-parser`, receipt upload static serving, API routes, LIFF static hosting, and error handlers.
- `backend/src/db.js`: PostgreSQL pool and query helper. Currently reads `DATABASE_URL` and `PGSSLMODE` directly.

## Folder And File Map

- `backend/src/app.js`: Express app setup, route mounting, CORS, LIFF static hosting.
- `backend/src/db.js`: PostgreSQL pool.
- `backend/src/routes/`: API routers.
- `backend/src/controllers/`: route handlers and business flow orchestration.
- `backend/src/services/`: PostgreSQL-backed services, Google Apps Script client, LINE LIFF identity, OCR/receipt upload storage.
- `backend/src/middlewares/`: auth, admin guard, legacy-sheet guard, branch-device guard tracing, receipt upload middleware, error handlers.
- `backend/src/utils/`: auth cookie helpers, branch contract helpers, treatment/package helpers.
- `backend/src/config/`: LIFF frontend static hosting config.
- `backend/scripts/`: seed, migration, verification, cleanup, backfill, and repair scripts.
- `backend/scripts/sql/`: manual SQL guardrail scripts.
- `backend/services/ocr_python/`: separate FastAPI OCR service.
- `backend/public/liff/`: built LIFF frontend assets served by the backend.
- `server/`: deprecated Google Apps Script proxy.
- `src/`: Vite React frontend.

## API Route Summary

Current active routes are mounted under `/api` in `backend/src/app.js`.

| Current route | Method(s) | Auth | Notes |
|---|---:|---|---|
| `/api/health` | GET | Public | Basic health response. |
| `/api/auth/login` | POST | Public | Staff login; sets JWT cookie. |
| `/api/auth/me` | GET | Staff cookie | Reads staff user from PostgreSQL. |
| `/api/auth/logout` | POST | Public | Clears auth cookie. |
| `/api/appointments` | GET | Public in route file | Lists appointments. |
| `/api/appointments` | POST | Staff cookie | Creates staff appointment. |
| `/api/appointments/queue` | GET | Staff cookie | Workbench queue. |
| `/api/appointments/booking-options` | GET | Staff cookie | Treatment/package options. |
| `/api/appointments/calendar-days` | GET | Staff cookie | Calendar availability counts. |
| `/api/appointments/from-sheet/:sheetUuid/ensure` | POST | Staff admin | Ensures appointment from sheet row. |
| `/api/appointments/admin/backdate` | POST | Staff admin | Backdate admin operation. |
| `/api/appointments/delete-hard` | POST | Not protected in route file | Destructive route; review before migration. |
| `/api/appointments/:id` | DELETE | Not protected in route file | Soft delete route; review before migration. |
| `/api/appointments/:id/complete` | POST | Staff cookie | Complete appointment. |
| `/api/appointments/:id/cancel` | POST | Staff cookie | Cancel appointment. |
| `/api/appointments/:id/no-show` | POST | Staff cookie | Mark no-show. |
| `/api/appointments/:id/revert` | POST | Staff cookie | Revert status. |
| `/api/appointments/:id/sync-course` | POST | Staff cookie | Sync course/package usage. |
| `/api/appointment-drafts` | GET/POST | Staff cookie | Draft creation/listing. |
| `/api/appointment-drafts/:id` | GET/PATCH | Staff cookie | Draft read/update. |
| `/api/appointment-drafts/:id/submit` | POST | Staff cookie | Draft submission. |
| `/api/admin/appointments/:appointmentId` | GET/PATCH | Staff admin | Admin appointment edit. |
| `/api/admin/staff-users` | GET/POST | Staff admin | Staff user admin. |
| `/api/admin/staff-users/:id` | PATCH | Staff admin | Staff user update. |
| `/api/branch-device-registrations/me` | GET | Branch-device flow | Current device registration. |
| `/api/branch-device-registrations` | POST | Cookie or explicit staff credentials | Register/update branch device. |
| `/api/branch-device-registrations` | GET | Staff cookie | List registrations. |
| `/api/branch-device-registrations/:id` | PATCH | Staff cookie | Update registration. |
| `/api/reporting/kpi-dashboard` | GET | Staff cookie | KPI dashboard. |
| `/api/ocr/health` | GET | Public in route file | Receipt upload/OCR-adjacent health. |
| `/api/ocr/receipt` | POST | Public in route file | Multer receipt upload; review before migration. |
| `/api/customers` | GET | Public in route file | Customer list/search. |
| `/api/customers/:customerId/profile` | GET | Public in route file | Customer profile. |
| `/api/visits` | GET/POST | Staff cookie + legacy-sheet guard | Legacy sheet visits. |
| `/api/sheet-visits/:sheetUuid/delete` | POST | Staff cookie + legacy-sheet guard | Sheet visit deletion. |
| `/api/debug/appointment/:id/status` | GET | Staff admin, non-production only | Debug route. |

Target namespace recommendation:

- New base: `/api/scglamliff`
- Example mapping: `/api/auth/login` -> `/api/scglamliff/auth/login`
- Example mapping: `/api/appointments` -> `/api/scglamliff/appointments`
- Example mapping: `/api/ocr/receipt` -> `/api/scglamliff/ocr/receipt`, only after upload/storage review.

## Database And Migration Summary

The active backend uses PostgreSQL through `pg`.

Required tables checked at startup:

- `appointments`
- `customers`
- `treatments`
- `sheet_visits_raw`
- `customer_identities`
- `appointment_events`

Migration and maintenance scripts exist under `backend/scripts/`, including appointment events constraints, appointment addons, appointment drafts, appointment receipts, appointment receipt uploads, LIFF receipt promo treatment, branch device registrations, treatment catalog fields, sheet soft delete, backfills, repair scripts, and seed scripts.

Some services create tables or indexes lazily from application code:

- appointment drafts
- appointment receipts
- appointment receipt uploads

Integration rule: the migrated module must not fall back to the shared `DATABASE_URL`. It must require `SCGLAMLIFF_DATABASE_URL` and refuse to boot if unset. No migrations or data-repair scripts should run without a fresh backup and explicit approval.

## Environment Variable Summary

Names observed in active backend code and scripts:

- Runtime: `PORT`, `NODE_ENV`, `PGSSLMODE`
- Database: `DATABASE_URL`
- Auth/session: `JWT_SECRET`, `COOKIE_SAMESITE`, `COOKIE_SECURE`, `COOKIE_DOMAIN`
- CORS/frontend: `FRONTEND_ORIGIN`, `FRONTEND_ORIGINS`
- LIFF: `LINE_LIFF_CHANNEL_ID`, `LINE_CHANNEL_ID`, `LIFF_FRONTEND_DIST_DIR`
- Google Apps Script: `GAS_APPOINTMENTS_URL`, `GAS_SECRET`
- Branch/sheet behavior: `DEFAULT_BRANCH_ID`, `LEGACY_SHEET_MODE`, `PIN_FINGERPRINT_SECRET`
- Receipt upload/R2: `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_KEY_PREFIX`, `R2_PUBLIC_BASE_URL`, `RECEIPT_UPLOAD_STORAGE_DIR`, `RECEIPT_UPLOAD_PUBLIC_BASE_URL`
- Admin/seed scripts: `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME`, `SEED_USERNAME`, `SEED_PASSWORD`, `SEED_DISPLAY_NAME`, `SEED_ROLE`
- Verification/debug scripts: `API_BASE_URL`, `VERIFY_API_BASE`, `AUTH_COOKIE`, `AUTH_BEARER`, `BEARER_TOKEN`, `APPOINTMENT_IDS`, `CLEANUP_E2E_CONFIRM`
- Debug flags: `DEBUG_QUEUE_PHONE_FRAGMENT`, `DEBUG_TREATMENT_CATALOG_PREVIEW`

Frontend build variables observed:

- `VITE_API_BASE_URL`
- `VITE_API_BASE`
- `VITE_ALLOW_SAME_ORIGIN_API`
- `VITE_LOG_API_BASE`
- `VITE_HIDE_E2E_RECORDS`
- `VITE_DEBUG_TREATMENT_CATALOG`

Recommended shared-service names:

- `SCGLAMLIFF_DATABASE_URL`
- `SCGLAMLIFF_JWT_SECRET`
- `SCGLAMLIFF_COOKIE_NAME`
- `SCGLAMLIFF_COOKIE_SAMESITE`
- `SCGLAMLIFF_COOKIE_SECURE`
- `SCGLAMLIFF_COOKIE_DOMAIN`
- `SCGLAMLIFF_LINE_LIFF_CHANNEL_ID`
- `SCGLAMLIFF_GAS_APPOINTMENTS_URL`
- `SCGLAMLIFF_GAS_SECRET`
- `SCGLAMLIFF_DEFAULT_BRANCH_ID`
- `SCGLAMLIFF_LEGACY_SHEET_MODE`
- `SCGLAMLIFF_PIN_FINGERPRINT_SECRET`
- `SCGLAMLIFF_R2_BUCKET`
- `SCGLAMLIFF_R2_ACCESS_KEY_ID`
- `SCGLAMLIFF_R2_SECRET_ACCESS_KEY`
- `SCGLAMLIFF_R2_ENDPOINT`
- `SCGLAMLIFF_R2_KEY_PREFIX`
- `SCGLAMLIFF_R2_PUBLIC_BASE_URL`
- `SCGLAMLIFF_RECEIPT_UPLOAD_STORAGE_DIR`
- `SCGLAMLIFF_RECEIPT_UPLOAD_PUBLIC_BASE_URL`
- `VITE_SCGLAMLIFF_API_BASE_URL`
- `VITE_SCGLAMLIFF_API_PREFIX`

## Deployment Files And Hosting Notes

- No source `render.yaml` was found in this scan.
- The source frontend uses Vite env files and points API calls at the backend base URL plus hard-coded `/api/...` paths.
- `backend/public/liff/` contains built LIFF frontend assets that the backend can serve under `/liff`.
- The target shared backend currently uses CommonJS and Express 5; this source backend uses ESM and Express 4. The integration should use a lazy CommonJS wrapper with dynamic import or convert the module carefully without changing behavior.

## Risks Or Unclear Areas

- The prompt included stale text naming ReactNJobApplicWeb. This inventory treats `scGlamLiff-reception` as the source project.
- Cookie auth uses a generic cookie name, `token`; namespace isolation should include cookie isolation.
- JWT tokens do not appear to include a project audience claim. Shared-service migration should add project-scoped verification behavior or avoid accepting global target tokens.
- The route paths are currently hard-coded under `/api`. Integration must convert the route mount layer so the target path is `/api/scglamliff/...`, not `/api/scglamliff/api/...`.
- Several routes are public in the route file and may write/read sensitive data. Confirm whether this is intentional before exposing them from the shared backend.
- Receipt upload can write to disk or R2. Render disk persistence and Cloudflare R2 env must be reviewed before enabling uploads.
- The Python OCR service is separate and should not be bundled into the target shared Node service automatically.
- The app has schema-changing scripts and lazy table creation. Shared-service boot must not accidentally run migrations or write to the wrong database.

## Notes For Migration Into Shared Main Web Service

1. Use `/api/scglamliff` as the namespace.
2. Copy active backend code into `backend/src/modules/scglamliff/` in the target repo only after approval.
3. Add a project env adapter that maps `SCGLAMLIFF_*` names to module config and forbids fallback to target `DATABASE_URL` or `JWT_SECRET`.
4. Export a router/app factory that mounts relative route paths under the namespace.
5. Add a CommonJS lazy router wrapper for the target Express 5 server.
6. Keep the deprecated `server/` proxy out of the migration unless a current production dependency is proven.
7. Keep `backend/services/ocr_python/` out of the first shared Node service migration.
8. Add target smoke tests for `/api/health`, existing shared routes, and `/api/scglamliff/health`.
9. Do not mutate Render, run migrations, suspend services, or delete old services without the explicit service-ID confirmation gate.
