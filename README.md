# scGlamLiff Reception

Frontend (Vite + React) with backend API integration and E2E coverage.

## Runtime and Install
- Node is pinned via `.nvmrc`.
- Install dependencies with lockfile for reproducibility:

```bash
nvm use
npm ci
```

## Environment
This project uses `VITE_API_BASE_URL` as the primary frontend API base.
Legacy `VITE_API_BASE` is still supported as fallback for compatibility.
In production, the static frontend URL must not be used as API base unless `/api` rewrite is intentionally configured.

### Env files
- `.env.example`: variable names only (template)
- `.env.development`: local-safe defaults
- `.env.staging`: staging placeholders
- `.env.production`: production placeholders

### Frontend env vars
- `VITE_API_BASE_URL`: backend base URL used by frontend API clients
- `VITE_API_BASE`: legacy alias (optional)
- `VITE_ALLOW_SAME_ORIGIN_API`: set `true` only if static-site `/api/*` rewrite to backend is intentionally configured
- `VITE_LOG_API_BASE`: optional API base logging in browser console
- `VITE_APPOINTMENTS_GAS_URL`: optional integration URL
- `VITE_APPOINTMENTS_GAS_KEY`: optional integration key

### Render production rule
- Static site URL (example): `https://<frontend>.onrender.com`
- Backend web service URL (example): `https://<backend>.onrender.com`
- Set `VITE_API_BASE_URL` to the backend URL, not the static URL.
- If you intentionally use single-domain `/api` through Render Rewrite, set:
  - Rewrite: `/api/*` -> `https://<backend>.onrender.com/api/:splat`
  - `VITE_ALLOW_SAME_ORIGIN_API=true`

## Local Development (FE + BE)
1. Prepare backend env locally in `backend/.env` (do not commit secrets).
2. Install backend dependencies once:

```bash
cd backend
npm ci
cd ..
```

3. Start frontend + backend together (recommended):

```bash
npm run dev:local
```

If backend port `5050` is already occupied by a healthy local API, `dev:local` reuses that backend and starts frontend only.

4. Or start each service separately:

```bash
cd backend
npm run dev
```

```bash
npm run dev
```

5. Open frontend in browser:

```bash
http://localhost:5173
```

Default local FE/BE pairing from `.env.development`:
- Frontend: `http://localhost:5173`
- API base: `http://localhost:5050`

Notes:
- Backend CORS now allows localhost origins with any port in non-production mode (for example `5173`, `5174`, `4173`).
- Production mode (`NODE_ENV=production`) still uses explicit allowlist from `FRONTEND_ORIGIN` and `FRONTEND_ORIGINS`.

## Choose env per stage (no hardcoding)
- Dev: `npm run dev -- --mode development`
- Staging build: `npm run build -- --mode staging`
- Production build: `npm run build -- --mode production`

Set environment values in CI/hosting platform instead of hardcoding URLs in source.

## Queue endpoint notes
- Endpoint: `GET /api/appointments/queue?limit=50`
- Auth required: request uses cookie/session and returns `401` when not logged in.
- Invalid query params now return structured `400` JSON:
  - `{ error: "Bad Request", message: "...", details: { ... } }`

## Appointment consistency
- See `docs/appointment_data_consistency.md` for canonical endpoint/ID rules and verification steps.

## Tests
- Unit: `npm run test:run`
- E2E: `npm run test:e2e`
- Full suite: `npm run test:suite`

`test:suite` is the branch/PR standard command and exits non-zero on failures.

## CI
Workflow: `.github/workflows/ci.yml`
- Node: from `.nvmrc`
- Install: `npm ci`
- Test command: `npm run test:suite`
