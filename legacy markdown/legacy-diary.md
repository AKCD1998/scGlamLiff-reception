# Diary

## 2026-02-24 - Course Continuity via `customer_packages.status`

- Kept appointment statuses unchanged (`booked`, `rescheduled`, `completed`, `cancelled`, `no_show`).
- Implemented course continuity as package state transitions:
  - Complete flow: deduct usage once, recompute remaining, and set package `active -> completed` when remaining reaches 0.
  - Revert flow: restore usage, recompute remaining, and set package `completed -> active` when remaining becomes > 0.
- Added idempotent complete behavior for already `completed` appointments to avoid double deduction.
- Returned updated package snapshot (`status`, `used/total`, `remaining`) in complete response payload.
- Added queue-level best-effort flag/badge data for continuous courses and rendered badge in booking queue UI.
- Added modal UI badge `คอร์สต่อเนื่อง` and helper text for completed appointments:
  - `รายการนี้ตัดแล้ว ต้องนัดใหม่สำหรับครั้งถัดไป`
- Added backend guard tests for continuity rules in `backend/src/services/packageContinuity.test.js`.

## 2026-02-24 - Confirm disabled guard adjustment

- Updated service mutation status guard (frontend + backend) to allow `ensured` / `confirmed` in addition to `booked` / `rescheduled`.
- Kept `completed` blocked for re-confirm to prevent double deduction on the same appointment.
- Added frontend unit test coverage for status mutability in `src/components/ServiceConfirmationModal.test.jsx`.

## 2026-03-04 - Incident analysis: booking save failed (09:44-09:55, +07)

- Observed symptom:
  - Staff reported booking action failed with a message equivalent to `บันทึกการจองไม่สำเร็จ` around `09:44`.
  - Booking flow returned to normal at `09:55` on the same day (about `11` minutes later).
  - Related request-log snippet: `clientIP=125.25.47.101 requestID=f25eaab4-7216-4e87 responseTimeMS=289 responseBytes=451 userAgent=Edge/145`.
- Most likely cause:
  - Temporary upstream/platform issue (reverse proxy/backend instance/database connectivity blip) during `POST /api/appointments`.
  - Reasoning: issue recovered automatically without code change, and response size pattern looks more like transient edge/gateway/app error response than normal success payload.
- Other plausible causes (lower confidence):
  - Short-lived database write failure/lock/connection pressure on the booking transaction path.
  - Temporary auth/cookie issue on the affected client session (`401`) and then recovered after session refresh.
  - Slot collision (`409`) for a specific time, though this usually affects only one slot, not a short outage window.
- Evidence limitation:
  - The provided log line does not include HTTP method, path, or status code, so this remains a best-effort root-cause hypothesis, not a confirmed RCA.
