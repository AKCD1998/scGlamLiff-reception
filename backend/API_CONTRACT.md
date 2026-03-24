# API Contract — scGlamLiff-reception Backend

## 1. Purpose
- This document is the backend integration contract generated from the real source code in this repository.
- It is intended for external repos, external Codex instances, and client applications that must integrate without reading backend source files.
- Generated from code on `2026-03-18T09:21:36.0003647+07:00`.
- Code behavior takes precedence over `backend/README-backend.md` and `diary.md` when they conflict.
- Any uncertainty is explicitly labeled in [Section 13](#13-open-questions--uncertain-areas).

## 2. High-Level Architecture
This backend is an Express application backed by PostgreSQL. Its modern appointment flow is appointments-first: queue reads, booking creation, service completion, admin edit, and backdate flows all operate on local PostgreSQL tables such as `appointments`, `customers`, `customer_identities`, `customer_packages`, `package_usages`, `appointment_events`, `appointment_receipts`, and `appointment_drafts`.

The app exposes these route groups:
- `/api/auth` for session login/logout/me
- `/api/appointments` for queue, booking options, calendar, create, service actions, backdate, and some legacy appointment endpoints
- `/api/appointment-drafts` for authenticated draft-buffer storage before a real appointment exists
- `/api/admin` for admin appointment detail/edit and staff-user management
- `/api/reporting` for authenticated read-only KPI/report summaries
- `/api/branch-device-registrations` for LIFF branch-device registration and LIFF identity lookup
- `/api/ocr` for receipt image OCR upload used by Bill Verification
- `/api/customers` for customer list/profile reads
- `/api/visits` and `/api/sheet-visits` for legacy sheet-backed flows
- `/api/debug` for a non-production admin debug endpoint

Current source of truth for modern booking/queue behavior is the appointments-first flow:
- Canonical read endpoints: `/api/appointments/queue`, `/api/appointments/booking-options`, `/api/appointments/calendar-days`
- Canonical write endpoints: `POST /api/appointments`, service status endpoints under `/api/appointments/:id/*`, and admin endpoints under `/api/admin/appointments/*`
- Receipt-backed or promo/special-event bookings are not a second scheduling system. They still use canonical `POST /api/appointments`; receipt evidence is stored separately and linked back to the created appointment.
- Draft rows in `/api/appointment-drafts/*` are buffer storage only. They are not real appointments and do not appear in queue/calendar until submit creates a canonical appointment.
- LIFF branch-device registration is an additive capability. It does not replace staff cookie auth and does not make LIFF the primary staff identity in this backend.
- Reporting endpoints are additive read models. They do not replace transactional endpoints and are intended to summarize existing PostgreSQL business data without mutating it.

Legacy behavior still exists:
- `GET /api/appointments` and `POST /api/appointments/delete-hard` proxy to Google Apps Script (GAS)
- `/api/visits` and `/api/sheet-visits` are sheet-backed or migration compatibility endpoints
- `POST /api/appointments/from-sheet/:sheetUuid/ensure` is an admin bridge from sheet rows into local appointments

Important implementation detail: some read fields are event-sourced, not plain table columns. In particular, `staff_name`, `treatment_item_text`, `treatment_plan_mode`, and `package_id` are resolved from `appointment_events` in several endpoints.

## 3. Base URL and Environment Assumptions
- API base path is `/api`.
- Health endpoint is `GET /api/health`.
- The Node process listens on `PORT`, default `5050`.
- The backend requires `DATABASE_URL`. PostgreSQL SSL is enabled unless `PGSSLMODE=disable`.
- CORS is enabled with:
  - `credentials: true`
  - methods `GET, POST, PATCH, DELETE, OPTIONS`
  - allowed headers `Content-Type, Authorization, X-Line-Id-Token, X-Line-Access-Token, X-Liff-App-Id`
- Allowed origins come from:
  - `FRONTEND_ORIGIN`
  - `FRONTEND_ORIGINS` comma-separated
  - any localhost origin in non-production
- No deployment URL is hardcoded in code. External clients should supply their own host, then call `/api/...`.

Frontend/browser implication:
- Cross-origin browser clients must send cookies with `credentials: 'include'`.
- Same-origin proxy mode also works, but cookie/session behavior still depends on the browser sending the cookie.

## 4. Authentication and Session Model

### Auth Flow Summary
1. Client calls `POST /api/auth/login` with username/password.
2. On success, backend signs a JWT and stores it in an HttpOnly cookie named `token`.
3. Protected endpoints use `requireAuth`, which only checks `req.cookies.token`.
4. Staff auth does not use Bearer token auth. The `Authorization` header is not used by `requireAuth`.
5. One LIFF lookup route (`GET /api/branch-device-registrations/me`) may read `Authorization: Bearer <LINE access token>` as LINE identity input, but that is separate from staff auth.
6. Admin-only routes also apply `requireAdmin`, which allows only roles `admin` and `owner`.

### Cookie Behavior
- Cookie name: `token`
- Storage: HttpOnly cookie
- JWT lifetime: `7d`
- Cookie `Path`: `/`
- Cookie `Max-Age`: `604800` seconds / `604800000` ms
- Cookie `Domain`: unset by default (host-only for the API origin) unless `COOKIE_DOMAIN` is explicitly configured
- `sameSite`:
  - `COOKIE_SAMESITE` if explicitly set to `lax`, `strict`, or `none`
  - otherwise `none` in production
  - otherwise `lax` in non-production
- `secure`:
  - true if `COOKIE_SECURE=true`
  - or if `sameSite === 'none'`
  - or in production
- Cross-site LIFF note:
  - when frontend runs on GitHub Pages and backend runs on Render, the staff cookie is third-party from the WebView's perspective
  - even with `SameSite=None; Secure`, some LINE/Safari WebView environments may not persist or resend that cookie
  - confirm staff login by checking `POST /api/auth/login` followed immediately by `GET /api/auth/me` plus backend auth logs

### Auth Endpoints

| Endpoint | Auth | Request | Success Response |
| --- | --- | --- | --- |
| `POST /api/auth/login` | Public | `{ username, password }` | `{ ok: true, data: { id, username, display_name } }` plus `token` cookie |
| `GET /api/auth/me` | Authenticated | none | `{ ok: true, data: { id, username, display_name, role_name } }` |
| `POST /api/auth/logout` | Public | none | `{ ok: true, data: { message: "Logged out" } }` and clears cookie |

### Auth Failure Behavior
- Missing login credentials: `400 { ok: false, error: "Missing credentials" }`
- Invalid login: `401 { ok: false, error: "Invalid credentials" }`
- Missing/invalid/expired cookie on protected routes: `401 { ok: false, error: "Unauthorized" }`
- Missing admin role on admin routes: `403 { ok: false, error: "Forbidden" }`

### Frontend Integration Notes
- Always send `credentials: 'include'` for browser requests that need session auth.
- Do not assume `Authorization: Bearer ...` drives staff auth. It does not drive `requireAuth`.
- LIFF/device verification endpoints may use:
  - `Authorization: Bearer <LINE access token>`
  - `X-Line-Id-Token: <LINE id token>`
  - `X-Line-Access-Token: <LINE access token>`
  - `X-Liff-App-Id: <LIFF app id>` (optional metadata)
- `POST /api/auth/logout` does not require auth. It simply clears the cookie shape used by login.

Example browser login:

```js
await fetch('/api/auth/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'staff01',
    password: 'secret123'
  })
});
```

Example protected request:

```js
await fetch('/api/appointments/queue?limit=50', {
  credentials: 'include'
});
```

## 5. Global Rules and Conventions

### Timezone and Date/Time Conventions
- Queue and calendar date filtering use `Asia/Bangkok`.
- When the backend derives date/time strings from `scheduled_at`, it formats them in `Asia/Bangkok`.
- `scheduled_at` inputs must include a timezone offset when accepted by write endpoints.
- Legacy split fields use:
  - `visit_date`: `YYYY-MM-DD`
  - `visit_time_text`: `HH:MM`
- If `POST /api/appointments` receives `visit_date` + `visit_time_text` instead of `scheduled_at`, it constructs `scheduled_at` as `YYYY-MM-DDTHH:MM:00+07:00`.

### ID Conventions
- Most appointment, customer, package, and raw sheet IDs are UUIDs.
- `branch_id` has an explicit backend contract today:
  - write endpoints such as `POST /api/appointments`, `POST /api/appointment-drafts`, and `PATCH /api/appointment-drafts/:id` accept non-empty text when a branch value is supplied
  - canonical create can still fall back to `DEFAULT_BRANCH_ID` or literal `branch-003` when `receipt_evidence` is not being sent
  - `POST /api/appointment-drafts/:id/submit` requires the stored draft `branch_id` to be non-empty and passes it through to canonical create unchanged
  - availability/query endpoints `GET /api/appointments/queue` and `GET /api/appointments/calendar-days` only accept UUID-shaped `branch_id` query params when a branch filter is requested
  - if queue/calendar `branch_id` is omitted, no branch filter is applied
  - no backend mapping currently converts text branch codes such as `branch-003` into UUID filter values
- Treat `branch_id` as an opaque stored write value plus a UUID-only read filter until the data model is unified. See [Section 13](#13-open-questions--uncertain-areas).

### Receipt-Backed Booking Conventions
- Receipt-backed bookings still create normal rows in `appointments`.
- Optional receipt evidence is stored in `appointment_receipts` and linked by `appointment_id`.
- Current code requires an explicit non-empty `branch_id` when `receipt_evidence` is supplied to `POST /api/appointments`.
- `appointments.source` remains `WEB` for `POST /api/appointments`, including receipt-backed bookings. Promo/verification context currently lives in receipt evidence fields such as `verification_source` and `verification_metadata`, not in a separate appointment status or source code.

### Draft Buffer Conventions
- `appointment_drafts` is a PostgreSQL buffer table in the same database as `appointments`; it is not a separate database or external buffer service.
- Draft rows are persisted in PostgreSQL and survive browser refresh/reload.
- `GET /api/appointment-drafts` reads persisted rows from PostgreSQL, defaulting to `draft` and `submitted` rows sorted by newest `updated_at` first.
- Drafts may omit `scheduled_at` and `staff_name`.
- Drafts may also omit other fields, but submit will later require:
  - `customer_full_name`
  - `phone`
  - `treatment_id`
  - `branch_id`
  - `scheduled_at`
  - `staff_name`
- Draft submit reuses the canonical appointment creation logic behind `POST /api/appointments` instead of implementing a separate appointment business-rules engine.
- `branch_id` remains text-tolerant in drafts, matching current canonical create behavior.
- There is no dedicated draft delete endpoint in current code. Draft lifecycle is currently create -> patch/update -> optional `status=cancelled` -> optional submit.

### LIFF Branch-Device Registration Conventions
- `branch_device_registrations` is a PostgreSQL table for LIFF smartphone/device registration, not for staff auth replacement.
- Existing username/password + cookie JWT staff auth remains primary for protected staff operations.
- Backend never trusts raw frontend `line_user_id` for this feature.
- LIFF identity must be verified server-side from:
  - `id_token`
  - and/or `access_token`
- Current verification contract:
  - `id_token` is verified with LINE using configured `LINE_LIFF_CHANNEL_ID` or `LINE_CHANNEL_ID`
  - `access_token` is verified with LINE, then used to fetch LINE profile
  - if both tokens are supplied, they must resolve to the same LINE user
- Registration business rule in this implementation:
  - one row per `line_user_id`
  - re-registering the same LIFF identity updates the existing row in place
  - current stored branch/device becomes the active one for that LINE identity
- `GET /api/branch-device-registrations/me` is the LIFF/device-facing lookup endpoint:
  - it verifies the current LIFF identity
  - returns registration status and branch binding
  - updates `last_seen_at` when the device is already known

### Common Error Shapes
Most endpoints return one of:

```json
{ "ok": false, "error": "..." }
```

or, for some richer validation errors:

```json
{
  "ok": false,
  "error": "Bad Request",
  "message": "...",
  "details": { "...": "..." }
}
```

Unmatched routes use:

```json
{ "ok": false, "error": "Not found" }
```

### Aliases and Input Normalization
- `POST /api/appointments` accepts:
  - `scheduled_at`
  - or `visit_date` + `visit_time_text`
- `POST /api/appointments` accepts `phone` or `phone_raw`; both are normalized to digits.
- `POST /api/appointments/:id/cancel` and `POST /api/appointments/:id/no-show` accept either `note` or `reason`; `note` wins if both are present.
- `canceled` is normalized to `cancelled` in admin/status handling.
- `oneoff` is normalized to `one_off`.

### Boolean Handling
Some fields are strictly validated as booleans:
- `reassign_customer_by_phone`
- `unlink_package`
- `is_active` in staff-user admin endpoints

Some fields are only coerced with JavaScript `Boolean(...)`:
- `used_mask`
- `create_package_usage`
- `confirm_cancelled_to_completed`
- `confirm_raw_sheet_uuid_change`
- `confirm_raw_sheet_uuid_change_ack`

Send real JSON booleans, not strings like `"false"`, to avoid accidental truthiness.

### Event-Sourced Fields
These values are not simple appointment table columns in all read paths:
- `staff_name`
- `treatment_item_text`
- `treatment_plan_mode`
- `package_id`

Observed behavior:
- queue/admin/customer-history resolve plan fields from `appointment_events`
- newer empty values do not erase historical package linkage unless unlink is explicit
- queue/admin detail can fail with `500 SSOT_STAFF_MISSING` if no resolvable `staff_name` exists

### Status Values Observed in Code
- `booked`
- `rescheduled`
- `ensured`
- `confirmed`
- `completed`
- `cancelled` / input alias `canceled`
- `no_show`
- `check_in`
- `checked_in`
- `pending`

Not every endpoint accepts every status. See [Section 8](#8-appointment-lifecycle-and-status-rules).

## 6. Canonical vs Legacy Endpoints

| Endpoint/Group | Canonical? | Legacy? | Notes | Should new integrations use it? |
| --- | --- | --- | --- | --- |
| `/api/auth/*` | Yes | No | Current session auth flow | Yes |
| `POST /api/branch-device-registrations` | Supportive | No | Authenticated LIFF device registration/upsert | Yes, for LIFF device setup |
| `GET /api/branch-device-registrations` | Supportive | No | Authenticated LIFF device registration list | Yes, for admin/staff visibility |
| `GET /api/branch-device-registrations/me` | Supportive | No | LIFF identity lookup for current device/LINE user | Yes, for LIFF device checks |
| `PATCH /api/branch-device-registrations/:id` | Supportive | No | Authenticated LIFF device registration patch | Yes, for ops/admin maintenance |
| `GET /api/appointments/queue` | Yes | No | Main queue/read endpoint | Yes |
| `GET /api/appointments/booking-options` | Yes | No | Booking UI option source | Yes |
| `GET /api/appointments/calendar-days` | Yes | No | Booking calendar density endpoint | Yes |
| `GET /api/appointment-drafts` | Supportive | No | Persisted draft list/dashboard endpoint backed by PostgreSQL | Yes, for draft flow |
| `POST /api/appointment-drafts` | Supportive | No | Buffer partial promo/draft booking data before a real appointment exists | Yes, for draft flow |
| `GET /api/appointment-drafts/:id` | Supportive | No | Read one draft buffer row | Yes, for draft flow |
| `PATCH /api/appointment-drafts/:id` | Supportive | No | Update draft buffer data before submit | Yes, for draft flow |
| `POST /api/appointment-drafts/:id/submit` | Supportive | No | Converts a complete draft into a canonical appointment | Yes, for draft flow |
| `POST /api/appointments` | Yes | No | Main create-booking endpoint, including optional receipt-backed promo/special-event bookings | Yes |
| `POST /api/appointments/:id/complete` | Yes | No | Canonical completion and package deduction flow | Yes |
| `POST /api/appointments/:id/cancel` | Yes | No | Canonical staff cancel flow | Yes |
| `POST /api/appointments/:id/no-show` | Yes | No | Canonical staff no-show flow | Yes |
| `POST /api/appointments/:id/revert` | Yes | No | Canonical admin revert/usage rollback flow | Yes, admin only |
| `POST /api/appointments/:id/sync-course` | Supportive | No | Helper to ensure customer package linkage | Use only when needed |
| `GET /api/admin/appointments/:appointmentId` | Yes | No | Canonical admin detail/read endpoint | Yes, admin only |
| `PATCH /api/admin/appointments/:appointmentId` | Yes | No | Canonical admin maintenance/edit endpoint | Yes, admin only |
| `POST /api/appointments/admin/backdate` | Yes | No | Canonical admin backdate create flow | Yes, admin only |
| `GET /api/customers/:customerId/profile` | Supportive | No | Useful read endpoint, but currently public by code | Yes, with caution |
| `GET /api/customers` | Supportive | No | Useful list endpoint, but currently public by code | Yes, with caution |
| `GET /api/appointments` | No | Yes | GAS-backed proxy, not appointments SSOT | No |
| `POST /api/appointments/delete-hard` | No | Yes | GAS-backed hard delete proxy | No |
| `DELETE /api/appointments/:id` | No | Yes-ish | Soft-cancels local appointment, unauthenticated by route code | Prefer canonical cancel endpoint instead |
| `/api/visits` | No | Yes | Sheet/migration compatibility endpoint | No |
| `/api/sheet-visits/:sheetUuid/delete` | No | Yes | Legacy sheet delete flow with PIN | Only for legacy sheet ops |
| `POST /api/appointments/from-sheet/:sheetUuid/ensure` | Bridge | Yes-ish | Admin bridge from sheet row to local appointment | Only for migration/admin tooling |
| `/api/debug/*` | No | Internal | Non-production admin debug route | No |

## 7. Route-by-Route API Contract

### `GET /api/health`
**Purpose**
- Simple process health check.

**Auth**
- Public.

**Request**
- No params, query, or body.

**Validation / Business Rules**
- Does not check database connectivity.

**Response**
- `200`

```json
{
  "ok": true,
  "data": {
    "status": "ok"
  }
}
```

**Errors**
- No custom endpoint-level errors observed.

**Integration Notes**
- Use only as a process-level health check, not as proof that PostgreSQL or required tables are healthy.

### `POST /api/auth/login`
**Purpose**
- Start a session by issuing the `token` cookie.

**Auth**
- Public.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `username` | string | Yes | Exact `staff_users.username` |
| `password` | string | Yes | Plain password |

**Validation / Business Rules**
- Missing `username` or `password` returns `400`.
- Username lookup is done in `staff_users`.
- User must exist, be active, and have matching bcrypt password.
- On login failure, `failed_login_count` increments for the found user.
- On success, `failed_login_count` resets and `last_login_at` updates.

**Response**
- `200`

```json
{
  "ok": true,
  "data": {
    "id": "user-uuid",
    "username": "staff01",
    "display_name": "Staff One"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Missing credentials |
| `401` | Invalid username/password or inactive user |
| `500` | Unhandled server error |

**Integration Notes**
- Success does not include `role_name`; call `GET /api/auth/me` if you need it.
- Browser clients must keep the `token` cookie.

### `GET /api/auth/me`
**Purpose**
- Return the authenticated session user.

**Auth**
- Authenticated.

**Request**
- No body.

**Validation / Business Rules**
- `requireAuth` reads `req.cookies.token`.
- JWT payload `sub` is looked up in `staff_users` joined to `roles`.
- Missing/invalid cookie or inactive user returns `401`.

**Response**
- `200`

```json
{
  "ok": true,
  "data": {
    "id": "user-uuid",
    "username": "staff01",
    "display_name": "Staff One",
    "role_name": "staff"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `401` | Missing/invalid/expired cookie, or user no longer active |

**Integration Notes**
- This is the reliable route for role detection.

### `POST /api/auth/logout`
**Purpose**
- Clear the session cookie.

**Auth**
- Public.

**Request**
- No body.

**Validation / Business Rules**
- Uses the same cookie options as login when clearing `token`.

**Response**
- `200`

```json
{
  "ok": true,
  "data": {
    "message": "Logged out"
  }
}
```

**Errors**
- No custom endpoint-level errors observed.

**Integration Notes**
- Safe to call even if the user is already effectively logged out.

### `POST /api/branch-device-registrations`
**Purpose**
- Register or re-register a LIFF smartphone/device to a branch after verifying LIFF identity server-side.

**Auth**
- Authenticated staff/admin/owner.
- Primary path remains the existing staff cookie session.
- Route-local fallback exists for this endpoint only: when the staff cookie is absent or unusable in LINE WebView, client may send `staff_username` + `staff_password` in the request body for one-off verification.
- The fallback does not issue a cookie and does not change `/api/auth/login`, `/api/auth/me`, `requireAuth`, or any other protected endpoint.

**Request**

| Field/Header | Type | Required | Notes |
| --- | --- | --- | --- |
| `branch_id` | string | Yes | Opaque text branch id; current branch write contract is preserved |
| `device_label` | string | No | Friendly label for the device |
| `liff_app_id` | string | No | Optional LIFF app id metadata |
| `notes` | string | No | Optional ops/admin note |
| `staff_username` | string | No | Route-local staff verification fallback for this endpoint only |
| `staff_password` | string | No | Route-local staff verification fallback for this endpoint only |
| `id_token` | string | Conditionally | Required if `access_token` is not provided |
| `access_token` | string | Conditionally | Required if `id_token` is not provided |

Supported LIFF headers:
- `Authorization: Bearer <LINE access token>`
- `X-Line-Access-Token: <LINE access token>`
- `X-Line-Id-Token: <LINE id token>`
- `X-Liff-App-Id: <LIFF app id>`

**Validation / Business Rules**
- Accepts either:
  - existing valid staff cookie auth
  - or explicit `staff_username` + `staff_password` for this endpoint only
- If neither path succeeds, request is rejected with `401`.
- `branch_id` is required and stored as text without UUID-only coercion.
- Backend verifies LIFF identity with LINE before trusting `line_user_id`.
- Raw frontend `line_user_id` is not accepted as a trusted identity source.
- Current duplicate rule is strict:
  - one row per `line_user_id`
  - if the same LIFF identity registers again, backend updates the existing row in place
  - resulting row is forced to `status='active'`
  - `linked_at` and `last_seen_at` refresh on successful registration

**Response**
- `201` when created, `200` when updated

```json
{
  "ok": true,
  "action": "created",
  "registration": {
    "id": "registration-uuid",
    "line_user_id": "U1234567890",
    "branch_id": "branch-003",
    "device_label": "Front Desk iPhone",
    "liff_app_id": "1650000000-test",
    "status": "active",
    "linked_at": "2026-03-18T02:00:00.000Z",
    "last_seen_at": "2026-03-18T02:00:00.000Z",
    "notes": "Primary counter device",
    "registered_by_staff_user_id": "staff-user-uuid",
    "updated_by_staff_user_id": "staff-user-uuid",
    "created_at": "2026-03-18T02:00:00.000Z",
    "updated_at": "2026-03-18T02:00:00.000Z"
  },
  "line_identity": {
    "line_user_id": "U1234567890",
    "display_name": "Front Desk Phone",
    "picture_url": null,
    "liff_app_id": "1650000000-test",
    "verification_source": "id_token"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Missing `branch_id`, missing LIFF tokens, invalid patch payload |
| `401` | Invalid LIFF token, LIFF token mismatch, `missing_staff_auth`, `invalid_staff_credentials` |
| `422` | Verified LIFF response could not produce a trusted `line_user_id` |
| `500` | Missing LINE channel config or unhandled server error |

**Integration Notes**
- This endpoint adds a branch-device layer on top of current staff auth. It is not a staff login endpoint.
- The explicit credential fallback is intentionally limited to this device-registration route because cross-site staff cookies are unreliable inside LINE WebView.

### `GET /api/branch-device-registrations`
**Purpose**
- List branch-device registrations for admin/staff visibility and troubleshooting.

**Auth**
- Authenticated staff/admin/owner.

**Request**

| Query | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | `active \| inactive \| all` | No | Default behavior returns all known statuses |
| `branch_id` | string | No | Text filter; no UUID-only rule here |
| `line_user_id` | string | No | Exact LINE user id filter |

**Validation / Business Rules**
- Sorted by `updated_at DESC`, then `created_at DESC`, then `id DESC`.
- `status` must be `active`, `inactive`, or `all`.

**Response**
- `200`

```json
{
  "ok": true,
  "rows": [
    {
      "id": "registration-uuid",
      "line_user_id": "U1234567890",
      "branch_id": "branch-003",
      "device_label": "Front Desk iPhone",
      "liff_app_id": "1650000000-test",
      "status": "active",
      "linked_at": "2026-03-18T02:00:00.000Z",
      "last_seen_at": "2026-03-18T03:00:00.000Z",
      "notes": "Primary counter device",
      "registered_by_staff_user_id": "staff-user-uuid",
      "updated_by_staff_user_id": "staff-user-uuid",
      "created_at": "2026-03-18T02:00:00.000Z",
      "updated_at": "2026-03-18T02:10:00.000Z"
    }
  ],
  "meta": {
    "applied_status_filter": ["active", "inactive"],
    "branch_id": null,
    "line_user_id": null,
    "sort": "updated_at_desc"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid status filter |
| `401` | Missing staff auth |
| `500` | Unhandled server error |

### `GET /api/branch-device-registrations/me`
**Purpose**
- Verify the current LIFF identity and return whether that LINE identity is a known branch device.

**Auth**
- Public with LIFF token verification. Does not require staff cookie auth.

**Request**
- Send LIFF identity in headers:
  - `Authorization: Bearer <LINE access token>`
  - and/or `X-Line-Id-Token: <LINE id token>`
  - optional `X-Liff-App-Id: <LIFF app id>`

**Validation / Business Rules**
- Backend verifies LIFF identity with LINE before lookup.
- If a registration exists, backend updates `last_seen_at`.
- Current response distinguishes:
  - `registered`
  - `active`
  - bound `branch_id`
  - optional `device_label`

**Response**
- `200`

```json
{
  "ok": true,
  "registered": true,
  "active": true,
  "branch_id": "branch-003",
  "device_label": "Front Desk iPhone",
  "registration": {
    "id": "registration-uuid",
    "line_user_id": "U1234567890",
    "branch_id": "branch-003",
    "device_label": "Front Desk iPhone",
    "status": "active",
    "last_seen_at": "2026-03-18T03:00:00.000Z"
  },
  "line_identity": {
    "line_user_id": "U1234567890",
    "display_name": "Front Desk Phone",
    "picture_url": null,
    "liff_app_id": "1650000000-test",
    "verification_source": "id_token+access_token"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Missing LIFF tokens |
| `401` | Invalid LIFF token or token mismatch |
| `422` | Verified LIFF response could not produce a trusted `line_user_id` |
| `500` | Missing LINE channel config or unhandled server error |

**Integration Notes**
- "me" means "the current verified LIFF device/LINE user", not the current staff login user.

### `PATCH /api/branch-device-registrations/:id`
**Purpose**
- Update registration status/metadata without rebuilding staff auth or deleting rows.

**Auth**
- Authenticated staff/admin/owner.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | `active \| inactive` | No | Optional |
| `device_label` | string or `null` | No | Optional |
| `notes` | string or `null` | No | Optional |

Path param:
- `id` must be UUID

**Validation / Business Rules**
- At least one of `status`, `device_label`, or `notes` is required.
- Setting status back to `active` refreshes `linked_at` when the row was previously inactive.

**Response**
- `200`

```json
{
  "ok": true,
  "registration": {
    "id": "registration-uuid",
    "line_user_id": "U1234567890",
    "branch_id": "branch-003",
    "device_label": "Updated Label",
    "status": "inactive",
    "notes": "Temporarily disabled"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid registration id or empty patch payload |
| `401` | Missing staff auth |
| `404` | Registration not found |
| `500` | Unhandled server error |

### `GET /api/appointments/booking-options`
**Purpose**
- Return treatment/package options for booking UI.

**Auth**
- Authenticated.

**Request**
- No query/body.

**Validation / Business Rules**
- Pulls active treatments from `treatments`.
- Special-cases `smooth`:
  - package options use `source: "package"`
  - if no matching smooth packages exist, falls back to one treatment option
- Non-smooth treatments use `source: "treatment"`.
- Response labels are generated from catalog/package data.

**Response**
- `200`

```json
{
  "ok": true,
  "options": [
    {
      "value": "package:package-uuid",
      "label": "Smooth 3x 3900",
      "source": "package",
      "treatment_id": "treatment-uuid",
      "treatment_item_text": "Smooth 3x 3900",
      "treatment_name": "Smooth",
      "treatment_name_en": "Smooth",
      "treatment_name_th": null,
      "treatment_code": "smooth",
      "treatment_sessions": 3,
      "treatment_mask": 0,
      "treatment_price": 3900,
      "treatment_display": "Smooth 3x 3900",
      "treatment_display_source": "catalog",
      "package_id": "package-uuid",
      "package_code": "SMOOTH_C3_3900_M0",
      "sessions_total": 3,
      "mask_total": 0,
      "price_thb": 3900
    },
    {
      "value": "treatment:treatment-uuid",
      "label": "Expert 1x 990",
      "source": "treatment",
      "treatment_id": "treatment-uuid"
    }
  ]
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `500` | Unhandled query/server error |

**Integration Notes**
- Prefer using this endpoint as the source of `treatment_id` and `package_id`.
- Do not rely on text inference if you can send explicit IDs.

### `GET /api/appointments/calendar-days`
**Purpose**
- Return day-level appointment counts for a date range.

**Auth**
- Authenticated.

**Request**

| Query | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | `YYYY-MM-DD` | Yes | Bangkok-local date string |
| `to` | `YYYY-MM-DD` | Yes | Bangkok-local date string |
| `branch_id` | string | No | Optional branch filter; must be UUID-shaped if provided |

**Validation / Business Rules**
- Missing `from`/`to` returns `400`.
- Invalid date format returns `400`.
- `from > to` returns `400`.
- `branch_id` must be UUID if present.
- Omitting `branch_id` means no branch filter is applied.
- E2E/test records are excluded when customer name or `line_user_id` matches:
  - `e2e_`
  - `e2e_workflow_`
  - `verify-`
- Counts are grouped by `DATE(scheduled_at AT TIME ZONE 'Asia/Bangkok')`.
- `status_counts` only includes:
  - `booked`
  - `completed`
  - `no_show`
  - `cancelled`
- If other statuses exist on a day, `status_counts` may not sum to `count`.

**Response**
- `200`

```json
{
  "ok": true,
  "from": "2026-03-01",
  "to": "2026-03-31",
  "days": [
    {
      "date": "2026-03-17",
      "count": 12,
      "status_counts": {
        "booked": 4,
        "completed": 5,
        "no_show": 1,
        "cancelled": 1
      }
    }
  ]
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Missing/invalid query params |
| `500` | Unhandled server error |

**Integration Notes**
- Use this for calendar highlighting/density, not for queue detail.
- Do not send text branch codes such as `branch-003` here; the current backend filter contract is UUID-only.

### `GET /api/appointments/queue`
**Purpose**
- Main queue/read endpoint for appointments-first UI.

**Auth**
- Authenticated.

**Request**

| Query | Type | Required | Notes |
| --- | --- | --- | --- |
| `date` | `YYYY-MM-DD` | No | Filters by Bangkok-local appointment date |
| `branch_id` | string | No | Optional branch filter; must be UUID-shaped if provided |
| `limit` | positive integer | No | Default `200`, max `500`; invalid values are normalized, not rejected |

**Validation / Business Rules**
- Invalid `date` returns structured `400`.
- Invalid `branch_id` returns structured `400`.
- Omitting `branch_id` means no branch filter is applied.
- Queue shows all statuses. It does not hide `cancelled`, `no_show`, or `completed`.
- Ordering:
  - with `date`: ascending by `scheduled_at`
  - without `date`: descending by `scheduled_at`
- Phone is normalized to Thai-friendly display when possible.
- `lineId` is blanked for internal placeholders such as `phone:*`, `sheet:*`, `__STAFF__`, `__BACKDATE__`.
- `staff_name` is resolved from `appointment_events`. Missing SSOT staff causes `500`.
- Plan/package fields are resolved from event history, not only the current appointment row.

**Response**
- `200`
- Success body is `{ ok: true, rows: [...] }`
- May include `meta.warnings` when `limit` was defaulted/capped

Stable row fields external clients can rely on:
- `id`
- `appointment_id`
- `scheduled_at`
- `status`
- `branch_id`
- `treatment_id`
- `customer_id`
- `raw_sheet_uuid`
- `date`
- `bookingTime`
- `customer_full_name`
- `customerName`
- `phone`
- `lineId`
- `staffName`
- `staff_name`
- `treatment_code`
- `treatment_name`
- `treatment_name_en`
- `treatment_name_th`
- `treatment_display`
- `treatment_item_text`
- `treatment_plan_mode`
- `treatment_plan_package_id`
- `smooth_customer_package_id`
- `smooth_customer_package_status`
- `smooth_sessions_remaining`
- `has_continuous_course`

Observed response also includes extra raw/internal fields because the implementation spreads the SQL row before normalizing. Those extra fields are not a good dependency surface for external clients.

Example:

```json
{
  "ok": true,
  "rows": [
    {
      "id": "appointment-uuid",
      "appointment_id": "appointment-uuid",
      "scheduled_at": "2026-03-17T07:00:00.000Z",
      "status": "booked",
      "branch_id": "branch-uuid",
      "treatment_id": "treatment-uuid",
      "customer_id": "customer-uuid",
      "raw_sheet_uuid": null,
      "date": "2026-03-17",
      "bookingTime": "14:00",
      "customer_full_name": "Customer Name",
      "customerName": "Customer Name",
      "phone": "0812345678",
      "lineId": "lineid123",
      "staffName": "Staff One",
      "staff_name": "Staff One",
      "treatment_code": "smooth",
      "treatment_name": "Smooth",
      "treatment_name_en": "Smooth",
      "treatment_name_th": "",
      "treatment_display": "Smooth 1x 990",
      "treatment_item_text": "Smooth 1x 990",
      "treatment_plan_mode": "one_off",
      "treatment_plan_package_id": "",
      "smooth_customer_package_id": null,
      "smooth_customer_package_status": "",
      "smooth_sessions_remaining": 0,
      "has_continuous_course": false
    }
  ],
  "meta": {
    "warnings": [
      {
        "param": "limit",
        "provided": "999",
        "applied": 500,
        "reason": "exceeds max 500; capped to maximum"
      }
    ]
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid `date` or `branch_id` |
| `500` | Query failure, schema mismatch, or `SSOT_STAFF_MISSING` |

**Integration Notes**
- Use this instead of `/api/visits` for modern queue data.
- Treat `rows` as the canonical appointment queue.
- Do not assume undocumented raw fields are stable.
- Do not send text branch codes such as `branch-003` as queue filters; queue filtering is UUID-only today.

### `GET /api/appointment-drafts`
**Purpose**
- Reload persisted draft rows from PostgreSQL for staff dashboards or refresh-safe promo booking flows.

**Auth**
- Authenticated active staff/admin/owner user.

**Request**

Query params:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | `"draft"`, `"submitted"`, `"cancelled"`, or `"all"` | No | Default behavior is equivalent to `draft + submitted` |

**Validation / Business Rules**
- This endpoint reads persisted rows from `appointment_drafts`; it is not session-only storage.
- Default filter returns statuses `draft` and `submitted`.
- `status=cancelled` returns cancelled drafts only.
- `status=all` returns all currently known statuses: `draft`, `submitted`, `cancelled`.
- Sort order is `updated_at DESC`, then `created_at DESC`, then `id DESC`.
- Drafts remain reloadable after refresh because rows stay in PostgreSQL until they are updated, cancelled, or submitted.
- There is no dedicated delete endpoint in current code.

**Response**
- `200`

```json
{
  "ok": true,
  "drafts": [
    {
      "id": "draft-uuid",
      "status": "draft",
      "customer_full_name": "Promo Customer",
      "phone": "0812345678",
      "branch_id": "branch-003",
      "treatment_id": "treatment-uuid",
      "treatment_item_text": "Smooth 1x 399",
      "package_id": null,
      "staff_name": null,
      "scheduled_at": null,
      "receipt_evidence": {
        "receipt_image_ref": "s3://promo/bill-001.jpg",
        "receipt_identifier": "promo-bill-001",
        "total_amount_thb": 399
      },
      "source": "promo_receipt_draft",
      "flow_metadata": {
        "campaign_code": "SUMMER_GLOW"
      },
      "created_by_staff_user_id": "staff-user-uuid",
      "updated_by_staff_user_id": "staff-user-uuid",
      "submitted_appointment_id": null,
      "submitted_at": null,
      "created_at": "2026-03-17T10:00:00.000Z",
      "updated_at": "2026-03-17T10:05:00.000Z"
    }
  ],
  "meta": {
    "applied_status_filter": ["draft", "submitted"],
    "sort": "updated_at_desc"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid `status` filter |
| `500` | Unhandled server error |

**Integration Notes**
- Use this endpoint after refresh to rebuild the draft dashboard from PostgreSQL.
- Do not expect queue rows here; these are still draft buffer records only.
- If a flow needs cancelled drafts too, call with `?status=cancelled` or `?status=all`.

### `POST /api/appointment-drafts`
**Purpose**
- Create a draft buffer row for promo/receipt-qualified booking data before a real appointment exists.

**Auth**
- Authenticated active staff/admin/owner user.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | `"draft"` or `"cancelled"` | No | Defaults to `draft`; `submitted` cannot be written manually |
| `customer_full_name` | string | No | Optional at draft stage |
| `phone` | string | No | If supplied, digits are normalized and must contain at least 9 digits |
| `branch_id` | string | No | Text-tolerant write value; no UUID enforcement on draft write paths |
| `treatment_id` | UUID | No | Optional at draft stage |
| `treatment_item_text` | string | No | Optional display/helper text |
| `package_id` | UUID | No | Optional |
| `staff_name` | string | No | Nullable until final booking |
| `scheduled_at` | ISO datetime with timezone | No | Nullable until final booking |
| `receipt_evidence` | object or `null` | No | Uses the same supported receipt shape as `POST /api/appointments` |
| `source` | string | No | Defaults to `promo_receipt_draft` |
| `flow_metadata` | object or `null` | No | Optional JSON object for promo/flow context |

**Validation / Business Rules**
- This endpoint does not create a real appointment.
- `scheduled_at` may be omitted.
- `staff_name` may be omitted.
- `treatment_id` and `package_id` must be UUIDs when supplied.
- `scheduled_at` must include timezone offset when supplied.
- `receipt_evidence` uses the same backend-supported receipt field contract as canonical appointment create.
- `created_by_staff_user_id` and `updated_by_staff_user_id` are filled from the authenticated session user, not from request body.

**Response**
- `201`

```json
{
  "ok": true,
  "draft": {
    "id": "draft-uuid",
    "status": "draft",
    "customer_full_name": "Promo Customer",
    "phone": "0812345678",
    "branch_id": "branch-003",
    "treatment_id": "treatment-uuid",
    "treatment_item_text": "Smooth 1x 399",
    "package_id": null,
    "staff_name": null,
    "scheduled_at": null,
    "receipt_evidence": {
      "receipt_image_ref": "s3://promo/bill-001.jpg",
      "receipt_identifier": "promo-bill-001",
      "total_amount_thb": 399
    },
    "source": "promo_receipt_draft",
    "flow_metadata": {
      "campaign_code": "SUMMER_GLOW"
    },
    "created_by_staff_user_id": "staff-user-uuid",
    "updated_by_staff_user_id": "staff-user-uuid",
    "submitted_appointment_id": null,
    "submitted_at": null,
    "created_at": "2026-03-17T10:00:00.000Z",
    "updated_at": "2026-03-17T10:00:00.000Z"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid UUIDs, invalid phone, invalid `scheduled_at`, invalid `receipt_evidence`, invalid `flow_metadata`, immutable fields in body |
| `500` | Unhandled server error |

**Integration Notes**
- Use this endpoint when promo/receipt verification is complete but date/time/staff is still unknown.
- Saving a draft here does not place anything in the runtime appointment queue.
- After creating a draft, use `GET /api/appointment-drafts` or `GET /api/appointment-drafts/:id` to reload it after refresh.

### `GET /api/appointment-drafts/:id`
**Purpose**
- Read one draft buffer row by id.

**Auth**
- Authenticated active staff/admin/owner user.

**Request**
- Path param `id` must be UUID.

**Validation / Business Rules**
- Returns one row from `appointment_drafts`.

**Response**
- `200`

```json
{
  "ok": true,
  "draft": {
    "id": "draft-uuid",
    "status": "draft",
    "submitted_appointment_id": null
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid draft id |
| `404` | Draft not found |
| `500` | Unhandled server error |

**Integration Notes**
- This is a draft-buffer read only; the row is not a real appointment yet.

### `PATCH /api/appointment-drafts/:id`
**Purpose**
- Update draft fields before final submit.

**Auth**
- Authenticated active staff/admin/owner user.

**Request**
- Path param `id` must be UUID.

Supported body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | `"draft"` or `"cancelled"` | No | `submitted` cannot be set manually |
| `customer_full_name` | string or empty | No | Empty clears the value |
| `phone` | string or empty | No | Empty clears the value |
| `branch_id` | string or empty | No | Empty clears the value; still text-tolerant on draft write paths |
| `treatment_id` | UUID or empty | No | Empty clears the value |
| `treatment_item_text` | string or empty | No | Empty clears the value |
| `package_id` | UUID or empty | No | Empty clears the value |
| `staff_name` | string or empty | No | Often filled later |
| `scheduled_at` | ISO datetime with timezone or empty | No | Often filled later |
| `receipt_evidence` | object or `null` | No | `null` clears the value |
| `source` | string or empty | No | Empty resets to default `promo_receipt_draft` |
| `flow_metadata` | object or `null` | No | `null` clears the value |

**Validation / Business Rules**
- Submitted drafts cannot be edited.
- Immutable fields cannot be written directly:
  - `id`
  - `submitted_appointment_id`
  - `submitted_at`
  - `created_at`
  - `updated_at`
  - `created_by_staff_user_id`
  - `updated_by_staff_user_id`
- `updated_by_staff_user_id` and `updated_at` are maintained by the backend.
- If no effective mutable fields are supplied, returns `400`.

**Response**
- `200`

```json
{
  "ok": true,
  "draft": {
    "id": "draft-uuid",
    "status": "draft",
    "staff_name": "Provider Mint",
    "scheduled_at": "2026-03-21T14:00:00+07:00"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid patch payload, immutable fields, no changes detected |
| `404` | Draft not found |
| `409` | Draft already submitted |
| `500` | Unhandled server error |

**Integration Notes**
- This is the endpoint that fills the missing booking details later.
- `cancelled` is a draft-table status only; it is not an appointment status.
- Setting `status=cancelled` here is the current backend-side way to retire a draft without submitting it.

### `POST /api/appointment-drafts/:id/submit`
**Purpose**
- Convert a complete draft into a real canonical appointment.

**Auth**
- Authenticated active staff/admin/owner user.

**Request**
- Path param `id` must be UUID.
- No request body required.

**Validation / Business Rules**
- Draft must exist.
- Draft current status must not already be `submitted`.
- Draft current status must not be `cancelled`.
- Before submit, backend requires the draft to have:
  - `customer_full_name`
  - `phone`
  - `treatment_id`
  - `branch_id`
  - `scheduled_at`
  - `staff_name`
- Submit reuses the same canonical appointment creation service used by `POST /api/appointments`.
- Draft submit passes through the same canonical create business rules:
  - future-time enforcement
  - slot collision check
  - customer resolution by phone
  - package inference / package-style validation
  - optional receipt evidence linkage
- On success:
  - creates a real appointment row
  - updates draft `status = submitted`
  - sets `submitted_appointment_id`
  - sets `submitted_at`
- Draft row remains in `appointment_drafts` for traceability after submit.

**Response**
- `200`

```json
{
  "ok": true,
  "draft": {
    "id": "draft-uuid",
    "status": "submitted",
    "submitted_appointment_id": "appointment-uuid",
    "submitted_at": "2026-03-17T11:00:00.000Z"
  },
  "appointment": {
    "appointment_id": "appointment-uuid",
    "customer_id": "customer-uuid",
    "customer_package_id": null,
    "receipt_evidence": {
      "id": "receipt-uuid",
      "appointment_id": "appointment-uuid"
    }
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid draft id or invalid draft payload state |
| `404` | Draft not found |
| `409` | Draft already submitted, draft cancelled, or canonical create hits slot/package conflict |
| `422` | Draft missing required submit fields, canonical create validation failure |
| `500` | Unhandled server error |

**Integration Notes**
- This is the bridge from buffer storage to a real appointment.
- Do not create real appointments directly from partial promo data if the required booking fields are still unknown; save draft first, submit later.

### `POST /api/appointments`
**Purpose**
- Create a new local appointment in the appointments-first system.

**Auth**
- Authenticated active staff/admin/owner user.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `scheduled_at` | ISO datetime with timezone | Conditionally | Preferred modern input |
| `visit_date` | `YYYY-MM-DD` | Conditionally | Legacy alias; used only if `scheduled_at` absent |
| `visit_time_text` | `HH:MM` | Conditionally | Legacy alias; used only if `scheduled_at` absent |
| `branch_id` | string | No | Write path accepts non-empty text; defaults to `DEFAULT_BRANCH_ID` or literal `branch-003` when `receipt_evidence` is absent |
| `customer_full_name` | string | Yes | Required text |
| `phone` | string | Yes unless `phone_raw` used | Digits are extracted |
| `phone_raw` | string | Yes unless `phone` used | Legacy alias |
| `email_or_lineid` | string | No | Stored only in event metadata here |
| `staff_name` | string | No | Stored in event metadata |
| `treatment_id` | UUID or inferred code input | Usually yes | Preferred explicit UUID |
| `treatment_item_text` | string | Conditionally | Used for package inference or treatment inference if `treatment_id` absent |
| `package_id` | UUID | No | Required for package-style treatments or explicit package mode |
| `receipt_evidence` | object | No | Optional receipt linkage; if supplied, `branch_id` must be explicitly provided |
| `override` | object | No | Admin/owner override payload; see below |

`receipt_evidence` object shape:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `receipt_image_ref` | string | No | Storage key/path/URL-like reference; backend stores the string as-is |
| `receipt_number` | string | No | Optional printed receipt number |
| `receipt_line` | string | No | Optional line or row reference from receipt source |
| `receipt_identifier` | string | No | Optional external receipt identifier |
| `total_amount_thb` | number | No | Optional non-negative amount; rounded to 2 decimals before insert |
| `ocr_status` | string | No | Optional OCR state text |
| `ocr_raw_text` | string | No | Optional OCR text payload |
| `ocr_metadata` | object | No | Optional JSON object; arrays are rejected |
| `verification_source` | string | No | Optional source label such as promo/special-event verifier |
| `verification_metadata` | object | No | Optional JSON object for verifier/promo metadata |

`override` object shape:

```json
{
  "is_override": true,
  "reason": "ADMIN_OVERRIDE",
  "confirmed_at": "2026-03-17T14:00:00+07:00",
  "violations": ["SLOT_COLLISION"]
}
```

Receipt-backed example:

```json
{
  "scheduled_at": "2026-03-20T14:00:00+07:00",
  "branch_id": "branch-uuid-or-code",
  "customer_full_name": "Customer Name",
  "phone": "0812345678",
  "treatment_id": "treatment-uuid",
  "receipt_evidence": {
    "receipt_image_ref": "s3://promo-receipts/2026/03/17/abc123.jpg",
    "receipt_number": "RCP-20260317-0091",
    "receipt_identifier": "promo-verify-abc123",
    "total_amount_thb": 1299,
    "ocr_status": "verified",
    "ocr_raw_text": "RAW OCR TEXT",
    "ocr_metadata": {
      "engine": "vision-v1",
      "confidence": 0.98
    },
    "verification_source": "special_event",
    "verification_metadata": {
      "campaign_code": "SUMMER_GLOW_2026"
    }
  }
}
```

**Validation / Business Rules**
- `scheduled_at` rules:
  - must include timezone offset
  - must be in the future for normal staff create
  - admin/owner can bypass future-time check only when `override.is_override === true` and override payload is valid
- If `scheduled_at` is absent:
  - `visit_date` and `visit_time_text` become required
  - `visit_date` must be `YYYY-MM-DD`
  - `visit_time_text` must be `HH:MM`
- `customer_full_name` required.
- If `receipt_evidence` is omitted, the existing canonical create flow is unchanged:
  - `branch_id` can still fall back to `DEFAULT_BRANCH_ID` / `branch-003`
  - no `appointment_receipts` row is inserted
- If `receipt_evidence` is supplied:
  - it must be a JSON object
  - at least one supported receipt field must be non-empty
  - `branch_id` becomes required and cannot rely on the default fallback
  - `ocr_metadata` and `verification_metadata` must be JSON objects when supplied
  - `total_amount_thb` must be a non-negative number when supplied
- Phone:
  - digits only after normalization
  - minimum length `9`
- `treatment_id` behavior:
  - explicit UUID must exist in `treatments`
  - if omitted, backend tries to infer from `treatment_item_text`
  - inference is heuristic; external clients should not rely on it
- Slot collision:
  - same `branch_id + scheduled_at`
  - conflicting statuses: `booked`, `rescheduled`
  - returns `409` unless admin override is active
- Customer resolution:
  - resolves by active `PHONE` identity
  - if same phone already belongs to a customer, appointment reuses that customer
  - if `customer_full_name` differs, backend updates `customers.full_name`
- Package handling:
  - `package_id` must be UUID if provided
  - package-style treatment text requires a resolvable `package_id`
  - inferred package matching is currently heuristic and smooth-focused
- Side effects:
  - creates/links customer
  - inserts appointment with status `booked`
  - optionally inserts one linked `appointment_receipts` row
  - writes `appointment_events` row with `event_type='created'`
  - may auto-create an active `customer_package`
  - admin override also writes `appointment_override_logs`

**Response**
- `200`

```json
{
  "ok": true,
  "appointment_id": "appointment-uuid",
  "customer_id": "customer-uuid",
  "customer_package_id": "customer-package-uuid",
  "receipt_evidence": {
    "id": "receipt-uuid",
    "appointment_id": "appointment-uuid",
    "receipt_image_ref": "s3://promo-receipts/2026/03/17/abc123.jpg",
    "receipt_number": "RCP-20260317-0091",
    "receipt_line": null,
    "receipt_identifier": "promo-verify-abc123",
    "total_amount_thb": 1299,
    "ocr_status": "verified",
    "ocr_raw_text": "RAW OCR TEXT",
    "ocr_metadata": {
      "engine": "vision-v1",
      "confidence": 0.98
    },
    "verification_source": "special_event",
    "verification_metadata": {
      "campaign_code": "SUMMER_GLOW_2026"
    },
    "created_at": "2026-03-17T08:35:20.000Z",
    "updated_at": "2026-03-17T08:35:20.000Z"
  }
}
```

Success response when no receipt evidence is supplied:

```json
{
  "ok": true,
  "appointment_id": "appointment-uuid",
  "customer_id": "customer-uuid",
  "customer_package_id": null,
  "receipt_evidence": null
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Missing/invalid fields, invalid datetime, invalid IDs, missing phone, invalid override payload, invalid/empty `receipt_evidence`, missing explicit `branch_id` when `receipt_evidence` is sent |
| `409` | Time slot already booked |
| `422` | Unable to resolve customer, inferred treatment not found, package required for package-style treatment, line-user FK issue |
| `500` | Unhandled server error |

**Integration Notes**
- Prefer explicit `treatment_id` from `GET /api/appointments/booking-options`.
- Prefer explicit `package_id` when using package-style bookings.
- For receipt-backed or promo/special-event booking, still use this endpoint. Do not create a separate temporary booking system.
- Send `branch_id` explicitly when using `receipt_evidence`.
- Run the receipt migration before using `receipt_evidence`; otherwise create can fail because this endpoint does not have a missing-table fallback.
- Reusing a phone number can update the existing customer name. See [Section 9](#9-customer-identity-and-resolution-rules).

### `POST /api/appointments/:id/complete`
**Purpose**
- Mark an appointment completed and, if a package is supplied, deduct one session and optional mask.

**Auth**
- Authenticated active staff/admin/owner user.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `customer_package_id` | UUID | No | Required only when deducting from a package |
| `used_mask` | boolean | No | Coerced with `Boolean(...)` |
| `deduct_sessions` | integer | No | If present, must equal `1` |
| `deduct_mask` | integer | No | If present, must be `0` or `1`; defaults from `used_mask` |

**Validation / Business Rules**
- Appointment must exist.
- Allowed current statuses for the non-idempotent completion path:
  - `booked`
  - `rescheduled`
  - `ensured`
  - `confirmed`
- If already `completed`, endpoint short-circuits and returns idempotent success instead of failing.
- If appointment has no `customer_id`, returns `422`.
- If any `package_usages` already exist for this appointment, returns `409`.
- One-off completion:
  - allowed when no `customer_package_id` is supplied
  - no session/mask deduction allowed in this case
  - status becomes `completed`
  - event `redeemed` is written
- Package completion:
  - `customer_package_id` must be valid
  - package must belong to appointment customer
  - package must be active
  - package must have remaining sessions
  - if deducting mask, package must have remaining mask allowance
  - inserts one `package_usages` row
  - status becomes `completed`
  - package continuity status may flip `active -> completed` when remaining sessions reach 0

**Response**
- `200`
- Three observed success shapes:

Idempotent already-completed:

```json
{
  "ok": true,
  "data": {
    "appointment_id": "appointment-uuid",
    "status": "completed",
    "already_completed": true,
    "idempotent": true,
    "usage": {
      "customer_package_id": "customer-package-uuid",
      "session_no": 3,
      "used_mask": false
    },
    "package": {
      "customer_package_id": "customer-package-uuid",
      "status": "active"
    },
    "remaining": {
      "sessions_remaining": 2,
      "mask_remaining": 0
    }
  }
}
```

One-off completion:

```json
{
  "ok": true,
  "data": {
    "appointment_id": "appointment-uuid",
    "status": "completed",
    "usage": null
  }
}
```

Package completion:

```json
{
  "ok": true,
  "data": {
    "appointment_id": "appointment-uuid",
    "status": "completed",
    "usage": {
      "customer_package_id": "customer-package-uuid",
      "package_code": "SMOOTH_C3_3900_M0",
      "session_no": 2,
      "sessions_deducted": 1,
      "mask_deducted": 0,
      "used_mask": false
    },
    "package": {
      "customer_package_id": "customer-package-uuid",
      "status": "active",
      "package_code": "SMOOTH_C3_3900_M0",
      "package_title": "Smooth 3 Sessions",
      "sessions_total": 3,
      "sessions_used": 2,
      "sessions_remaining": 1,
      "mask_total": 0,
      "mask_used": 0,
      "mask_remaining": 0
    },
    "remaining": {
      "sessions_remaining": 1,
      "mask_remaining": 0
    }
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid deduction payload or invalid `customer_package_id` |
| `404` | Appointment or customer package not found |
| `409` | Invalid current status, duplicate usage, inactive package, no remaining sessions/masks |
| `422` | Appointment missing customer, package belongs to another customer, trying to deduct without selecting a package |
| `500` | Unhandled server error |

**Integration Notes**
- This is the canonical deduction path. Do not simulate completion with a raw admin status patch unless you intentionally want no deduction.
- Send real JSON booleans for `used_mask`.

### `POST /api/appointments/:id/cancel`
**Purpose**
- Mark an appointment cancelled without package deduction.

**Auth**
- Authenticated active staff/admin/owner user.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `note` | string | No | Preferred free-text note |
| `reason` | string | No | Legacy alias if `note` missing |

**Validation / Business Rules**
- Appointment must exist.
- Current status must be one of:
  - `booked`
  - `rescheduled`
  - `ensured`
  - `confirmed`
- No `package_usages` are created or deleted here.
- Writes an `appointment_events` row with `event_type='cancelled'`.

**Response**
- `200`

```json
{
  "ok": true,
  "data": {
    "appointment_id": "appointment-uuid",
    "status": "cancelled"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `404` | Appointment not found |
| `409` | Current status cannot change through this route |
| `500` | Unhandled server error |

**Integration Notes**
- Prefer this over `DELETE /api/appointments/:id` for authenticated modern flows.

### `POST /api/appointments/:id/no-show`
**Purpose**
- Mark an appointment as no-show without package deduction.

**Auth**
- Authenticated active staff/admin/owner user.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `note` | string | No | Preferred free-text note |
| `reason` | string | No | Legacy alias if `note` missing |

**Validation / Business Rules**
- Same mutation preconditions as `cancel`.
- Writes an `appointment_events` row with `event_type='no_show'`.
- No course deduction occurs here.

**Response**
- `200`

```json
{
  "ok": true,
  "data": {
    "appointment_id": "appointment-uuid",
    "status": "no_show"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `404` | Appointment not found |
| `409` | Current status cannot change through this route |
| `500` | Unhandled server error |

**Integration Notes**
- `cancel` and `no-show` are status-only operations. Neither deducts a course.

### `POST /api/appointments/:id/revert`
**Purpose**
- Revert a completed/no-show/cancelled appointment back to `booked`, and undo any package usage tied to that appointment.

**Auth**
- Authenticated plus admin/owner role check inside the controller.

**Request**
- No body required.

**Validation / Business Rules**
- Non-admin/non-owner receives `403`.
- Appointment must exist.
- Revert is allowed when:
  - current status is `completed`
  - or `no_show`
  - or `cancelled` / `canceled`
  - or current status is `booked` but the appointment still has lingering `package_usages`
- If package usage rows exist, they are deleted.
- Appointment status becomes `booked`.
- Affected customer packages are recalculated; package continuity status may flip `completed -> active`.

**Response**
- `200`

```json
{
  "ok": true,
  "data": {
    "appointment_id": "appointment-uuid",
    "status": "booked",
    "restored_packages": [
      {
        "customer_package_id": "customer-package-uuid",
        "status": "active",
        "sessions_remaining": 2,
        "mask_remaining": 0
      }
    ]
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `403` | Authenticated user is not `admin` or `owner` |
| `404` | Appointment not found |
| `409` | Appointment is not revertable |
| `500` | Unhandled server error |

**Integration Notes**
- This is the canonical rollback path for completed appointments with package deduction.

### `POST /api/appointments/:id/sync-course`
**Purpose**
- Ensure the appointment’s customer has an active `customer_package` linked to the appointment’s inferred package.

**Auth**
- Authenticated.

**Request**
- No body required.

**Validation / Business Rules**
- Appointment ID must be UUID.
- Appointment must exist and have `customer_id`.
- Package mapping resolution order:
  1. event-sourced `package_id`
  2. event-sourced `treatment_item_text` inference
  3. default smooth one-off package fallback when treatment code is `smooth`
- If no package mapping is found, endpoint returns success with `synced: false`.
- If mapping is found, ensures an active `customer_package`.

**Response**
- `200`

No mapping found:

```json
{
  "ok": true,
  "synced": false,
  "reason": "No package mapping found"
}
```

Mapping found:

```json
{
  "ok": true,
  "synced": true,
  "package_id": "package-uuid",
  "customer_package_id": "customer-package-uuid"
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid appointment id |
| `404` | Appointment not found |
| `422` | Appointment has no customer |
| `500` | Unhandled server error |

**Integration Notes**
- Use this only as a helper when you need package linkage repaired or created after the fact.

### `POST /api/appointments/admin/backdate`
**Purpose**
- Create an appointment in the past for admin/owner workflows.

**Auth**
- Authenticated admin/owner.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `scheduled_at` | ISO datetime with timezone | Yes | Must be in the past |
| `branch_id` | string | Yes | Non-empty text |
| `treatment_id` | UUID | Yes | Must exist |
| `customer_full_name` | string | Yes | Required |
| `staff_name` | string | Yes | Required |
| `treatment_item_text` | string | Yes | Required |
| `reason` | string | Yes | Minimum 5 chars |
| `phone` | string | Yes | Digits extracted, min 9 |
| `email_or_lineid` | string | No | Optional |
| `raw_sheet_uuid` | UUID | No | Optional legacy linkage |
| `status` | string | No | Only `completed` or `booked` are honored; anything else becomes `completed` |
| `selected_toppings` | string[] | No | Optional topping codes |
| `addons_total_thb` | non-negative integer | No | Defaults to `0` |
| `package_id` | UUID | No | Optional explicit package |
| `treatment_plan_mode` | `"" \| "one_off" \| "package"` | No | Optional |

**Validation / Business Rules**
- Requires admin actor identity from authenticated user.
- `scheduled_at` must include timezone offset and be in the past.
- `treatment_id`, `raw_sheet_uuid`, and `package_id` must be UUIDs when provided.
- `selected_toppings` must be an array of short strings.
- Customer resolution is by PHONE identity, same as normal booking create.
- Package plan rules:
  - if `treatment_plan_mode=package`, a resolvable `package_id` is required
  - if `treatment_plan_mode=one_off`, package linkage is cleared
  - package-style treatment text still requires package linkage
- Side effects:
  - ensures special backdate line-user row `__BACKDATE__`
  - inserts appointment with source `ADMIN`
  - writes `appointment_events` row `ADMIN_BACKDATE_CREATE`
  - may auto-create active `customer_package`

**Response**
- `200`

```json
{
  "ok": true,
  "appointment_id": "appointment-uuid",
  "customer_id": "customer-uuid",
  "customer_package_id": "customer-package-uuid"
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid payload, invalid IDs, bad reason, invalid phone, missing package for package mode |
| `401` | Missing admin actor identity |
| `409` | Duplicate record |
| `422` | Unable to resolve customer, package-style treatment missing package, event constraint issues, missing backdate line-user FK |
| `500` | Unhandled server error |

**Integration Notes**
- Use this instead of forcing a normal future-booking route to accept past dates.

### `POST /api/appointments/from-sheet/:sheetUuid/ensure`
**Purpose**
- Ensure a local appointment exists for a legacy sheet row.

**Auth**
- Authenticated admin/owner.

**Request**
- Path param `sheetUuid` must be UUID.

**Validation / Business Rules**
- Reads `sheet_visits_raw` where `deleted_at IS NULL`.
- If an appointment already exists with this `raw_sheet_uuid`, returns it.
- Customer resolution order:
  1. existing appointment customer
  2. active `PHONE` identity from sheet phone
  3. create customer and optional PHONE identity
- Creates/ensures a `line_users` row with:
  - `phone:{digits}` when phone exists
  - otherwise `sheet:{sheetUuid}`
- For package-style sheet treatments, package inference must succeed or endpoint returns `422`.
- If creating a new appointment:
  - time is parsed from sheet `visit_time_text`
  - treatment code is inferred heuristically from `treatment_item_text`
  - branch defaults to `DEFAULT_BRANCH_ID` or `branch-003`
  - appointment source is `SHEET`
- Writes `appointment_events` row `created`.

**Response**
- `200`

```json
{
  "ok": true,
  "appointment": {
    "id": "appointment-uuid",
    "customer_id": "customer-uuid",
    "line_user_id": "phone:0812345678",
    "treatment_id": "treatment-uuid",
    "branch_id": "branch-003",
    "scheduled_at": "2026-03-17T07:00:00+07:00",
    "status": "booked",
    "source": "SHEET",
    "raw_sheet_uuid": "sheet-uuid"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid sheet UUID |
| `404` | Legacy sheet row not found |
| `409` | Observed generic duplicate/usage conflict path |
| `422` | Unable to resolve customer, invalid visit date/time, cannot infer treatment, treatment not found, package required for package-style treatment |
| `500` | Unhandled server error |

**Integration Notes**
- This is migration/admin tooling, not the preferred new-booking flow.

### `GET /api/appointments`
**Purpose**
- Proxy a legacy appointment list from Google Apps Script (GAS).

**Auth**
- Public by route code.

**Request**

| Query | Type | Required | Notes |
| --- | --- | --- | --- |
| `limit` | integer | No | Default `50`, max `500` |

**Validation / Business Rules**
- Requires `GAS_APPOINTMENTS_URL` and `GAS_SECRET`.
- Calls GAS action `appointments_get`.
- Backend does not normalize the upstream response beyond forwarding JSON.

**Response**
- `200`
- Shape is upstream-defined by GAS, not by this backend contract.

**Errors**

| Status | Trigger |
| --- | --- |
| `500` | Missing GAS config |
| `502` | GAS returned `ok: false` |
| `504` | GAS request aborted/timed out |

**Integration Notes**
- Do not use this as the queue source for new integrations.
- Response shape is not stabilized by this backend code.

### `POST /api/appointments/delete-hard`
**Purpose**
- Proxy a hard delete request to Google Apps Script.

**Auth**
- Public by route code.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | Yes | Upstream GAS appointment ID |

**Validation / Business Rules**
- Requires GAS config.
- Calls GAS action `appointments_delete_hard`.
- Response is forwarded from GAS.

**Response**
- `200`
- Shape is upstream-defined by GAS.

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Missing `id` |
| `500` | Missing GAS config |
| `502` | GAS returned `ok: false` |
| `504` | GAS timeout/abort |

**Integration Notes**
- Legacy only.

### `DELETE /api/appointments/:id`
**Purpose**
- Soft-delete/cancel a local appointment row by setting status to `cancelled`.

**Auth**
- Public by route code.

**Request**
- Path param `id`

**Validation / Business Rules**
- Updates local `appointments.status = 'cancelled'` only if current status is not already cancelled/canceled.
- Returns `404` if no row was updated. That includes:
  - unknown appointment ID
  - already-cancelled appointment
- Does not write appointment events.

**Response**
- `200`

```json
{
  "ok": true
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Missing path `id` |
| `404` | Appointment not found or already cancelled |
| `500` | Unhandled server error |

**Integration Notes**
- This is not the preferred modern cancel path.
- Prefer authenticated `POST /api/appointments/:id/cancel`.

### `GET /api/admin/appointments/:appointmentId`
**Purpose**
- Fetch admin detail for one appointment plus active packages for its customer.

**Auth**
- Authenticated admin/owner.

**Request**
- Path param `appointmentId` must be UUID.

**Validation / Business Rules**
- Appointment must exist.
- `staff_name` must be resolvable from SSOT/event history or endpoint returns `500`.
- `treatment_item_text`, `treatment_plan_mode`, and `package_id` come from event history resolution, not just the appointment row.
- `receipt_evidence` is read from `appointment_receipts` when that table exists.
- If the migration has not been applied yet, current code tolerates missing `appointment_receipts` and returns `receipt_evidence: null` instead of failing this endpoint.
- `active_packages` only lists packages with active status for the appointment’s customer.

**Response**
- `200`

```json
{
  "ok": true,
  "appointment": {
    "id": "appointment-uuid",
    "scheduled_at": "2026-03-17T07:00:00.000Z",
    "branch_id": "branch-uuid",
    "treatment_id": "treatment-uuid",
    "status": "booked",
    "raw_sheet_uuid": null,
    "customer_id": "customer-uuid",
    "customer_full_name": "Customer Name",
    "treatment_code": "smooth",
    "treatment_title": "Smooth",
    "phone": "0812345678",
    "line_id": "lineid123",
    "email": "",
    "staff_name": "Staff One",
    "email_or_lineid": "lineid123",
    "treatment_item_text": "Smooth 3x 3900",
    "treatment_plan_mode": "package",
    "package_id": "package-uuid"
  },
  "receipt_evidence": {
    "id": "receipt-uuid",
    "appointment_id": "appointment-uuid",
    "receipt_image_ref": "s3://promo-receipts/2026/03/17/abc123.jpg",
    "receipt_number": "RCP-20260317-0091",
    "receipt_line": null,
    "receipt_identifier": "promo-verify-abc123",
    "total_amount_thb": 1299,
    "ocr_status": "verified",
    "ocr_raw_text": "RAW OCR TEXT",
    "ocr_metadata": {
      "engine": "vision-v1",
      "confidence": 0.98
    },
    "verification_source": "special_event",
    "verification_metadata": {
      "campaign_code": "SUMMER_GLOW_2026"
    },
    "created_at": "2026-03-17T08:35:20.000Z",
    "updated_at": "2026-03-17T08:35:20.000Z"
  },
  "active_packages": [
    {
      "customer_package_id": "customer-package-uuid",
      "status": "active",
      "package_code": "SMOOTH_C3_3900_M0",
      "package_title": "Smooth 3 Sessions",
      "sessions_total": 3,
      "sessions_used": 1,
      "sessions_remaining": 2,
      "mask_total": 0,
      "mask_used": 0,
      "mask_remaining": 0,
      "price_thb": 3900
    }
  ]
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid appointmentId |
| `404` | Appointment not found |
| `500` | Server error or `SSOT_STAFF_MISSING` |

**Integration Notes**
- Use this for admin edit screens rather than trying to reconstruct package state from queue rows.
- Receipt evidence is exposed here, not in queue rows. If an integration needs the stored receipt linkage after create, use the create response or this admin detail endpoint.

### `PATCH /api/admin/appointments/:appointmentId`
**Purpose**
- Admin maintenance endpoint for editing appointment, customer identity, treatment plan, and optionally status/package usage.

**Auth**
- Authenticated admin/owner.

**Request**
- Path param `appointmentId` must be UUID.
- `reason` is always required and must be at least 5 characters.
- Immutable request fields:
  - `id`
  - `appointment_id`
  - `customer_id`

Supported body fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string | Yes | Required audit reason, min 5 chars |
| `scheduled_at` | ISO datetime with timezone | No | Any valid ISO with timezone; not limited to future/past |
| `branch_id` | string | No | Non-empty text |
| `treatment_id` | UUID | No | Must exist |
| `treatment_item_text` | string | No | Event-sourced plan field |
| `treatment_plan_mode` | `"" \| "one_off" \| "package"` | No | Event-sourced plan field |
| `package_id` | UUID or empty string | No | Event-sourced plan field |
| `unlink_package` | boolean | No | Required for clearing package linkage |
| `status` | allowed status string | No | See lifecycle rules |
| `confirm_cancelled_to_completed` | boolean-like | No | Required when current status is cancelled and target is completed |
| `raw_sheet_uuid` | UUID or empty | No | Dangerous linkage change |
| `confirm_raw_sheet_uuid_change` | boolean-like | No | Required with raw sheet UUID change |
| `confirm_raw_sheet_uuid_change_ack` | boolean-like | No | Required with raw sheet UUID change |
| `staff_name` | string | No | Event-sourced field |
| `phone` | string | No | Writes/changes PHONE identity |
| `reassign_customer_by_phone` | boolean | No | Required for moving appointment to another customer that already owns this phone |
| `customer_full_name` | string | No | Updates `customers.full_name` |
| `email_or_lineid` | string | No | Stored as EMAIL or LINE active identity |
| `create_package_usage` | boolean-like | No | Optional admin-side deduction helper |
| `customer_package_id` | UUID | No | Required when `create_package_usage` is used |
| `used_mask` | boolean-like | No | Optional when `create_package_usage` is used |

**Validation / Business Rules**
- Appointment must exist and have `customer_id`.
- `scheduled_at` must include timezone offset.
- `treatment_id` and `package_id` must exist when supplied.
- Treatment plan rules:
  - `unlink_package` must be boolean if supplied
  - clearing `package_id` requires `unlink_package=true`
  - switching to `one_off` while linked to a package requires unlink first
  - package-style treatment text requires a package linkage
  - `treatment_plan_mode=package` requires `package_id`
- Status patch rules:
  - allowed target statuses:
    - `booked`
    - `completed`
    - `cancelled`
    - `no_show`
    - `rescheduled`
    - `ensured`
    - `confirmed`
    - `check_in`
    - `checked_in`
    - `pending`
  - current `cancelled -> completed` transition requires `confirm_cancelled_to_completed=true`
  - status patch uses admin status service:
    - patching to `booked` deletes all `package_usages` for the appointment
    - patching to non-`booked` status with zero usage rows produces warnings
    - patching to `completed` alone does not auto-create a usage row
- Raw sheet linkage:
  - changing `raw_sheet_uuid` requires both confirm flags truthy
- Phone handling:
  - phone is normalized Thai-style
  - if phone belongs to another customer and `reassign_customer_by_phone` is false, returns `409 PHONE_BELONGS_ANOTHER_CUSTOMER`
  - if `reassign_customer_by_phone=true`, appointment `customer_id` is moved to the owner customer
- `customer_full_name` changes the customer profile row, not just this appointment
- `email_or_lineid`:
  - values containing `@` are treated as EMAIL
  - otherwise treated as LINE
  - setting one clears the other provider’s active identity
- `create_package_usage`:
  - only allowed when resulting status is `completed`
  - creates one usage row
  - does not replace normal validation of package ownership/remaining balance
- If no effective changes are detected, returns `400`.
- Edits are recorded in `appointment_events` as `ADMIN_APPOINTMENT_UPDATE`.

**Response**
- `200`

```json
{
  "ok": true,
  "appointment_id": "appointment-uuid",
  "changed_fields": [
    "status",
    "customer_full_name",
    "package_usage"
  ],
  "before": {
    "status": "booked",
    "customer_full_name": "Old Name",
    "package_usage": null
  },
  "after": {
    "status": "completed",
    "customer_full_name": "New Name",
    "package_usage": {
      "customer_package_id": "customer-package-uuid",
      "package_code": "SMOOTH_C3_3900_M0",
      "package_title": "Smooth 3 Sessions",
      "session_no": 1,
      "used_mask": false
    }
  },
  "appointment": {
    "id": "appointment-uuid",
    "status": "completed"
  },
  "package_usage": {
    "customer_package_id": "customer-package-uuid",
    "package_code": "SMOOTH_C3_3900_M0",
    "package_title": "Smooth 3 Sessions",
    "session_no": 1,
    "used_mask": false
  },
  "revertedUsageCount": 0,
  "warnings": []
}
```

Conflict example when phone belongs to another customer:

```json
{
  "ok": false,
  "error": "Phone belongs to another customer. Set reassign_customer_by_phone=true to move appointment to that customer.",
  "code": "PHONE_BELONGS_ANOTHER_CUSTOMER",
  "conflict": {
    "customer_id": "customer-uuid",
    "customer_full_name": "Existing Owner",
    "phone": "0812345678"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid payload, missing reason, invalid IDs, invalid booleans for strict fields, unsupported status, no changes detected |
| `401` | Missing admin actor identity |
| `404` | Appointment not found, package/user not found in subflows |
| `409` | Cancelled-to-completed without confirm, phone conflict, usage/package invariants, package balance issues |
| `422` | Appointment missing customer, package-style treatment without package, package ownership mismatch, event constraint issues |
| `500` | Unhandled server error |

**Integration Notes**
- This endpoint mixes direct row updates, identity updates, event-sourced plan updates, status patching, and optional deduction. Treat it as an advanced admin tool.
- If you only need normal completion, prefer `POST /api/appointments/:id/complete`.
- Updating `customer_full_name` affects every appointment that shares the same `customer_id`.

### `GET /api/admin/staff-users`
**Purpose**
- List staff login users.

**Auth**
- Authenticated admin/owner.

**Request**
- No body/query.

**Validation / Business Rules**
- Reads from `staff_users` joined to `roles`.

**Response**
- `200`

```json
{
  "ok": true,
  "rows": [
    {
      "id": "user-uuid",
      "username": "staff01",
      "display_name": "Staff One",
      "role_name": "staff",
      "is_active": true,
      "created_at": "2026-03-01T00:00:00.000Z"
    }
  ]
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `500` | Unhandled server error |

**Integration Notes**
- This is account admin, not appointment admin.

### `POST /api/admin/staff-users`
**Purpose**
- Create a staff/admin/owner login.

**Auth**
- Authenticated admin/owner.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `username` | string | Yes | Unique |
| `password` | string | Yes | Minimum 6 chars |
| `display_name` | string | No | Defaults to username |
| `role_name` | `staff \| admin \| owner` | No | Defaults to `staff` |
| `is_active` | boolean | No | Defaults to `true` |

**Validation / Business Rules**
- Username required and unique.
- Password required, min 6.
- Role must be `staff`, `admin`, or `owner`.
- `is_active` must be boolean if provided.
- Role row is upserted in `roles`.

**Response**
- `201`

```json
{
  "ok": true,
  "data": {
    "id": "user-uuid",
    "username": "staff01",
    "display_name": "Staff One",
    "role_name": "staff",
    "is_active": true,
    "created_at": "2026-03-01T00:00:00.000Z",
    "updated_at": "2026-03-01T00:00:00.000Z"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Missing/invalid fields |
| `409` | Username already exists |
| `500` | Unable to resolve role or other server error |

**Integration Notes**
- Password is write-only; no endpoint returns hashes.

### `PATCH /api/admin/staff-users/:id`
**Purpose**
- Activate/deactivate a staff user or reset password.

**Auth**
- Authenticated admin/owner.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `is_active` | boolean | Conditionally | At least one of `is_active` or `password` is required |
| `password` | string | Conditionally | Minimum 6 chars |

**Validation / Business Rules**
- User id path param must be UUID.
- If neither `is_active` nor `password` is provided, returns `400`.
- `is_active` must be boolean if supplied.
- `password` must be min 6 chars if supplied.

**Response**
- `200`

```json
{
  "ok": true,
  "data": {
    "id": "user-uuid",
    "username": "staff01",
    "display_name": "Staff One",
    "role_name": "staff",
    "is_active": false,
    "created_at": "2026-03-01T00:00:00.000Z"
  }
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid user id or missing/invalid patch fields |
| `404` | User not found |
| `500` | Unhandled server error |

**Integration Notes**
- This endpoint does not edit `username`, `display_name`, or role.

### `GET /api/customers`
**Purpose**
- List recent customers.

**Auth**
- Public by route code.

**Request**
- No query/body.

**Validation / Business Rules**
- Returns at most 200 customers.
- Excludes rows where `lower(trim(full_name))` is exactly `test user` or `unknown`.
- Ordered by `created_at DESC`.

**Response**
- `200`

```json
{
  "ok": true,
  "rows": [
    {
      "id": "customer-uuid",
      "full_name": "Customer Name",
      "created_at": "2026-03-01T00:00:00.000Z"
    }
  ]
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `500` | Unhandled server error |

**Integration Notes**
- Endpoint is currently unauthenticated in code. Validate whether that matches your exposure requirements before relying on it externally.

### `GET /api/customers/:customerId/profile`
**Purpose**
- Return one customer plus package, usage-history, and appointment-history data.

**Auth**
- Public by route code.

**Request**

| Query | Type | Required | Notes |
| --- | --- | --- | --- |
| `appointment_limit` | integer | No | Default `50`, max `200` |

**Validation / Business Rules**
- `customerId` path param is required, but UUID format is not explicitly validated here.
- Returns `404` if customer not found.
- `packages`, `usage_history`, and `appointment_history` are built from local tables.
- Plan fields in `appointment_history` are event-resolved, similar to queue/admin detail.
- If package-related tables/columns are missing in the database, code degrades to empty arrays in some cases instead of hard failing.

**Response**
- `200`

```json
{
  "ok": true,
  "customer": {
    "id": "customer-uuid",
    "full_name": "Customer Name",
    "created_at": "2026-03-01T00:00:00.000Z"
  },
  "packages": [
    {
      "customer_package_id": "customer-package-uuid",
      "status": "active",
      "purchased_at": "2026-03-10T00:00:00.000Z",
      "expires_at": null,
      "package": {
        "code": "SMOOTH_C3_3900_M0",
        "title": "Smooth 3 Sessions",
        "sessions_total": 3,
        "mask_total": 0,
        "price_thb": 3900,
        "treatment_display": "Smooth 3x 3900"
      },
      "treatment_display": "Smooth 3x 3900",
      "usage": {
        "sessions_used": 1,
        "sessions_remaining": 2,
        "mask_used": 0,
        "mask_remaining": 0
      }
    }
  ],
  "usage_history": [
    {
      "treatment_display": "Smooth 3x 3900",
      "sessions_total": 3,
      "mask_total": 0,
      "price_thb": 3900,
      "used_at": "2026-03-17T08:00:00.000Z",
      "package_code": "SMOOTH_C3_3900_M0",
      "package_title": "Smooth 3 Sessions",
      "session_no": 1,
      "used_mask": false,
      "staff_display_name": "Staff One",
      "appointment_id": "appointment-uuid",
      "scheduled_at": "2026-03-17T07:00:00.000Z",
      "branch_id": "branch-uuid"
    }
  ],
  "appointment_history": [
    {
      "id": "appointment-uuid",
      "scheduled_at": "2026-03-17T07:00:00.000Z",
      "status": "completed",
      "branch_id": "branch-uuid",
      "treatment_id": "treatment-uuid",
      "treatment_code": "smooth",
      "treatment_name": "Smooth",
      "treatment_display": "Smooth 3x 3900",
      "treatment_plan_mode": "package",
      "treatment_plan_package_id": "package-uuid",
      "treatment_item_text": "Smooth 3x 3900"
    }
  ]
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Missing customerId |
| `404` | Customer not found |
| `500` | Unhandled server/query error |

**Integration Notes**
- Useful for detail screens, not for the main queue.
- Endpoint is currently unauthenticated in route code.

### `GET /api/visits`
**Purpose**
- Legacy visits endpoint that can read either sheet rows or appointments through a legacy wrapper.

**Auth**
- Authenticated, then `legacySheetGuard`.

**Request**

| Query | Type | Required | Notes |
| --- | --- | --- | --- |
| `source` | `sheet \| appointments` | No | Defaults to `sheet` |
| `date` | `YYYY-MM-DD` | No | Optional |
| `limit` | integer | No | Default `200`, max `500` |

**Validation / Business Rules**
- Non-admin/non-owner gets `410` unless `LEGACY_SHEET_MODE=true`.
- `source=sheet`:
  - reads `sheet_visits_raw`
  - excludes deleted rows
  - includes linked appointment status if one exists
- `source=appointments`:
  - reads local appointments
  - excludes only `cancelled/canceled`
  - still goes through legacy guard and is not the canonical queue endpoint
- `date` must be `YYYY-MM-DD` if present.
- `source=appointments` can fail with `SSOT_STAFF_MISSING`.

**Response**
- `200`

`source=sheet` example:

```json
{
  "ok": true,
  "rows": [
    {
      "date": "2026-03-17",
      "bookingTime": "14:00",
      "customerName": "Customer Name",
      "phone": "0812345678",
      "lineId": "",
      "treatmentItem": "Smooth 3x 3900",
      "staffName": "Staff One",
      "id": "sheet-uuid",
      "status": "booked",
      "appointment_id": "appointment-uuid",
      "customer_id": "customer-uuid"
    }
  ]
}
```

`source=appointments` example:

```json
{
  "ok": true,
  "rows": [
    {
      "id": "appointment-uuid",
      "date": "2026-03-17",
      "bookingTime": "14:00",
      "customerName": "Customer Name",
      "phone": "0812345678",
      "lineId": "",
      "treatmentItem": "Smooth",
      "staffName": "Staff One"
    }
  ]
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid date format |
| `401` | Missing auth |
| `410` | Legacy sheet endpoints disabled for this user/config |
| `500` | Server error or `SSOT_STAFF_MISSING` in appointments mode |

**Integration Notes**
- Do not use this as a substitute for `/api/appointments/queue` in new work.

### `POST /api/visits`
**Purpose**
- Legacy sheet-backed create flow. Writes to `sheet_visits_raw`, not to `appointments`.

**Auth**
- Authenticated, then `legacySheetGuard`.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `visit_date` | `YYYY-MM-DD` | Yes | Required |
| `visit_time_text` | `HH:MM` | Yes | Required |
| `customer_full_name` | string | Yes | Required |
| `phone_raw` | string | Yes | Required |
| `email_or_lineid` | string | No | Optional |
| `treatment_item_text` | string | Yes | Required |
| `staff_name` | string | Yes | Required |

**Validation / Business Rules**
- Same legacy guard behavior as `GET /api/visits`.
- Inserts into `sheet_visits_raw`.
- Does not create a local appointment row.

**Response**
- `200`

```json
{
  "ok": true,
  "id": "sheet-uuid"
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Missing/invalid fields |
| `401` | Missing auth |
| `410` | Legacy sheet endpoints disabled |
| `500` | Unhandled server error |

**Integration Notes**
- Legacy only. New appointment creation should use `POST /api/appointments`.

### `POST /api/sheet-visits/:sheetUuid/delete`
**Purpose**
- Soft-delete a legacy sheet row with staff PIN verification.

**Auth**
- Authenticated, then `legacySheetGuard`.

**Request**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `pin` | string | Yes | Required |
| `reason` | string | No | Optional delete note |

Path param:
- `sheetUuid` must be UUID

**Validation / Business Rules**
- Requires `PIN_FINGERPRINT_SECRET` or falls back to `JWT_SECRET`. If neither exists, returns `500`.
- If the acting staff record has no PIN yet, the provided PIN becomes the stored PIN for that staff.
- If the staff already has a PIN, the provided PIN must match.
- PIN fingerprint must be unique across staff.
- Updates `sheet_visits_raw.deleted_at`, `deleted_by_staff_id`, `delete_note`.
- Writes `sheet_visits_deletions` audit row with IP and user agent.

**Response**
- `200`

```json
{
  "ok": true
}
```

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid sheet UUID or missing PIN |
| `401` | Invalid PIN |
| `404` | Row not found |
| `409` | Row already deleted or PIN already used by another staff |
| `410` | Legacy sheet endpoints disabled |
| `500` | Missing PIN secret or unhandled server error |

**Integration Notes**
- This route is only relevant if your workflow still manipulates legacy sheet rows.

### `GET /api/debug/appointment/:id/status`
**Purpose**
- Non-production admin debug endpoint for inspecting appointment/package deduction state.

**Auth**
- Available only when `NODE_ENV !== production`, and then requires authenticated admin/owner.

**Request**
- Path param `id` must be UUID.

**Validation / Business Rules**
- Reads appointment, linked package usage rows, and package balances.
- Intended for debugging, not stable integration.

**Response**
- `200`
- Returns diagnostic fields such as:
  - `appointmentStatus`
  - `sessionDeducted`
  - `maskDeducted`
  - `remainingSessions`
  - `remainingMask`
  - `expectedIfNotDeducted`
  - `expectedIfAlreadyDeducted`
  - `linkedPackages`
  - `usageRows`

**Errors**

| Status | Trigger |
| --- | --- |
| `400` | Invalid appointment id |
| `404` | Appointment not found |
| `500` | Unhandled server error |

**Integration Notes**
- Do not build production integrations against this route.

## 8. Appointment Lifecycle and Status Rules

### Status Summary
- Staff-oriented service routes only mutate from:
  - `booked`
  - `rescheduled`
  - `ensured`
  - `confirmed`
- Admin patch route accepts a wider target set:
  - `booked`
  - `completed`
  - `cancelled`
  - `no_show`
  - `rescheduled`
  - `ensured`
  - `confirmed`
  - `check_in`
  - `checked_in`
  - `pending`

### Transition Table

| Flow | Allowed Actor | Allowed From | Target Status | Side Effects |
| --- | --- | --- | --- | --- |
| `POST /api/appointments` | Authenticated staff/admin/owner | n/a | `booked` | Creates appointment and event |
| `POST /api/appointments/admin/backdate` | Admin/owner | n/a | `completed` or `booked` | Creates past appointment and event |
| `POST /api/appointments/:id/complete` | Authenticated staff/admin/owner | `booked`, `rescheduled`, `ensured`, `confirmed` | `completed` | One-off: status only. Package flow: inserts `package_usages`, updates package continuity, writes event |
| `POST /api/appointments/:id/cancel` | Authenticated staff/admin/owner | `booked`, `rescheduled`, `ensured`, `confirmed` | `cancelled` | Status-only event, no deduction |
| `POST /api/appointments/:id/no-show` | Authenticated staff/admin/owner | `booked`, `rescheduled`, `ensured`, `confirmed` | `no_show` | Status-only event, no deduction |
| `POST /api/appointments/:id/revert` | Admin/owner | `completed`, `no_show`, `cancelled`, `canceled`, or `booked` with lingering usage | `booked` | Deletes appointment usage rows, recalculates/restores packages, writes event |
| `PATCH /api/admin/appointments/:id` | Admin/owner | current state-dependent | one of admin target statuses | Can patch status, row fields, identities, and optionally create usage |

### Package / Course Deduction Rules
- Deduction happens in the canonical staff completion flow:
  - `POST /api/appointments/:id/complete`
- `completed` via admin patch does not automatically create `package_usages`.
- Admin patch can optionally create a usage row by sending:
  - `create_package_usage: true`
  - `customer_package_id`
  - optional `used_mask`
- `cancelled` and `no_show` are status-only flows and do not deduct a course.
- Revert deletes usage rows tied to the appointment and may move package status from `completed` back to `active`.
- Package continuity status is driven by `customer_packages.status`:
  - `active -> completed` when remaining sessions reach 0
  - `completed -> active` if a revert restores remaining sessions
- Receipt-backed or promo/special-event appointments follow the exact same lifecycle and status rules as ordinary appointments. Receipt linkage does not create a separate status model and does not change package deduction behavior by itself.

### Special Admin Status Patch Rules
- Patching to `booked` deletes all `package_usages` for that appointment.
- After patching to a non-`booked` status:
  - if no `package_usages` remain, the response includes warnings
  - for `completed`, warning text explicitly tells operators to use the proper complete flow
- `cancelled -> completed` requires `confirm_cancelled_to_completed=true`.

### Event Logging
Observed write flows append audit/event rows:
- booking create -> `appointment_events(event_type='created')`
- completion -> `appointment_events(event_type='redeemed')`
- cancel -> `event_type='cancelled'`
- no-show -> `event_type='no_show'`
- admin update -> `event_type='ADMIN_APPOINTMENT_UPDATE'`
- admin backdate -> `event_type='ADMIN_BACKDATE_CREATE'`

Read-side implication:
- queue/admin detail/history may rely on event metadata for `staff_name` and plan fields

## 9. Customer Identity and Resolution Rules
This backend does not treat customer name as the primary identity key. The real operational identity anchor is phone.

Observed code behavior:
- Customer lookup on booking create/backdate resolves by active `customer_identities` row where:
  - `provider = 'PHONE'`
  - `provider_user_id = normalized digits`
  - `is_active = true`
- If phone already maps to an active customer:
  - appointment links to that customer
  - if a new `customer_full_name` is supplied, `customers.full_name` is updated
- If no active phone identity exists:
  - backend creates a new customer
  - then inserts active `PHONE` identity

Operational consequences:
- Two appointments with the same resolved `customer_id` share the same customer profile.
- Updating `customer_full_name` through admin patch updates `customers.full_name`, not an appointment-local name field.
- Therefore, changing the name for one appointment can affect multiple appointments if they share the same customer.

Admin phone edit behavior:
- If a new phone already belongs to another customer:
  - endpoint returns `409`
  - `code = PHONE_BELONGS_ANOTHER_CUSTOMER`
  - conflict payload includes the owning `customer_id`, `customer_full_name`, and normalized phone
- If client retries with `reassign_customer_by_phone=true`:
  - `appointments.customer_id` moves to the phone owner
  - the target active PHONE identity is activated if needed
  - other active PHONE identities for that target customer are deactivated

`email_or_lineid` behavior in admin edit:
- If value contains `@`, it is treated as EMAIL
- Otherwise it is treated as LINE
- Setting one clears the other provider’s active identity for that customer
- Read side prefers LINE over EMAIL when exposing `email_or_lineid` / `lineId`

Integration guidance:
- Never assume customer name is unique.
- Treat phone changes as identity-sensitive operations.
- Prefer customer detail reads over local client-side identity guesses.

## 10. Booking / Queue / Calendar Contract

### Recommended Modern Flow
1. `POST /api/auth/login`
2. `GET /api/appointments/booking-options`
3. Optional: `GET /api/appointments/calendar-days?from=...&to=...`
4. `POST /api/appointments`
5. `GET /api/appointments/queue`
6. Optional: `GET /api/customers/:customerId/profile` or `GET /api/admin/appointments/:appointmentId`
7. Later operational actions:
   - `POST /api/appointments/:id/complete`
   - `POST /api/appointments/:id/cancel`
   - `POST /api/appointments/:id/no-show`
   - `POST /api/appointments/:id/revert` for admin rollback

### Draft-First Promo Flow
1. `POST /api/auth/login`
2. Optional: `GET /api/appointments/booking-options`
3. `POST /api/appointment-drafts`
4. `GET /api/appointment-drafts` after refresh or when rebuilding a draft dashboard
5. `GET /api/appointment-drafts/:id` when the flow already knows the draft id
6. `PATCH /api/appointment-drafts/:id` until missing fields such as `scheduled_at` and `staff_name` are known
7. `POST /api/appointment-drafts/:id/submit`
8. `GET /api/appointments/queue`

Observed intent from code:
- `appointment_drafts` is a buffer table only.
- Draft rows persist in PostgreSQL until later patch/cancel/submit; refresh does not clear them.
- Submit is the point where a real appointment row is created.
- After submit, the draft points to the real appointment through `submitted_appointment_id`.

### How These Endpoints Fit Together
- `booking-options` gives the safest source of `treatment_id` and `package_id`.
- `calendar-days` gives day-level density only.
- `POST /api/appointments` creates the actual booking.
- `queue` is the canonical list/detail feed for runtime appointment operations.
- `customers/:id/profile` is a supporting read endpoint for customer/package history.
- `admin/appointments/:id` is the richer admin detail/edit feed.

### Queue vs Visits
- `GET /api/appointments/queue` is SSOT/canonical and shows all statuses.
- `GET /api/visits` is legacy:
  - default source is sheet rows
  - `source=appointments` is still guarded by legacy mode/admin access
  - it is not the modern queue contract

### Timezone Expectations
- Read-side date grouping/filtering uses Bangkok time.
- If client supplies split date/time fields, backend assumes `+07:00`.
- If client supplies `scheduled_at`, timezone offset is mandatory.

### Booking Creation Guidance
- Prefer explicit `scheduled_at` with timezone.
- Prefer explicit `treatment_id`.
- Prefer explicit `package_id` when booking a package-style treatment.
- For receipt-backed booking, send explicit `branch_id` plus `receipt_evidence` in the same `POST /api/appointments` request.
- For draft create/patch flows, `branch_id` is stored as opaque text when provided.
- For queue/calendar filtering, only send UUID-shaped `branch_id` values; omitting the query param means no branch filter.
- If date/time/staff is not known yet, use `/api/appointment-drafts/*` first instead of forcing an incomplete real appointment row.
- Treat the returned `appointment_id` as the SSOT booking identifier; receipt evidence is only linked metadata on top of that appointment.
- Handle `409 Time slot is already booked`.
- After creation, refresh queue rather than relying only on the create response.

## 11. Legacy / GAS / Sheet-backed Behavior

### GAS-backed Endpoints
Observed GAS-backed endpoints:
- `GET /api/appointments`
- `POST /api/appointments/delete-hard`

Behavior:
- require `GAS_APPOINTMENTS_URL` and `GAS_SECRET`
- call GAS actions like `appointments_get` and `appointments_delete_hard`
- forward upstream JSON without stabilizing the response contract

Risks:
- not backed by the appointments SSOT used by the modern queue/create/service flows
- response shape depends on external GAS implementation
- not suitable for new integrations that need predictable behavior

### Sheet-backed / Legacy Compatibility Endpoints
Observed legacy endpoints:
- `GET /api/visits`
- `POST /api/visits`
- `POST /api/sheet-visits/:sheetUuid/delete`

Guard behavior:
- admins/owners always pass `legacySheetGuard`
- non-admins pass only when `LEGACY_SHEET_MODE=true`
- otherwise backend returns `410 { ok: false, error: "Legacy sheet endpoints are disabled" }`

Why they are legacy:
- they read/write `sheet_visits_raw`
- they are not the canonical appointments-first queue/create contract
- they exist for compatibility, migration, or operational cleanup

### Sheet-to-Appointments Bridge
`POST /api/appointments/from-sheet/:sheetUuid/ensure` is a bridge:
- admin-only
- useful for migrating or reconciling legacy sheet rows into local appointments
- not the preferred normal-booking entrypoint

## 12. Frontend Integration Checklist
- Use `/api` as the base path.
- Send `credentials: 'include'` for browser auth/session requests.
- Do not build around `Authorization: Bearer` for current auth.
- Use `GET /api/appointments/booking-options` before creating bookings.
- Prefer explicit `treatment_id` and `package_id`; avoid relying on text inference.
- Respect Bangkok-local date handling for queue and calendar.
- Send `scheduled_at` with a timezone offset.
- Use `/api/appointment-drafts/*` when promo verification is complete but booking date/time/staff is still unknown.
- Treat drafts as buffer rows only; they are not queue rows and are not real appointments until submit succeeds.
- Use `GET /api/appointment-drafts` to reload persisted draft rows after refresh; draft storage is PostgreSQL-backed, not session-only.
- If a draft should be retired without submit, use `PATCH /api/appointment-drafts/:id` with `status: "cancelled"`; there is no dedicated delete endpoint yet.
- Handle `409` slot collisions on `POST /api/appointments`.
- Send `branch_id` explicitly when using receipt-backed create with `receipt_evidence`.
- Treat write-path `branch_id` values as opaque text, but treat queue/calendar `branch_id` filters as UUID-only.
- Use `GET /api/appointments/queue` as the canonical queue, not `/api/visits`.
- Treat receipt-backed promo/special-event bookings as normal appointments, not as temporary reservation records.
- Read stored receipt evidence from the `POST /api/appointments` response or `GET /api/admin/appointments/:appointmentId`, not from queue rows.
- Use `POST /api/appointments/:id/complete` for real course deduction.
- Do not expect `cancel` or `no-show` to deduct courses.
- Do not assume `customer_full_name` uniquely identifies a customer.
- Be careful when editing phone/name in admin flows; these can affect shared customer profiles.
- Send real JSON booleans, not string booleans.
- Treat GAS and sheet endpoints as legacy.

## OCR Receipt Route

### Purpose
- `POST /api/ocr/receipt` is the active public OCR upload route used by Bill Verification.
- This route is additive. It does not replace canonical appointment create or receipt evidence persistence.
- Current ownership split:
  - this repo owns the public Node route and contract
  - this repo now also contains the Python OCR app source at `backend/services/ocr_python`
  - the old Python OCR folder in `scGlamLiFFF/scGlamLiFF/backend/services/ocr_python` is still retained temporarily during deployment migration

### Request
- Method: `POST`
- Path: `/api/ocr/receipt`
- Auth: public by current route code
- Content type: `multipart/form-data`
- File field: `receipt`

### Debug health endpoint
- Method: `GET`
- Path: `/api/ocr/health`
- Auth: public by current route code
- Response style: `{ ok: true, data: ... }`
- Returned debug fields include:
  - `routeMounted`
  - `mountedBasePath`
  - `receiptPath`
  - `healthPath`
  - `ocrServiceBaseUrl`
  - `ocrServiceEnabled`
  - `ocrServiceFallbackToMock`
  - downstream reachability/status/message

### Response shape
- Success fields:
  - `success`
  - `code`
  - `message`
  - `errorCode`
  - `errorMessage`
  - `rawText`
  - `ocrText`
  - `parsed`
  - `parsed.receiptLine`
  - `parsed.receiptLines`
  - `parsed.totalAmount`
  - `parsed.totalAmountValue`
  - `parsed.receiptDate`
  - `parsed.receiptTime`
  - `parsed.merchant`
  - `parsed.merchantName`
  - top-level mirrors for `receiptLine`, `receiptLines`, `totalAmount`, `receiptDate`, `receiptTime`, `merchant`, `merchantName`
- Error fields:
  - same core keys above
  - empty parsed/top-level receipt fields
  - `error.code`
  - `error.message`

### Operational notes
- Local backend port defaults to `5050`.
- Python OCR base URL defaults to `http://127.0.0.1:8001`.
- Startup logs now print the mounted OCR paths and OCR service runtime config.
- Legacy/mock behavior is still present, but only as explicit fallback/testing paths:
  - `rawTextOverride`
  - mock fallback when configured

## 13. Open Questions / Uncertain Areas

### 1. `branch_id` format is inconsistent
- Known:
  - backend now centralizes the current rule set in `src/utils/branchContract.js`
  - write endpoints accept opaque non-empty text
  - canonical create can default to literal `branch-003` or `DEFAULT_BRANCH_ID`
  - queue/calendar query params enforce UUID format
- Not fully confirmed:
  - whether production branch values are in active migration from text codes to UUIDs
  - whether future queue/calendar filters will expand beyond UUID-only inputs
- Source of ambiguity:
  - `appointmentCreateService.js`
  - `appointmentDraftsService.js`
  - `branchContract.js`
  - `appointmentsQueueController.js`
  - `adminAppointmentsController.js`
  - `appointmentServiceController.js`

### 2. Some routes are public in code, but may not be intended to stay public
- Known:
  - `GET /api/customers`
  - `GET /api/customers/:customerId/profile`
  - `GET /api/appointments`
  - `POST /api/appointments/delete-hard`
  - `DELETE /api/appointments/:id`
  - all currently lack auth middleware in route code
- Not fully confirmed:
  - whether this is deliberate public API surface or an internal oversight
- Source of ambiguity:
  - route files show no auth middleware, but repository docs do not describe these as public APIs

### 3. GAS endpoint response shape is not guaranteed by this repository
- Known:
  - backend forwards upstream GAS JSON
- Not fully confirmed:
  - exact schema of GAS success/error payloads over time
- Source of ambiguity:
  - `gasService.js` and `appointmentsController.js`

### 4. Queue rows include extra fields beyond the stable subset documented here
- Known:
  - implementation spreads raw SQL row before normalizing fields
- Not fully confirmed:
  - which of those extra raw fields the maintainers consider stable
- Source of ambiguity:
  - `appointmentsQueueController.js`

### 5. Package-style treatment detection is heuristic
- Known:
  - package inference is driven by parsing text, especially `smooth` patterns with sessions/mask/price hints
- Not fully confirmed:
  - whether future package products will follow the same text conventions
- Source of ambiguity:
  - `resolvePackageIdForBooking.js`
  - treatment inference helpers in create/sheet flows

### 6. There is currently no dedicated receipt update/delete API
- Known:
  - current code can create receipt evidence during `POST /api/appointments`
  - current code can read it back from `GET /api/admin/appointments/:appointmentId`
- Not fully confirmed:
  - whether future operations will need a patch/delete flow for receipt evidence after appointment creation
- Source of ambiguity:
  - no route/controller currently implements a dedicated receipt maintenance endpoint

### 7. There is no list/search endpoint for drafts yet
- Known:
  - current code supports create, get-by-id, patch, and submit
- Not fully confirmed:
  - whether product will need draft listing/search/filtering for staff dashboards
- Source of ambiguity:
  - `appointmentDrafts.js` only exposes single-draft operations

## 14. Source References
Files inspected to generate this contract:
- `backend/README-backend.md`
- `backend/package.json`
- `backend/server.js`
- `backend/src/app.js`
- `backend/src/db.js`
- `backend/src/routes/auth.js`
- `backend/src/routes/appointments.js`
- `backend/src/routes/appointmentDrafts.js`
- `backend/src/routes/adminAppointments.js`
- `backend/src/routes/customers.js`
- `backend/src/routes/visits.js`
- `backend/src/routes/sheetVisits.js`
- `backend/src/routes/debugRoutes.js`
- `backend/src/routes/ocr.js`
- `backend/src/controllers/authController.js`
- `backend/src/controllers/appointmentsController.js`
- `backend/src/controllers/appointmentDraftsController.js`
- `backend/src/controllers/staffCreateAppointmentController.js`
- `backend/src/controllers/appointmentsQueueController.js`
- `backend/src/controllers/appointmentServiceController.js`
- `backend/src/controllers/adminAppointmentsController.js`
- `backend/src/controllers/adminStaffUsersController.js`
- `backend/src/controllers/customersController.js`
- `backend/src/controllers/visitsController.js`
- `backend/src/controllers/sheetVisitsController.js`
- `backend/src/controllers/debugAppointmentController.js`
- `backend/src/controllers/ocrController.js`
- `backend/src/middlewares/requireAuth.js`
- `backend/src/middlewares/requireAdmin.js`
- `backend/src/middlewares/legacySheetGuard.js`
- `backend/src/middlewares/errorHandlers.js`
- `backend/src/middlewares/receiptUpload.js`
- `backend/src/services/gasService.js`
- `backend/src/services/adminAppointmentStatusService.js`
- `backend/src/services/appointmentDraftsService.js`
- `backend/src/services/appointmentCreateService.js`
- `backend/src/services/appointmentReceiptEvidenceService.js`
- `backend/src/services/ocr/receiptOcrService.js`
- `backend/src/services/ocr/pythonOcrClient.js`
- `backend/src/services/ocr/receiptParser.js`
- `backend/src/services/appointmentIdentitySql.js`
- `backend/src/services/packageContinuity.js`
- `backend/src/utils/branchContract.js`
- `backend/src/utils/resolvePackageIdForBooking.js`
- `backend/src/utils/resolveAppointmentFields.js`
- `backend/scripts/migrate_appointment_drafts.js`
- `backend/scripts/migrate_appointment_receipts.js`
- `diary.md`
