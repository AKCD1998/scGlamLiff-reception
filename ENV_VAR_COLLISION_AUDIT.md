# Env Var Collision Audit

Values are intentionally omitted. This report lists env names only.

## Tooling Availability

- `dotenv-linter`: not found
- `gitleaks`: not found
- `trufflehog`: not found

## Repos Scanned

| Repo | Prefix | Path |
|---|---|---|
| `scGlamLiff-reception` | `SCGLAMLIFF` | `C:\Users\scgro\Desktop\Webapp training project\scGlamLiff-reception` |
| `currentSC-official-website-project` | `SC` | `C:\Users\scgro\Desktop\Webapp training project\currentSC-official-website-project` |

## Tracked Env Files

- **P0** `scGlamLiff-reception` tracks `.env.development`
- **P0** `scGlamLiff-reception` tracks `.env.production`
- **P0** `scGlamLiff-reception` tracks `.env.staging`

## Tracked Env Templates

- `scGlamLiff-reception` tracks template `.env.example`
- `currentSC-official-website-project` tracks template `backend/.env.example`

## Duplicate Keys Inside Env Files

- None detected.

## Duplicate Names Across Repos

| Severity | Name | Repos | Reason |
|---|---|---|---|
| Info | `BASE_URL` | `currentSC-official-website-project`, `scGlamLiff-reception` | Duplicate name found; verify runtime boundary |
| P0 | `DATABASE_URL` | `currentSC-official-website-project`, `scGlamLiff-reception` | Known dangerous backend secret/config name duplicated across repos |
| Info | `DEV` | `currentSC-official-website-project`, `scGlamLiff-reception` | Duplicate name found; verify runtime boundary |
| P0 | `JWT_SECRET` | `currentSC-official-website-project`, `scGlamLiff-reception` | Known dangerous backend secret/config name duplicated across repos |
| P2 | `NODE_ENV` | `currentSC-official-website-project`, `scGlamLiff-reception` | Common runtime config duplicated; verify shared-service behavior |
| P2 | `PORT` | `currentSC-official-website-project`, `scGlamLiff-reception` | Common runtime config duplicated; verify shared-service behavior |
| P2 | `VITE_API_BASE` | `currentSC-official-website-project`, `scGlamLiff-reception` | Generic frontend build variable duplicated across repos; safe only when build environments are separate |
| P2 | `VITE_API_BASE_URL` | `currentSC-official-website-project`, `scGlamLiff-reception` | Generic frontend build variable duplicated across repos; safe only when build environments are separate |

## Sample Occurrences

### `BASE_URL`

- `scGlamLiff-reception` `backend/.env:23` (env-file)
- `currentSC-official-website-project` `frontend-react/src/main.jsx:8` (import.meta.env)
- `currentSC-official-website-project` `frontend-react/src/routes/Home.jsx:11` (import.meta.env)

### `DATABASE_URL`

- `scGlamLiff-reception` `backend/.env:1` (env-file)
- `scGlamLiff-reception` `backend/server.js:61` (process.env)
- `currentSC-official-website-project` `backend/.env:4` (env-file)
- `currentSC-official-website-project` `backend/.env.example:3` (env-file)

### `DEV`

- `scGlamLiff-reception` `src/pages/Bookingpage.jsx:256` (import.meta.env)
- `scGlamLiff-reception` `src/utils/adminUsersApi.js:4` (import.meta.env)
- `currentSC-official-website-project` `frontend-react/src/routes/Home.jsx:129` (import.meta.env)

### `JWT_SECRET`

- `scGlamLiff-reception` `backend/.env:2` (env-file)
- `scGlamLiff-reception` `backend/scripts/verify_admin_edit_patch.js:84` (process.env)
- `currentSC-official-website-project` `backend/.env:11` (env-file)
- `currentSC-official-website-project` `backend/.env.example:4` (env-file)

### `NODE_ENV`

- `scGlamLiff-reception` `backend/.env:4` (env-file)
- `scGlamLiff-reception` `backend/src/app.js:36` (process.env)
- `currentSC-official-website-project` `backend/db.js:5` (process.env)
- `currentSC-official-website-project` `backend/server.js:120` (process.env)

### `PORT`

- `scGlamLiff-reception` `backend/.env:3` (env-file)
- `scGlamLiff-reception` `backend/server.js:16` (process.env)
- `currentSC-official-website-project` `backend/.env:1` (env-file)
- `currentSC-official-website-project` `backend/.env.example:1` (env-file)

### `VITE_API_BASE`

- `scGlamLiff-reception` `.env.development:5` (env-file)
- `scGlamLiff-reception` `.env.example:5` (env-file)
- `currentSC-official-website-project` `frontend-react/src/lib/api.js:3` (import.meta.env)

### `VITE_API_BASE_URL`

- `scGlamLiff-reception` `.env.development:2` (env-file)
- `scGlamLiff-reception` `.env.example:2` (env-file)
- `currentSC-official-website-project` `.github/workflows/deploy.yml:37` (yaml-env)
- `currentSC-official-website-project` `frontend-react/src/lib/api.js:2` (import.meta.env)

## Recommended Follow-Up

- Rename P0/P1 backend secrets to project-scoped names before sharing one runtime.
- For one frontend app calling multiple modules, replace generic API prefix vars with `VITE_<PROJECT>_API_PREFIX`.
- Run `dotenv-linter` on `.env*` files when available.
- Run `gitleaks` or `trufflehog` before committing or deploying.
- Update code, workflows, env examples, deployment docs, and Render/GitHub variables together.
