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
