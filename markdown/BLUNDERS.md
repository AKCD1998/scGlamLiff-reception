# Blunders / Lessons Learned

## Integration Test Failures

### 2026-02-13 09:54 +07:00 — Port ambiguity during test-protocol setup
- What was unclear: `backend/README-backend.md` mentions default port `3001`, while runtime backend uses `5050`
- Reproduction:
  1. `rg -n "3001" backend/README-backend.md`
  2. `rg -n "PORT|5050" backend/server.js backend/.env`
- Impact: using wrong API base can make FE integration tests fail immediately
- Working assumption for current test workflow: `http://localhost:5050`

### 2026-02-13 10:04 +07:00 — Local backend boot conflict (`EADDRINUSE:5050`)
- Bug title: backend dev boot fails because default port already occupied
- Cause hypothesis: another local backend/node process is already bound to `localhost:5050`
- Fix suggestion:
  1. check listener: `Get-NetTCPConnection -LocalPort 5050 -State Listen`
  2. stop conflicting process (if safe) or run temporary instance with `PORT=5051/5052`
  3. keep FE `VITE_API_BASE` aligned with the backend port currently in use

Template for future appends:
- Timestamp
- Scenario/step
- Expected vs actual
- Reproduction steps
- Request/response evidence
- Follow-up action

## Deploy MVP: แยก branch ตั้งแต่แรก

**ปัญหาที่เจอ:** เราคิดว่า “แค่ commit ไว้” ก็พอ แต่ถ้าไม่ได้ sync/push ให้ชัดเจน (และ/หรือ Codex เข้าโหมด agentic ตอนเราเผลออยู่ผิด branch) มันมีโอกาส `git push` ขึ้น repo ไปโดน `main` โดยไม่ทันสังเกต ทำให้ของที่กำลังพัฒนา/ย้ายระบบ (เช่น migrate DB) กระทบกับสิ่งที่อยาก deploy เป็น MVP

**วิธีที่ถูก:** ถ้าตั้งใจ deploy อะไรเป็น MVP ให้ **branch แยกจาก `main` ตั้งแต่วันแรก** แล้วให้ระบบ deploy (Render / GitHub Actions) ติดตาม branch นั้นเท่านั้น

ตัวอย่าง workflow:

```powershell
git switch -c deploy-mvp <SHA>
git push -u origin deploy-mvp
```

จากนั้น:
- ตั้งค่า Render ให้ deploy จาก `deploy-mvp` (ไม่ใช่ `main`)
- เราพัฒนาต่อบน `main` ได้เต็มที่ โดย MVP branch จะไม่โดนกระทบ

**เช็กลิสต์กันพลาดก่อนให้ agent ช่วยทำงาน**
- ดู branch ปัจจุบัน: `git branch --show-current`
- ดูสถานะก่อนทำอะไร: `git status -sb`
- ถ้าจะให้ agent ทำงาน “เกี่ยวกับ deploy” ให้ล็อกเป้าหมายว่า branch/commit ไหนเป็น MVP ก่อนเสมอ

## Workbench/Homepage: เบอร์โทรใน UI ไม่ตรงกับที่เห็นใน `sheet_visits_raw`

**Issue:** ใน Postgres (join `appointments.raw_sheet_uuid = sheet_visits_raw.sheet_uuid`) เห็น `phone_raw` เป็น `0867757572` แต่ในหน้า Workbench/Homepage table ยังแสดง `867757572`

**Root Cause:** หน้า Workbench/Homepage ไม่ได้อ่านจาก `GET /api/visits` หรือ `sheet_visits_raw` โดยตรง แต่ใช้ `GET /api/appointments/queue` ซึ่ง query เบอร์จาก `customer_identities` (`provider='PHONE'`) และเลือก record ล่าสุดด้วย `ORDER BY created_at DESC LIMIT 1` ทำให้ไปหยิบค่า `867757572` (record ใหม่กว่า) แทน `0867757572` (record เก่ากว่า) แม้ `sheet_visits_raw.phone_raw` จะถูกต้องแล้วก็ตาม

## คำถามที่เจ้าของโปรเจคถามบ่อย

### Q: ตารางหน้า `Homepage` ดึงข้อมูลจาก `backend/src/controllers/visitsController.js` ใช่ไหม?

