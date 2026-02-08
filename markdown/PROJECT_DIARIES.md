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

## 2026-02-08 — Fix: Staff booking FK `__STAFF__` (`appointments_line_user_id_fkey`)

### Symptom
- กดบันทึกจากหน้า `Bookingpage` แล้ว API `POST /api/appointments` ตอบ 500
- Postgres แจ้ง `23503`:
  - `Key (line_user_id)=(__STAFF__) is not present in table "line_users"`
  - constraint: `appointments_line_user_id_fkey`

### Root Cause
- ใน `createStaffAppointment` ระบบ insert ลง `appointments.line_user_id = '__STAFF__'`
- แต่ตาราง `line_users` ยังไม่มีแถว system id นี้
- เนื่องจาก `appointments.line_user_id` เป็น `NOT NULL` + FK ไป `line_users(line_user_id)` จึง insert ไม่ได้

### Fix
- เพิ่ม helper `ensureStaffLineUserRow()` ใน `backend/src/controllers/staffCreateAppointmentController.js`
- ก่อน insert appointment ให้ upsert แถว `line_users`:
  - `line_user_id = '__STAFF__'`
  - `display_name = 'staff-booking'`
- เปลี่ยน insert ให้ใช้ค่าที่ ensure แล้ว
- เพิ่ม error mapping สำหรับ FK นี้ให้ตอบ `422` message ชัดเจนแทน generic 500

### Verification
- Reproduce เดิม: ได้ 500 + FK violation
- หลังแก้: `POST /api/appointments` ตอบ `200` และสร้าง booking สำเร็จ
- ตรวจ DB พบ `line_users.__STAFF__` ถูกสร้างจริง
- Regression:
  - `npm run verify:admin-edit` ผ่าน
  - `POST /api/appointments/admin/backdate` ยังตอบ `200`

## 2026-02-08 — Fix: Home/Workbench lineId showing placeholders (`__STAFF__`, `phone:*`)

### Symptom
- คอลัมน์ `อีเมล / line ID` ในหน้า Home/Workbench แสดงค่าเทคนิคแทนค่าที่คนกรอก เช่น:
  - `__STAFF__`
  - `__BACKDATE__`
  - `phone:08xxxxxxx`

### Root cause
- หน้า Home ใช้ `GET /api/appointments/queue` (ไม่ใช่ `/api/visits` flow หลัก)
- SQL เดิมใน `appointmentsQueueController` map `lineId` จาก fallback `appointments.line_user_id`
- `line_user_id` เป็น internal FK/system placeholder สำหรับ integrity ไม่ใช่ค่าที่ต้องแสดงให้ผู้ใช้เห็น
- ค่าที่ staff/admin กรอกจริงถูกเก็บใน `appointment_events.meta.email_or_lineid` (และบางเคสอยู่ใน `customer_identities`)

### Fix summary
- ปรับ queue query ให้เลือก `lineId` จากแหล่งที่เป็น human-entered ก่อน:
  1. ค่า `email_or_lineid` ล่าสุดใน `appointment_events.meta` (`after.email_or_lineid` หรือ `meta.email_or_lineid`)
  2. fallback ไป `customer_identities` (`LINE`/`EMAIL`)
  3. fallback สุดท้ายไป `line_user_id` เฉพาะค่าที่ไม่ใช่ placeholder/system prefix
- เพิ่ม sanitize ฝั่ง backend และ frontend เพื่อกันค่าระบบเล็ดลอด:
  - ซ่อน `__STAFF__`, `__BACKDATE__`, `phone:*`, `sheet:*`
- ปรับตารางหน้า Home ให้แสดง `-` เมื่อไม่มีค่า
- อัปเดต `/api/visits` appointments source ให้ behavior เดียวกัน (กัน confusion ใน legacy flow)

### Verification
- `node --check backend/src/controllers/appointmentsQueueController.js`
- `node --check backend/src/controllers/visitsController.js`
- `node --check src/pages/workbench/workbenchRow.js`
- `npm run test:run -- src/pages/WorkbenchPage.test.jsx` ผ่าน

## 2026-02-08 — Fix: Staff Name disappeared after lineId refactor

### Symptom
- หลังแก้ lineId mapping หน้า Home/Workbench คอลัมน์ `Staff Name` แสดง `-` ทุกแถว

### Root cause
- API หลักของหน้า Home คือ `GET /api/appointments/queue`
- ใน SQL ของ `appointmentsQueueController` ค่า `staffName` ถูก hardcode เป็น `'-'`
- endpoint `/api/visits?source=appointments` ก็ใช้ `'-'` เช่นกัน จึงไม่มีข้อมูล staff จริงส่งถึง frontend

### Fix summary
- กู้ staffName source ที่ backend โดยใช้ลำดับ fallback:
  1. `sheet_visits_raw.staff_name` (ผ่าน `raw_sheet_uuid`)
  2. `appointment_events.meta.staff_name` ล่าสุดที่ไม่ว่าง
  3. `appointment_events.meta.staff_display_name` ล่าสุดที่ไม่ว่าง
  4. `'-'`
