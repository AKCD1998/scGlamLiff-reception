# Blunder Log

## 2026-02-13 14:00 +07:00 — `npm ci` blocked by local file locks
- Step: validate reproducible install with `npm ci`
- Expected: clean reinstall using `package-lock.json`
- Actual: `EPERM` unlink errors on locked binaries (for example `esbuild.exe`, `rollup.win32-x64-msvc.node`)
- Cause hypothesis: active local Node/Vite/backend processes still holding handles in `node_modules`
- Suggested fix:
  1. stop local dev/test Node processes
  2. retry `npm ci`
  3. if needed, run terminal with elevated permissions and exclude workspace from aggressive AV scanning
