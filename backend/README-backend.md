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
