# Branch Device Registration Implementation Log

Generated on `2026-03-18T09:21:36.0003647+07:00`

## Goal
- Add backend persistence for LIFF branch-device registration using the business rule "one device belongs to one branch".
- Keep existing username/password + cookie JWT staff auth as the primary protected staff auth model.
- Treat LIFF smartphone identity as an operational branch-device layer, not as a replacement for `req.user`.

## What Was Confirmed Before Implementation
- Staff auth is still cookie-JWT around `staff_users` (`/api/auth/login`, `/api/auth/me`, `/api/auth/logout`).
- Branch is still not modeled in auth/session state.
- Branch write paths still accept opaque text-like `branch_id` values.
- There is still no `branches` table or stable staff-to-branch mapping in the backend auth model.
- Existing repo already distinguishes:
  - staff login identity (`staff_users`)
  - customer/contact identity (`customer_identities`, `line_users`)
  - operational second-factor style checks (`staffs.pin_hash` in legacy sheet delete flow)

## Design Decision

### Chosen Model
- Added `branch_device_registrations` as a new PostgreSQL table.
- Added LIFF verification as a dedicated backend service.
- Added a route group `/api/branch-device-registrations/*`.
- Preserved existing `req.user`-based protected flow. No existing appointment or draft auth path was rewritten.

### Why This Fits the Repo
- Current protected staff operations rely on `req.user.id`, `req.user.display_name`, and role checks.
- The business decision is branch-device binding, not permanent LINE-to-staff binding.
- This repo already has a precedent for "primary staff auth + secondary operational guard" via the PIN-based legacy delete flow.

### Duplicate Registration Rule
- Chosen rule: one registration row per verified `line_user_id`.
- `line_user_id` is unique in `branch_device_registrations`.
- Re-registering the same LIFF identity updates the existing row in place:
  - branch can change
  - status is forced back to `active`
  - `linked_at` is refreshed
  - `last_seen_at` is refreshed
  - `updated_by_staff_user_id` is updated
- This avoids conflicting active registrations without introducing a second device history table in this pass.

## Implemented Changes

### Database / Migration
- Added `backend/scripts/migrate_branch_device_registrations.js`
- Added npm script `migrate:branch-device-registrations`

`branch_device_registrations` stores:
- `line_user_id`
- `branch_id`
- optional `device_label`
- optional `liff_app_id`
- `status` (`active` / `inactive`)
- `linked_at`
- `last_seen_at`
- optional `notes`
- optional `registered_by_staff_user_id`
- optional `updated_by_staff_user_id`
- timestamps

### Backend Service Layer
- Added `backend/src/services/lineLiffIdentityService.js`
  - extracts LIFF credentials from request headers/body
  - verifies `id_token` with LINE
  - verifies `access_token` with LINE, then resolves profile
  - rejects mismatched `id_token` vs `access_token`
  - never trusts raw frontend `line_user_id`
- Added `backend/src/services/branchDeviceRegistrationsService.js`
  - create/update registration
  - list registrations
  - device-facing "me" lookup
  - patch registration metadata/status

### HTTP Layer
- Added `backend/src/controllers/branchDeviceRegistrationsController.js`
- Added `backend/src/routes/branchDeviceRegistrations.js`
- Wired route group in `backend/src/app.js`

Endpoints added:
- `POST /api/branch-device-registrations`
- `GET /api/branch-device-registrations`
- `GET /api/branch-device-registrations/me`
- `PATCH /api/branch-device-registrations/:id`

### CORS / Header Support
- Added allowed request headers for LIFF verification:
  - `X-Line-Id-Token`
  - `X-Line-Access-Token`
  - `X-Liff-App-Id`
- `Authorization` remains allowed and can carry LINE access token as `Bearer <token>` for the LIFF lookup flow.

