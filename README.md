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

### Env files
- `.env.example`: variable names only (template)
- `.env.development`: local-safe defaults
- `.env.staging`: staging placeholders
- `.env.production`: production placeholders

### Frontend env vars
- `VITE_API_BASE_URL`: backend base URL used by frontend API clients
- `VITE_API_BASE`: legacy alias (optional)
- `VITE_LOG_API_BASE`: optional API base logging in browser console
- `VITE_APPOINTMENTS_GAS_URL`: optional integration URL
- `VITE_APPOINTMENTS_GAS_KEY`: optional integration key

## Local Development (FE + BE)
1. Prepare backend env locally in `backend/.env` (do not commit secrets).
2. Start backend:

```bash
cd backend
npm ci
npm run dev
```

3. Start frontend (repo root):

```bash
npm ci
npm run dev
```

Default local FE/BE pairing from `.env.development`:
- Frontend: `http://localhost:5173`
- API base: `http://localhost:5050`

## Choose env per stage (no hardcoding)
- Dev: `npm run dev -- --mode development`
- Staging build: `npm run build -- --mode staging`
- Production build: `npm run build -- --mode production`

Set environment values in CI/hosting platform instead of hardcoding URLs in source.

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
