# Backend (Express + PostgreSQL)

## Overview
Minimal Node.js + Express backend for staff-only login with PostgreSQL, JWT (HttpOnly cookie), and CORS for local Vite.

## Setup (Windows PowerShell)
From repo root:

```powershell
# 1) Create backend folder (already created if you ran the scaffold)
New-Item -ItemType Directory -Force "backend"

# 2) Initialize npm
Set-Location "backend"
npm init -y

# 3) Install dependencies
npm install express pg bcrypt jsonwebtoken cookie-parser cors dotenv
npm install -D nodemon

# 4) Create env + gitignore
Copy-Item ".env.example" ".env"
```

## Configure env
Edit `backend/.env` and set a secure JWT secret and admin credentials.

Required:
- `DATABASE_URL`
- `JWT_SECRET`

Optional:
- `PORT` (defaults to 5050)
- `NODE_ENV=production` on Render
- `PGSSLMODE=disable` only if your DB does not require SSL
- `FRONTEND_ORIGIN` / `FRONTEND_ORIGINS` (comma-separated) for allowed CORS origins
- `COOKIE_SAMESITE` (`lax`, `strict`, or `none`) and `COOKIE_SECURE=true` for cross-site cookies
- `LINE_LIFF_CHANNEL_ID` (or `LINE_CHANNEL_ID`) for backend verification of LIFF `id_token` / `access_token`

### Cross-site auth (GitHub Pages / Render)
If your frontend is hosted on a different origin (e.g. GitHub Pages) and the API is on Render, set:
- `NODE_ENV=production`
- `FRONTEND_ORIGINS=https://akcd1998.github.io` (use your exact origin)
- `COOKIE_SAMESITE=none`
- `COOKIE_SECURE=true`

## Run (dev)
```powershell
npm run dev
```

## Seed admin (optional)
```powershell
npm run seed:admin
```

## Seed staff user (optional)
Set env vars in `backend/.env`:

```
SEED_USERNAME=staff01
SEED_PASSWORD=change_me
SEED_DISPLAY_NAME=Staff One
SEED_ROLE=staff
```

Run:

```powershell
node scripts/seed_user.js
```

## One-time migrations (optional)
Ensure `appointments.raw_sheet_uuid` is unique when present (helps prevent duplicate linkage to legacy sheet rows):

```powershell
node scripts/migrate_appointments_raw_sheet_uuid_unique.js
```

Create the branch-device registration table used for LIFF smartphone-to-branch binding:

```powershell
node scripts/migrate_branch_device_registrations.js
```

## API
- `POST /api/auth/login` { username, password }
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/reporting/kpi-dashboard?month=YYYY-MM` (authenticated, read-only KPI summary for all roles)
- `POST /api/branch-device-registrations` (authenticated registration/update)
- `GET /api/branch-device-registrations` (authenticated list)
- `GET /api/branch-device-registrations/me` (LIFF identity lookup)
- `PATCH /api/branch-device-registrations/:id` (authenticated patch)
- `GET /api/ocr/health` (OCR route/debug health)
- `POST /api/ocr/receipt` (receipt OCR upload for Bill Verification)

Responses:
- Success: `{ ok: true, data: ... }`
- Error: `{ ok: false, error: "..." }`

## Read-only KPI dashboard
- New reporting namespace: `/api/reporting`
- Current endpoint: `GET /api/reporting/kpi-dashboard?month=YYYY-MM`
- Auth model stays the same: existing cookie JWT via `/api/auth/login`
- Scope: read-only monthly meeting dashboard
- Query behavior: PostgreSQL summary queries only; no writes to business tables
- Transparent limitations:
  - free facial scan conversion: unavailable with current schema
  - product/skincare upsell conversion: unavailable with current schema
  - revenue mix service vs product: unavailable with current schema, only receipt total fallback is available

## Admin PATCH Status Rollback Behavior
- Endpoint: `PATCH /api/admin/appointments/:appointmentId`
- When admin patches status to a pre-service state (`booked`, `rescheduled`, `ensured`, `confirmed`, `check_in`, `checked_in`, `pending`), backend will automatically remove all `package_usages` rows for that `appointment_id` in the same DB transaction.
- Invariant: for pre-service status, `package_usages` for that appointment must be `0` after commit.
- When admin patches to `completed`, backend does not auto-create usage rows. It may return a warning if no usage exists so operators can use the proper complete/deduction flow.

### One-off consistency cleanup tool
Dry-run scan:

```powershell
npm run fix:booked-usage-consistency:dry
```

Apply cleanup (deletes usage rows for inconsistent pre-service appointments):

```powershell
npm run fix:booked-usage-consistency:apply
```

Optional SQL guardrail (manual run, not automatic):
- `backend/scripts/sql/2026-03-01_package_usages_unique_appointment.sql`

## OCR runtime note
- The active public OCR route is `POST /api/ocr/receipt` in this repo.
- Debug/verification route is `GET /api/ocr/health`.
- The current Python OCR runtime is still hosted in the sibling repo `scGlamLiFFF/scGlamLiFF/backend/services/ocr_python`.
- Default backend expectation:
  - `OCR_SERVICE_BASE_URL=http://127.0.0.1:8001`
  - `OCR_SERVICE_ENABLED=true`
  - `OCR_SERVICE_FALLBACK_TO_MOCK=false`

### OCR verification with curl
```bash
curl -i https://<your-backend-host>/api/ocr/health
```

```bash
curl -i -X POST https://<your-backend-host>/api/ocr/receipt
```

Expected deployment-safe checks:
- `/api/ocr/health` should return `200` with route/debug data even if downstream OCR is unreachable
- `/api/ocr/receipt` should return `400 OCR_IMAGE_REQUIRED` if the route is mounted but no file is sent

## Vite proxy note
Add this to `vite.config.js` on the frontend if you want `/api` to proxy to the backend:

```js
server: {
  proxy: {
    '/api': 'http://localhost:5050'
  }
}
```

## File tree
```
backend/
  middleware/
    requireAuth.js
  routes/
    auth.js
  scripts/
    seed_admin.js
  db.js
  server.js
  .env.example
  .gitignore
  package.json
```