**A: ไม่ใช่ (ใน flow ปัจจุบัน)**
- หน้า Home ใช้เส้นทาง `WorkbenchPage -> useAppointments -> getAppointmentsQueue -> GET /api/appointments/queue`
- Backend ที่ตอบข้อมูลให้ Home คือ `backend/src/controllers/appointmentsQueueController.js` (`listAppointmentsQueue`)
- `backend/src/controllers/visitsController.js` เป็น legacy endpoint ของ `/api/visits` และไม่ใช่ตัวหลักของ Home ตอนนี้

### Q: แล้วไฟล์ไหน “จัดการข้อมูลจาก DB มาหน้า Home” จริง ๆ?

**A: ตัวหลักคือ `backend/src/controllers/appointmentsQueueController.js`**
- SQL ในไฟล์นี้เป็นคนกำหนดคอลัมน์ที่หน้า Home ใช้ (`date`, `bookingTime`, `customerName`, `phone`, `lineId`, `treatmentItem`, `staffName`)
- ฝั่ง frontend ทำหน้าที่เรียก API + map/ส่งต่อข้อมูลผ่าน `src/pages/workbench/useAppointments.js` และ render ใน `src/components/appointments/AppointmentsTablePanel.jsx`

## appointment_events_actor_check violated on admin appointment update

**What happened**
- ตอนแก้ appointment จากหน้า Admin Edit แล้ว submit
- `PATCH /api/admin/appointments/:id` ล้มด้วย `500` (จริง ๆ เป็น `23514` จาก Postgres)
- backend แตกตอน `INSERT INTO appointment_events ...` ใน `patchAdminAppointment`

**Why it happened (root cause)**
- โค้ดส่งค่า `actor` เป็น `req.user.id` (UUID)
- แต่ constraint `appointment_events_actor_check` อนุญาตเฉพาะ `customer | staff | system`
- และยังมีอีกชั้น: `event_type = ADMIN_APPOINTMENT_UPDATE` ไม่อยู่ใน `appointment_events_event_type_check` เดิม

**How it was fixed**
- เปลี่ยน actor ของ admin event ให้เป็นค่า canonical `staff`
- บังคับตรวจ `req.user.id` ด้วย helper (`requireAdminActorUserId`) แล้วเก็บ identity ลง `meta.admin_user_id`
- เพิ่ม error mapping สำหรับ `23514` ให้ตอบ message ชัดเจนแทน generic 500
- เพิ่ม migration script เพื่อขยาย `appointment_events_event_type_check` ให้รองรับ:
  - `ADMIN_APPOINTMENT_UPDATE`
  - `ADMIN_BACKDATE_CREATE`

**How to prevent regression**
- เวลามี event type ใหม่ ต้องอัปเดต DB check constraint พร้อมกันเสมอ
- ห้ามใช้ UUID เป็น `appointment_events.actor` โดยตรง ให้ใช้ enum ที่ DB อนุญาต แล้วเก็บ actor UUID ใน `meta`
- รัน `npm run verify:admin-edit` (backend) หลังแก้ logic admin edit ทุกครั้ง

## staff booking fails with `appointments_line_user_id_fkey` (`__STAFF__`)

**What happened**
- ระบบจองปกติจากหน้า Booking (`POST /api/appointments`) ล้มด้วย 500
- DB error: `Key (line_user_id)=(__STAFF__) is not present in table "line_users"` (`23503`)

**Why it happened (root cause)**
- โค้ด backend ตั้งค่า placeholder `line_user_id='__STAFF__'` ตอน insert appointments
- แต่ไม่มีการ bootstrap/ensure แถวนี้ใน `line_users`
- ตาราง appointments บังคับ `line_user_id` เป็น `NOT NULL` + FK

**How it was fixed**
- เพิ่ม ensure helper ใน staff booking path ให้ upsert system line user (`__STAFF__`, `staff-booking`) ก่อน insert
- เพิ่ม error response ที่อ่านง่าย (`422`) เมื่อเจอ FK constraint นี้

**How to prevent regression**
- ทุก flow ที่ใช้ system placeholder ใน FK (`__STAFF__`, `__BACKDATE__`) ต้องมี ensure/upsert ก่อนใช้งาน
- เวลาสร้าง placeholder ใหม่ ให้เช็ค FK + not null constraints ใน schema เสมอ

## lineId column shows system placeholders / phone identity instead of user input

