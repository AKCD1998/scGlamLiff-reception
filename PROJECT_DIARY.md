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