- คง lineId sanitization fix เดิมไว้ทั้งหมด
- เพิ่ม normalization guard ฝั่ง frontend mapper ให้รองรับทั้ง `staffName` และ `staff_name`

### Verification
- `node --check backend/src/controllers/appointmentsQueueController.js`
- `node --check backend/src/controllers/visitsController.js`
- `node --check src/pages/workbench/workbenchRow.js`
- `npm run test:run -- src/pages/WorkbenchPage.test.jsx`

## 2026-02-08 — Workbench default date filter changed to All Dates

### Goal
- เปลี่ยนค่าเริ่มต้นของหน้า Home/Workbench จาก “กรองเฉพาะวันนี้” เป็น “แสดงทั้งหมด”

### What changed
- เปลี่ยน initial state ของตัวกรองวันที่ใน `useHomePickerState` ให้เป็น `null` แทน `new Date()`
- logic เดิมของ filter รองรับ `selectedDate=null` อยู่แล้ว จึงแสดงทุกแถวอัตโนมัติ
- ปฏิทินยังเลือกวันที่เพื่อกรองได้เหมือนเดิม และปุ่ม `แสดงทั้งหมด` ยังใช้ล้างตัวกรองกลับสู่ all rows

### UX after change
- เปิดหน้า Workbench/Home ครั้งแรก: ตารางแสดงทุกแถว
- เมื่อผู้ใช้เลือกวันในปฏิทิน: ตารางกรองตามวันนั้น
- กด `แสดงทั้งหมด`: กลับไปแสดงทุกแถว

### Verification
- เพิ่ม test: `defaults to all dates (no date filter) on first load` ใน `src/pages/WorkbenchPage.test.jsx`
- รันผ่าน: `npm run test:run -- src/pages/WorkbenchPage.test.jsx`

## 2026-02-08 — Booking page queue defaults to all rows + date filter reset

### Goal
- หน้า `Booking` แท็บคิวต้องแสดงทุกแถวเป็นค่าเริ่มต้น และกรองวันที่เฉพาะตอนผู้ใช้เลือกเอง

### What changed
- แยก state เดิม `filterDate` ออกเป็น 2 ส่วน:
  - `queueDateFilter` (ค่าเริ่มต้น `""`) สำหรับกรองตารางคิว
  - `bookingDate` (ค่าเริ่มต้นวันนี้) สำหรับฟอร์มจอง
- ปรับ `loadAppointments` ให้โหลดคิวทั้งหมด (`getAppointmentsQueue({ limit: 200 })`) แล้วให้ UI กรอง client-side ตาม `queueDateFilter`
- เพิ่ม UI กรองวันที่เหนือ table คิว:
  - date input `กรองตามวันที่`
  - ปุ่ม `แสดงทั้งหมด` เพื่อเคลียร์ filter กลับเป็นทุกแถว
- คง logic จองเดิมให้ใช้ `bookingDate` สำหรับ:
  - ตรวจย้อนหลัง (`isPastBooking`)
  - คำนวณช่วงเวลาว่าง/ชนคิว (`occupiedRanges`, `recommendedSlots`)

### UX now
- เปิดหน้า Booking ครั้งแรก: คิวแสดงทั้งหมด
- เลือกวันที่ในตัวกรองคิว: table แสดงเฉพาะวันนั้น
- กด `แสดงทั้งหมด`: กลับมาแสดงทั้งหมด
- ฟอร์มจองยังต้องมีวันที่ และ default เป็นวันนี้

### Verification
- `npm run test:run -- src/pages/WorkbenchPage.test.jsx`
- `npm run build`

## 2026-02-08 — Fix: 1-session course not selectable in ServiceConfirmationModal

### Symptom
- ใน `ServiceConfirmationModal` เคสคอร์ส 1 ครั้งขึ้น `ไม่พบคอร์สที่ใช้งานได้`
- Staff เลือกคอร์สเพื่อตัด `1/1` ไม่ได้ แม้มีแพ็กเกจแบบ 1 session ในระบบ

### Root cause
- ฝั่ง backend ที่ auto-create `customer_packages` เดาจาก `treatment_item_text` โดย logic เดิมข้ามเคส `sessions_total <= 1`
- ผลคือ appointment ที่เป็น one-off smooth ไม่ผูก `customer_package` ให้ลูกค้า ทำให้ `GET /api/customers/:id/profile` คืน `packages=[]` สำหรับเคสนั้น
- ฝั่ง modal จึงไม่มี package card ให้เลือก

### Fix summary
- ปรับ backend package inference ให้รองรับ one-off (`sessions_total=1`) ด้วย
  - `backend/src/controllers/appointmentServiceController.js`
  - `backend/src/controllers/staffCreateAppointmentController.js`