**What happened**
- ในหน้า Home/Workbench คอลัมน์ `อีเมล / line ID` แสดงค่าอย่าง `__STAFF__`, `__BACKDATE__`, `phone:...`
- ผู้ใช้เข้าใจว่าเป็น line id ที่พนักงานพิมพ์ แต่จริง ๆ เป็น internal identity/FK

**Why it happened (root cause)**
- โค้ด list endpoint (`/api/appointments/queue`) map `lineId` โดย fallback ไป `appointments.line_user_id`
- `line_user_id` ถูกออกแบบให้เป็น internal key (รวม system placeholders) ไม่ใช่ display contact
- ค่า contact ที่คนกรอก (`email_or_lineid`) ไปอยู่ใน `appointment_events.meta`/`customer_identities` แต่ไม่ได้ถูกใช้เป็น source แรกของคอลัมน์นี้

**How it was fixed**
- เปลี่ยน source ของ `lineId` ใน list queries ให้เป็น display-safe order:
  1. latest `appointment_events.meta.email_or_lineid` (รวม `meta.after.email_or_lineid`)
  2. `customer_identities` (`LINE`/`EMAIL`)
  3. fallback `line_user_id` เฉพาะกรณีที่ไม่ใช่ system/phone/sheet prefixes
- เพิ่ม sanitize guard ซ้ำทั้ง backend/frontend เพื่อไม่ให้ `__STAFF__`, `__BACKDATE__`, `phone:*`, `sheet:*` โผล่ใน UI
- แสดง `-` เมื่อไม่มีค่า contact

**How to prevent regression**
- แยกเสมอว่า field ไหนเป็น internal FK (`line_user_id`) และ field ไหนเป็น display contact (`email_or_lineid` / derived display)
- เวลาเพิ่ม placeholder/system identity ใหม่ ต้องเพิ่ม deny-list ใน display mapper
- สำหรับคอลัมน์ที่ผู้ใช้มองเห็น ให้มี explicit `*_display` mapping และห้าม bind ตรงกับ internal key

## Staff Name column regressed after lineId mapping refactor

**What happened**
- หลังแก้ lineId mapping/sanitization แล้วคอลัมน์ `Staff Name` ในหน้า Home กลายเป็น `-` ทุกแถว

**Why it happened (root cause)**
- query ของ `/api/appointments/queue` และ `/api/visits?source=appointments` คืนค่า `staffName` แบบ hardcoded (`'-'`)
- frontend จึงไม่ได้รับชื่อ staff จริง แม้ข้อมูลมีอยู่ใน `sheet_visits_raw` หรือ `appointment_events.meta`

**How it was fixed**
- ปรับ backend query ให้ resolve `staffName` จากแหล่งข้อมูลจริงด้วย fallback ที่ชัดเจน:
  1. `sheet_visits_raw.staff_name`
  2. latest non-empty `appointment_events.meta.staff_name`
  3. latest non-empty `appointment_events.meta.staff_display_name`
  4. `'-'`
- คง lineId fix เดิม (sanitize placeholders/system prefixes) โดยไม่ rollback
- เสริม mapper ฝั่ง frontend ให้รองรับ `staffName`/`staff_name`

**How to prevent regression**
- ห้าม hardcode คอลัมน์ที่เป็น business display field (`staffName`, `lineId`) ถ้ามี source จริงใน DB
- เวลา refactor endpoint ให้มี contract checklist ต่อคอลัมน์หลักของ UI table
- เพิ่ม contract/integration test ที่ assert ว่า response shape มี field สำคัญครบและไม่เป็นค่าทดแทนผิด (`'-'`) โดยไม่จำเป็น

## Edge case: `sessions_total=1` excluded from selectable packages

**What happened**
- ใน `ServiceConfirmationModal` เคส one-off smooth แสดง `ไม่พบคอร์สที่ใช้งานได้`
- ทำให้ staff ไม่สามารถเลือก package เพื่อตัด 1/1 session ได้

**Why it happened (root cause)**
- Backend auto-create package logic เดิมตัดเคส `sessions_total <= 1` ออกจากการ infer package
- เลยไม่สร้าง `customer_packages` สำหรับคอร์ส 1 ครั้ง แม้มี definition อยู่ในตาราง `packages`
- Modal ได้ `profile.packages` ว่าง จึงไม่มี radio card ให้เลือก

