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
