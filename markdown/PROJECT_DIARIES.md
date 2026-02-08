# Project Diaries

## 2026-02-08 — Admin Edit Appointment (Admin-only)

### What was added
- New admin API namespace:
  - `GET /api/admin/appointments/:appointmentId`
  - `PATCH /api/admin/appointments/:appointmentId`
- New admin frontend page:
  - `src/pages/AdminEditAppointment.jsx`
  - `src/pages/AdminEditAppointment.css`
- New Workbench tab for admin:
  - `แก้ไขนัดหมาย (Admin)`

### Why this was added
- Existing `AdminBackdate` flow inserts a new backdated appointment only.
- We needed a separate and safer flow for editing an existing appointment record.

### Safety rules implemented
- Admin/Owner only (`requireAdmin`).
- Immutable IDs are blocked from editing (`appointments.id`, `customer_id`).
- `treatment_id` can be changed only if it exists in `treatments`.
- `scheduled_at` must be valid ISO datetime with timezone.
- `cancelled -> completed` requires explicit confirm flag.
- `raw_sheet_uuid` change requires Danger Zone double confirmation flags.
- `reason` is required (minimum 5 chars) for every edit.

### Auditability
- Every successful edit writes `appointment_events` with:
  - `event_type = ADMIN_APPOINTMENT_UPDATE`
  - `note = reason`
  - `meta.before` / `meta.after` (changed fields only)
  - admin actor metadata (`id`, `username`, `display_name`)

### Identity integrity
- Phone normalization is enforced before update.
- Email/Line validation is enforced (`email` regex / `line id` pattern).
- `customer_identities` updates are done safely:
  - deactivate old active identity
  - activate/insert new value
  - reject conflicts if identity belongs to another customer

### Optional package deduction
- If status is completed, admin can enable:
  - `Create package usage (deduct session)`
- Requires selecting `customer_package_id`.
- Creates `package_usages` row with consistency checks (remaining sessions/masks).

## 2026-02-08 — Fix: Edit Treatment Format (3x -> 1x)

### Issue
- หน้า Home queue ยังแสดง treatment item ตาม active package เดิม แม้หน้างานต้องการเปลี่ยนรูปแบบคอร์สในนัดหมายนั้น

### What changed
- เพิ่มการแก้ไข `treatment format` ใน `AdminEditAppointment` โดยดึงตัวเลือกจาก `GET /api/appointments/booking-options`
- เพิ่ม payload สำหรับแผนคอร์สใน `PATCH /api/admin/appointments/:appointmentId`:
  - `treatment_item_text`
  - `treatment_plan_mode` (`one_off` | `package`)
  - `package_id` (เมื่อเป็น `package`)
- Queue endpoint อ่านค่า plan ล่าสุดจาก `appointment_events.meta` แล้วคำนวณ `Treatment item` ตาม override ก่อน fallback ไป active package

### Result
- เคสเปลี่ยนจากคอร์ส 3 ครั้งเป็นครั้งเดียว สามารถสะท้อนใน Home/Workbench ได้ถูกต้อง และมี audit trace ใน `appointment_events`

## 2026-02-08 — Incident Fix: Admin Edit PATCH 500 (`appointment_events_actor_check`)

### Symptom
- หน้า `AdminEditAppointment` ยิง `PATCH /api/admin/appointments/:appointmentId` แล้วได้ 500
- ข้อความจาก backend: `new row for relation "appointment_events" violates check constraint "appointment_events_actor_check" (23514)`

### Reproduction
1. เปิดหน้า Workbench > `แก้ไขนัดหมาย (Admin)`
2. โหลด appointment แล้วเปลี่ยน treatment format (เช่น 3x -> one-off)
3. กดบันทึก จะยิง payload ลักษณะนี้:
   - `reason`
   - `treatment_item_text`
   - `treatment_plan_mode`
   - `package_id`
4. Backend fail ตอน insert `appointment_events` ใน `patchAdminAppointment`

### Root Cause
- โค้ดส่งค่า `actor` ใน `appointment_events` เป็น `req.user.id` (UUID) แต่ DB constraint `appointment_events_actor_check` อนุญาตเฉพาะ `customer | staff | system`
- หลังแก้ actor แล้ว พบอีกชั้นว่า `event_type = ADMIN_APPOINTMENT_UPDATE` ยังไม่อยู่ใน `appointment_events_event_type_check` เดิม

### Fix Summary
- ปรับ admin event actor ให้ใช้ค่า canonical `staff` เสมอ
- บังคับมี admin identity (`req.user.id`) ด้วย `requireAdminActorUserId()` และเก็บลง `meta.admin_user_id`
- เพิ่ม error response แบบชัดเจนสำหรับ constraint 23514 (`actor_check` / `event_type_check`) แทน generic 500
- เพิ่ม migration script:
  - `backend/scripts/migrate_appointment_events_constraints.js`
  - ขยาย allowed `event_type` ให้รองรับ `ADMIN_APPOINTMENT_UPDATE`, `ADMIN_BACKDATE_CREATE`
  - คง actor constraint ให้ชัดเจน (`customer|staff|system`) ไม่ loosen แบบไร้ขอบเขต
- เพิ่ม integration-style verification script:
  - `backend/scripts/verify_admin_edit_patch.js`
  - สร้าง appointment ชั่วคราว -> เรียก PATCH -> assert ว่า insert event สำเร็จ (`event_type=ADMIN_APPOINTMENT_UPDATE`, `actor=staff`) -> cleanup

### Verification
- ก่อน migrate: endpoint ตอบ `422` พร้อมข้อความชี้ว่า `appointment_events_event_type_check` ไม่รองรับ
- หลังรัน `npm run migrate:appointment-events`:
  - `PATCH /api/admin/appointments/:id` ตอบ `200`
  - มีแถวใหม่ใน `appointment_events` พร้อม:
    - `event_type = ADMIN_APPOINTMENT_UPDATE`
    - `actor = staff`
    - `meta.admin_user_id = <admin uuid>`
- รันผ่านด้วยคำสั่ง `npm run verify:admin-edit` ในโฟลเดอร์ `backend`

## 2026-02-08 — AdminBackdate: Replace free-text treatment item with selectable options

### Problem
- ฟิลด์ `treatment_item_text (for audit)` ในหน้า `AdminBackdate` เดิมเป็น text input ทำให้พิมพ์ผิดง่าย
- ฟิลด์ `treatment_id` ต้องกรอกเอง เสี่ยงใส่ไม่ตรงกับบริการที่เลือก

### What changed
- เปลี่ยน `treatment_item_text` เป็น `react-select` แบบค้นหาได้ (pattern เดียวกับหน้า Booking)
- ดึงตัวเลือกจาก API `GET /api/appointments/booking-options`
- เมื่อเลือก option:
  - ระบบเติม `treatment_item_text` อัตโนมัติจาก option
  - ระบบเติม `treatment_id` อัตโนมัติจาก option
- ปรับ `treatment_id` ให้เป็น read-only (`treatment_id (auto)`) เพื่อกันกรอกผิด
- เพิ่ม validation ว่าต้องเลือกบริการก่อน submit

### Files
- `src/pages/AdminBackdate.jsx`
- `src/pages/AdminBackdate.css`

### Result
- Admin สร้างจองย้อนหลังโดยเลือกบริการจากรายการมาตรฐานเดียวกับหน้า Booking
- ลด typo/mismatch ระหว่าง `treatment_item_text` และ `treatment_id`