**How it was fixed**
- ปรับ inference/lookup ให้รองรับ `sessions_total=1` (รวม fallback lookup สำหรับ smooth one-off)
- เพิ่มรับ `package_id` จาก staff booking payload แล้ว ensure active `customer_package` โดยตรง
- เพิ่ม regression test ฝั่ง frontend helper เพื่อยืนยันว่า package 1 session ที่เหลือ > 0 ต้องถูกแสดง

**How to prevent regression**
- ห้ามใช้เงื่อนไข `> 1` กับ session eligibility; ใช้ `> 0` สำหรับความสามารถในการตัดคอร์ส
- ใส่ edge-case test สำหรับ `sessions_total=1`, `sessions_used=0` ทุกครั้งที่แก้ package flow
- เมื่อเพิ่ม display format ใหม่ (เช่น `1/1 ...`) ต้องทบทวน backend infer/create logic ให้รองรับ format เดียวกัน

## Sync button only reloaded profile (did not provision package)

**What happened**
- ใน `ServiceConfirmationModal` เคส 1-session smooth ยังขึ้น `ไม่พบคอร์สที่ใช้งานได้`
- ผู้ใช้กด `ซิงค์คอร์ส` แล้วก็ยังไม่เห็น package card

**Why it happened (root cause)**
- ปุ่ม `ซิงค์คอร์ส` เดิมเรียกแค่ `GET /api/customers/:id/profile`
- ไม่มี backend action ที่ ensure/create `customer_packages` จาก appointment context
- ถ้า package ไม่ได้ถูกสร้างมาก่อนหน้า การ refresh profile อย่างเดียวไม่มีทางทำให้รายการโผล่

**How it was fixed**
- เพิ่ม backend endpoint `POST /api/appointments/:id/sync-course`
  - resolve package จาก `appointment_events.meta.package_id` หรือ `treatment_item_text`
  - fallback smooth one-off (`sessions_total=1`) เมื่อเป็น treatment code `smooth`
  - ensure active `customer_packages` แล้วค่อยให้ frontend reload profile
- ปรับ frontend modal ให้เรียก endpoint นี้ทั้ง:
  - ตอนเปิด modal (กรณีไม่มี package และต้องตัดคอร์ส)
  - ตอนกดปุ่ม `ซิงค์คอร์ส`

**How to prevent regression**
- ปุ่มที่ชื่อว่า “sync” ต้องมี side effect ที่จำเป็นตาม business intent ไม่ใช่แค่ refresh data
- แยกชัดเจนระหว่าง `refresh` กับ `provision/ensure` และทดสอบทั้งสองเส้นทาง
- สำหรับ flow ที่พึ่งพา `customer_packages` ให้มี endpoint กลางสำหรับ ensure package จาก appointment เสมอ

## package sync gating hid 1-session when 3-session already existed

**What happened**
- ลูกค้าที่มีทั้งคอร์ส 1 ครั้งและ 3 ครั้ง มองเห็นใน modal แค่คอร์ส 3 ครั้ง
- staff เลือกคอร์ส 1 ครั้งเพื่อตัดไม่ได้ แม้ควรมีสิทธิ์เลือก

**Why it happened (root cause)**
- logic ตอนเปิด modal sync คอร์สเฉพาะตอน `packages` ว่างเท่านั้น
- ถ้ามี package อยู่แล้วอย่างน้อย 1 ใบ (เช่น 3-session) ระบบไม่ sync เพิ่ม package ที่ขาด (1-session)
- backend profile ไม่ได้ dedupe เอง; ปัญหาเกิดจาก sync condition ฝั่ง frontend

**How it was fixed**
- เปลี่ยนให้ modal เรียก `syncAppointmentCourse` ทุกครั้งสำหรับเคสนัดที่ต้องตัดคอร์ส ก่อนโหลด profile
- คงปุ่ม `ซิงค์คอร์ส` ให้เป็น sync จริง + reload profile
- เพิ่ม test เคส `[1-session, 3-session]` ต้องแสดงครบทั้ง 2 ใบ

**How to prevent regression**
- หลีกเลี่ยงเงื่อนไข gate แบบ “sync เฉพาะ list ว่าง” ใน flow ที่ต้อง ensure consistency ราย appointment
- แยก test ให้ครอบเคส mix-package (`1+3`, `3+10`) เสมอ
- ใช้ sorting deterministic แทน dedupe เงียบ ๆ ในชั้น UI
