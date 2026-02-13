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
