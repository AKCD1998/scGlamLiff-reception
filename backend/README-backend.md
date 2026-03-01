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
- `PORT` (defaults to 3001)
- `NODE_ENV=production` on Render
- `PGSSLMODE=disable` only if your DB does not require SSL
- `FRONTEND_ORIGIN` / `FRONTEND_ORIGINS` (comma-separated) for allowed CORS origins
- `COOKIE_SAMESITE` (`lax`, `strict`, or `none`) and `COOKIE_SECURE=true` for cross-site cookies

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

## API
- `POST /api/auth/login` { username, password }
- `GET /api/auth/me`
- `POST /api/auth/logout`

Responses:
- Success: `{ ok: true, data: ... }`
- Error: `{ ok: false, error: "..." }`

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

## Vite proxy note
Add this to `vite.config.js` on the frontend if you want `/api` to proxy to the backend:

```js
server: {
  proxy: {
    '/api': 'http://localhost:3001'
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