## Files Changed
- `backend/package.json`
- `backend/README-backend.md`
- `backend/API_CONTRACT.md`
- `backend/API_CHANGELOG_NOTES.md`
- `backend/IMPLEMENTATION_LOG_BRANCH_DEVICE_REGISTRATIONS.md`
- `backend/scripts/migrate_branch_device_registrations.js`
- `backend/src/app.js`
- `backend/src/routes/branchDeviceRegistrations.js`
- `backend/src/controllers/branchDeviceRegistrationsController.js`
- `backend/src/services/lineLiffIdentityService.js`
- `backend/src/services/lineLiffIdentityService.test.js`
- `backend/src/services/branchDeviceRegistrationsService.js`
- `backend/src/services/branchDeviceRegistrationsService.test.js`

## Verification Strategy
- LIFF identity is verified server-side before registration or "me" lookup.
- `id_token` path:
  - backend calls LINE verify endpoint with configured channel id
  - trusted `sub` becomes `line_user_id`
- `access_token` path:
  - backend calls LINE token verify endpoint
  - backend enforces expected channel id
  - backend then calls LINE profile endpoint
  - trusted `userId` becomes `line_user_id`
- When both tokens are supplied, both must resolve to the same LINE user.

## Tests Added
- Focused tests for LIFF verification wrapper behavior
- Create registration test
- Re-register/update existing device test
- "me" lookup test
- Inactive registration behavior test
- Patch registration test
- List ordering/filter test

## What This Does Not Enforce Yet
- It does not replace or bypass staff auth.
- It does not force existing appointment/draft endpoints to require LIFF verification.
- It does not add a `branches` table.
- It does not create staff-to-LINE mapping.
- It does not solve per-employee accountability beyond the existing `req.user` / event / timestamp model.

## Next Logical Follow-Ups
- Decide where LIFF branch-device verification should be enforced in frontend/backend flows.
- Normalize the branch domain model before adding stronger device-per-branch enforcement everywhere.
- Add an admin UI for viewing/updating branch-device registrations if the operational workflow needs it.

## Update 2026-03-24T11:45:00+07:00

### Scope
- Inspect the existing `/api/auth/login` -> cookie -> `/api/auth/me` flow used by the LIFF startup gate.
- Add backend diagnostics so production Render logs can prove whether the staff cookie was issued and whether the WebView sent it back.

### What was confirmed
- Backend staff auth is still cookie-JWT only.
- `POST /api/auth/login` sets the HttpOnly cookie and does not rely on any Bearer token auth.
- `GET /api/auth/me` still depends entirely on `cookie-parser` populating `req.cookies.token`, then `requireAuth` verifying the JWT.
- Frontend LIFF login/recheck flow already uses `fetch(..., { credentials: 'include' })` for both endpoints, so the client request shape is not the primary bug.

### Most likely production cause
- The deployment is cross-site: GitHub Pages frontend and Render backend are different origins.
- Inside LINE LIFF WebView, that makes the staff cookie a third-party cookie.
- Even when the backend sends the correct cookie attributes (`HttpOnly`, `SameSite=None`, `Secure`), some WebView environments can still refuse to persist or resend it.
- That explains the observed pattern:
  - `POST /api/auth/login` can return `200`
  - but the immediate `GET /api/auth/me` still returns `401 missing_staff_auth`

### Backend changes in this pass
- Centralized staff session cookie settings in `src/utils/staffAuthSession.js`.
- Made cookie shape explicit:
  - name `token`
  - `HttpOnly`
  - `Path=/`
  - `Max-Age=7d`
  - `SameSite` defaults to `none` in production
  - `Secure` defaults to true in production / cross-site mode
  - optional host override via `COOKIE_DOMAIN`
- Added Render-log diagnostics for:
  - login success
  - cookie options used
  - whether `Set-Cookie` was attached
  - whether `/api/auth/me` arrived with a raw `Cookie` header
  - whether `cookie-parser` found the `token` cookie
  - whether JWT verification and user lookup succeeded

### Operational meaning
- If login succeeds and Render logs `setCookieHeaderPresent:true`, backend is issuing the cookie.
- If the next `/api/auth/me` log shows `cookieHeaderPresent:false` and `parsedTokenPresent:false`, the cookie was not sent back by the client/WebView.

