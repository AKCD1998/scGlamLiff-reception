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
- `LIFF_FRONTEND_DIST_DIR` to point Express at a built LIFF frontend bundle for same-origin hosting under `/liff/`

### Cross-site auth (GitHub Pages / Render)
If your frontend is hosted on a different origin (e.g. GitHub Pages) and the API is on Render, set:
- `NODE_ENV=production`
- `FRONTEND_ORIGINS=https://akcd1998.github.io` (use your exact origin)
- `COOKIE_SAMESITE=none`
- `COOKIE_SECURE=true`

### Same-origin LIFF hosting
If you want the LIFF frontend to be served by this backend at `https://<backend-host>/liff/`, provide a built frontend bundle that contains `index.html`.

Resolution order:
- `LIFF_FRONTEND_DIST_DIR`
- `backend/public/liff`
- local sibling workspace `../../scGlamLiFFF/scGlamLiFF/dist`

Notes:
- `/api/*` routes still take priority over the LIFF SPA shell.
- CORS now applies only to `/api/*`. The backend-hosted LIFF shell and its
  static assets under `/liff/*` are served without the API origin allowlist so
  same-origin module/script requests cannot fail with misleading CORS 500s.
- The current GitHub Pages LIFF build still emits `/ScGlamLiFF/assets/*` URLs, so the backend temporarily exposes a compatibility static alias for that asset path until the frontend build base is repointed to `/liff/`.

### Staged rollout plan for backend-hosted LIFF
Keep the existing GitHub Pages deployment during cutover. The backend-hosted LIFF can be deployed and verified first without removing the old static site.

Recommended order:
1. Build the LIFF frontend from the frontend repo with the backend-hosted defaults:
   - `VITE_PUBLIC_BASE_PATH=/liff/`
   - `VITE_API_BASE_URL=` (blank for same-origin `/api`)
   - `VITE_OCR_API_BASE_URL=` unless OCR must stay elsewhere intentionally
2. Copy the built LIFF files into `backend/public/liff/` in this repo, or point `LIFF_FRONTEND_DIST_DIR` at an equivalent built `dist/` directory during deploy.
3. Deploy the backend service only.
4. Verify before changing LINE:
   - `GET /api/health` still returns backend JSON
   - `GET /liff/` returns the LIFF shell
   - startup logs show `event:"liff_frontend_hosting"` with `enabled:true`
5. Update the LIFF endpoint in LINE Developers Console to `https://<backend-host>/liff/`.
6. Keep GitHub Pages and its workflow untouched as a rollback target until the backend-origin LIFF has been verified on real devices.

Rollback:
1. Point the LIFF endpoint back to the GitHub Pages URL.
2. Leave the backend static hosting code in place; it is safe to keep while rolling back the LIFF entrypoint.
3. Rebuild/redeploy GitHub Pages only if you need a newer frontend there.

Later cleanup, only after verification:
- remove the temporary `/ScGlamLiFF/*` asset compatibility alias
- retire GitHub Pages workflow/config if no longer needed
- simplify cross-origin-only env values if all LIFF traffic is same-origin

### Same-origin LIFF deployment and verification checklist
1. Build the LIFF frontend from the sibling frontend repo:
   ```powershell
   Set-Location "..\..\scGlamLiFFF\scGlamLiFF"
   npm ci
   npm run build
   ```
2. Publish the built files for backend hosting:
   - copy `..\..\scGlamLiFFF\scGlamLiFF\dist\*` into `backend\public\liff\`
   - or set `LIFF_FRONTEND_DIST_DIR` to a built `dist` directory that contains `index.html`
3. Deploy the backend service first. Do not change the LIFF endpoint in LINE yet.
4. Verify the backend-hosted frontend entrypoint in a browser:
   - open `https://<backend-host>/liff/`
   - confirm the LIFF shell loads
   - confirm `https://<backend-host>/api/health` still returns backend JSON
5. Watch Render backend logs for startup:
   - `[startup] {"event":"liff_frontend_hosting","enabled":true,...}`
   - if `enabled:false`, the backend cannot see a usable LIFF build yet
6. Test staff login on the backend-hosted LIFF entrypoint and verify backend auth logs:
   - expect `POST /api/auth/login` to return `200`
   - expect `[StaffAuth] {"event":"login_success","setCookieHeaderPresent":true,"setCookieCookieNames":["token"],...}`
7. Verify the cookie is now being sent back on the next session check:
   - expect `[StaffAuth] {"event":"auth_me_check","cookieHeaderPresent":true,"cookieNames":["token"],"parsedTokenPresent":true,...}`
   - then expect `auth_me_verified`
   - then expect `auth_me_success`
8. Verify the authenticated startup flow completes in LIFF:
   - the app should leave the startup gate
   - it should stop showing the staff login-required screen
   - it should open the authenticated LIFF UI normally
9. Only after those checks pass, update the LIFF endpoint in LINE Developers Console:
   - old: `https://akcd1998.github.io/ScGlamLiFF/`
   - new: `https://<backend-host>/liff/`
10. Keep GitHub Pages active as rollback safety until real-device verification is complete.

Rollback checklist:
1. In LINE Developers Console, point the LIFF endpoint back to `https://akcd1998.github.io/ScGlamLiFF/`
2. Re-open LIFF and confirm the GitHub Pages build loads again
3. Leave backend `/liff/` hosting in place while investigating; it does not need to be removed immediately
4. Only remove GitHub Pages or the temporary backend compatibility pieces after the backend-origin LIFF is stable

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
- The Python OCR source of truth now lives in this repo at `backend/services/ocr_python`.
- The old Python OCR copy in `scGlamLiFFF/scGlamLiFF/backend/services/ocr_python` is intentionally retained only as a temporary migration duplicate until deployment cutover is finished.
- Default backend expectation:
  - `OCR_SERVICE_BASE_URL=http://127.0.0.1:8001`
  - `OCR_SERVICE_ENABLED=true`
  - `OCR_SERVICE_FALLBACK_TO_MOCK=false`

### Render deployment
- This repo is intended to deploy as two separate Render services:
  - Node backend from `backend`
  - Python OCR backend from `backend/services/ocr_python`
- Full settings and post-deploy verification:
  - `backend/RENDER_DEPLOYMENT.md`

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
- `/api/ocr/health` now also reports:
  - `routeMounted`
  - `mountedBasePath`
  - `downstreamBaseUrl`
  - `downstreamHealthUrl`
  - `downstreamReceiptUrl`
  - `downstreamReachable`
  - `downstreamReceiptRouteReachable`
- startup logs now include:
  - `ocr_downstream_config`
  - `ocr_runtime_ready`

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