- เพิ่ม fallback lookup package แบบ `smooth + sessions_total=1` แม้ข้อความไม่มี code ตรง
- เพิ่มรองรับ `package_id` จาก Booking payload แล้ว ensure active `customer_package` อัตโนมัติ
  - `src/pages/Bookingpage.jsx` ส่ง `package_id` เมื่อ option ที่เลือกเป็น package
- ปรับ modal helper ให้ normalize และเลือกเฉพาะ package ที่ `sessionsRemaining > 0`
  - `src/components/ServiceConfirmationModal.jsx`

### Verification
- `node --check backend/src/controllers/appointmentServiceController.js`
- `node --check backend/src/controllers/staffCreateAppointmentController.js`
- `npm run test:run -- src/components/ServiceConfirmationModal.test.jsx src/pages/WorkbenchPage.test.jsx`
- `npm run build`

## 2026-02-08 — Fix: Service modal sync actually provisions missing one-off package

### Symptom
- เปิด `ServiceConfirmationModal` แล้วเจอ `ไม่พบคอร์สที่ใช้งานได้` สำหรับเคส `1/1 Smooth (399) | Mask 0/0`
- กด `ซิงค์คอร์ส` แล้วรายการคอร์สยังไม่โผล่ เพราะเดิมแค่รีโหลด profile

### Root cause
- ปุ่ม `ซิงค์คอร์ส` ใน frontend เรียกแค่ `GET /api/customers/:id/profile`
- ไม่มี endpoint ที่สร้าง/ensure `customer_packages` จากข้อมูล appointment ที่กำลังจะ complete
- ดังนั้นเคสที่ package ยังไม่ถูกสร้างในอดีต จะคงเป็น `packages=[]` ตลอด

### Fix summary
- เพิ่ม endpoint ใหม่ `POST /api/appointments/:id/sync-course`
  - ไฟล์: `backend/src/controllers/appointmentServiceController.js`
  - Route: `backend/src/routes/appointments.js`
  - ทำงานโดย:
    1. หา package จาก `appointment_events.meta` (`package_id` หรือ `treatment_item_text`)
    2. fallback smooth one-off จาก `packages` (`sessions_total=1`)
    3. ensure active `customer_packages` ให้ลูกค้า
- ปรับ `ServiceConfirmationModal` ให้:
  - ตอนเปิด modal ถ้าไม่พบ package และไม่ใช่ one-off แบบ no-course ให้ลอง sync 1 ครั้งอัตโนมัติแล้วโหลด profile ใหม่
  - ปุ่ม `ซิงค์คอร์ส` เรียก endpoint sync จริงก่อน reload profile
- เพิ่ม client helper:
  - `src/utils/appointmentsApi.js` → `syncAppointmentCourse(appointmentId)`

### Verification
- `node --check backend/src/controllers/appointmentServiceController.js`
- `node --check backend/src/routes/appointments.js`
- `node --check src/utils/appointmentsApi.js`
- `npm run test:run -- src/components/ServiceConfirmationModal.test.jsx`

## 2026-02-08 — Fix: 1-session package hidden when customer also has 3-session package

### Symptom
- ลูกค้าที่มีคอร์ส `1-session` และ `3-session` พร้อมกัน เห็นใน `ServiceConfirmationModal` แค่คอร์ส 3-session
- เคส `3 + 10` แสดงครบทั้งสองคอร์ส ทำให้ดูเหมือนมี dedupe เฉพาะบางกรณี

### Root cause
- หน้า modal เรียก `sync-course` เฉพาะตอน `packages` ว่าง (`list.length === 0`) เท่านั้น
- ถ้าลูกค้ามี package อยู่แล้ว 1 ใบ (เช่น 3-session) แต่ package 1-session ยังไม่ถูก provision ระบบจะไม่ sync เพิ่ม
- ผลลัพธ์: โปรไฟล์ยังคืนเฉพาะ 3-session จึง render แค่ใบเดียว

### Fix summary
- ปรับ flow ตอนเปิด modal:
  - สำหรับเคสที่ต้องใช้คอร์ส (`allowNoCourseCompletion === false`) ให้เรียก `syncAppointmentCourse` ทุกครั้งก่อนโหลด profile
  - จากนั้นโหลด `getCustomerProfile` และ render รายการล่าสุด
- คง behavior เดิมของปุ่ม `ซิงค์คอร์ส` ให้เรียก sync จริงก่อน reload
- เพิ่ม sorting deterministic ใน `buildActivePackages`:
  - `sessionsRemaining` มาก -> น้อย
  - ถ้าเท่ากัน ดู `sessionsTotal` มาก -> น้อย
  - ถ้าเท่ากัน ดู `purchased_at` ใหม่ -> เก่า

### Verification
- เพิ่ม test ใหม่ใน `src/components/ServiceConfirmationModal.test.jsx`:
  - input เป็นแพ็กเกจ `1-session remaining=1` + `3-session remaining=2`
  - assert ว่าต้องเห็นทั้ง 2 package
- `npm run test:run -- src/components/ServiceConfirmationModal.test.jsx`
- `npm run build`