## Update 2026-03-24T13:05:00+07:00

### Scope
- Add backend-side static hosting for the separate LIFF frontend build so the app can be served from the same origin as the Render API under `/liff/`.

### What changed
- Added LIFF frontend hosting config in `src/config/liffFrontendHosting.js`.
- Express now resolves a built frontend bundle from:
  - `LIFF_FRONTEND_DIST_DIR`
  - `backend/public/liff`
  - local sibling workspace `../../scGlamLiFFF/scGlamLiFF/dist`
- Mounted the LIFF frontend at `/liff/` after all `/api/*` routes and before the generic 404/error handlers.
- Added a narrow SPA fallback only for `GET /liff/*`.
- Added a temporary static compatibility alias at `/ScGlamLiFF/*` because the current GitHub Pages build still points its asset URLs at `/ScGlamLiFF/assets/*`.
- Added startup logging so Render can show whether LIFF static hosting is enabled and which dist directory was selected.

### Operational meaning
- `/api/*` behavior stays unchanged because those routes are mounted before the LIFF frontend shell.
- If the backend starts with `enabled:false` for `liff_frontend_hosting`, Render does not currently have a usable frontend build directory yet.
- Once a real LIFF build is present and the LINE console points to `https://<backend-host>/liff/`, staff auth cookies can become first-party on the backend origin.
- In that case the blocker is no longer the login handler itself; it is cross-site cookie persistence in the deployed LIFF environment.

## Update 2026-03-24T13:20:00+07:00

### Scope
- Tighten staff-auth observability so same-origin LIFF cookie verification can be confirmed from Render logs without exposing raw token values.

### What changed
- Kept the existing `[StaffAuth]` log format.
- `login_success` now also logs:
  - `setCookieHeaderCount`
  - `setCookieCookieNames`
- `/api/auth/me` request logs continue to emit:
  - `cookieHeaderPresent`
  - `cookieNames`
  - `parsedTokenPresent`
  - plus the existing verification outcome events

### Operational meaning
- Expected same-origin success path:
  - `login_success` with `setCookieHeaderPresent:true` and `setCookieCookieNames:["token"]`
  - `auth_me_check` with `cookieHeaderPresent:true`, `cookieNames:["token"]`, `parsedTokenPresent:true`
  - `auth_me_verified`
  - `auth_me_success`
- If `login_success` appears but the next `auth_me_check` still shows `cookieHeaderPresent:false`, the client is still not returning the cookie to the backend.

## Update 2026-03-24T14:20:00+07:00

### Scope
- Prepare a staged rollout path so the LIFF frontend can move to backend-origin hosting under `/liff/` without immediately removing the existing GitHub Pages deployment.

### What changed
- Documented the deployment order in `backend/README-backend.md`.
- Added `backend/public/liff/README.md` as the stable artifact drop-in location for a built LIFF frontend bundle.
- Kept the GitHub Pages deployment path intentionally unchanged for rollback safety.

### Operational meaning
- Backend-origin LIFF can now be deployed and verified independently first.
- The LINE endpoint should only be repointed after `/liff/` is live and backend logs confirm the frontend bundle is being served.
- Rollback is only a LIFF endpoint switch back to GitHub Pages unless a new frontend build there is also needed.

## Update 2026-03-24T16:20:00+07:00

### Scope
- Fix a backend-origin LIFF regression where the global CORS middleware could
  reject `/liff/assets/*.js` module requests with a 500 even though direct
  top-level navigation to the same asset returned 200.

### What changed
- CORS now mounts only on `/api/*` in `src/app.js`.
- The LIFF static shell and assets under `/liff/*` no longer pass through the
  cross-site frontend origin allowlist.
- Added a regression test that requests `/liff/assets/app.js` with an `Origin`
  header and confirms the asset still returns `200`.

### Operational meaning
- Backend-hosted LIFF assets are no longer sensitive to stale `FRONTEND_ORIGINS`
  settings during same-origin rollout.
- Cross-origin API access for GitHub Pages remains unchanged because `/api/*`
  still uses the same CORS policy as before.
