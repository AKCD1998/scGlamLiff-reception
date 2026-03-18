# Production Breadcrumbs (TH)

อัปเดตล่าสุด: `2026-03-18`

## จุดประสงค์
เอกสารนี้เป็น breadcrumb สำหรับย้อนทางเวลา production มีปัญหา โดยเฉพาะ 2 กลุ่มใหญ่ที่เราเจอจริงแล้ว:

1. LIFF / branch-device registration / LINE WebView
2. KPI dashboard / read-only reporting

เอกสารนี้ตั้งใจให้เป็นสิ่งที่ต้องเปิดอ่านก่อนเวลา:
- `/api/branch-device-registrations/*` ผิดปกติ
- LIFF เปิดได้แต่ register device ไม่ผ่าน
- login ผ่านแต่ cookie ไม่อยู่ใน LINE WebView
- KPI dashboard เปิดได้แต่ backend `500`
- branch id เริ่มไม่ตรงกันระหว่าง code, docs, และ DB

## TL;DR สั้นที่สุด
- staff auth หลักของระบบยังเป็น `username/password + cookie JWT`
- LIFF ไม่ใช่ staff auth หลัก
- LIFF ถูกใช้เป็น `branch-device guard/context`
- canonical branch value สำหรับ `staff003` ที่พิสูจน์ได้จาก DB คือ `branch-003`
- production เคยพังเพราะ `public.branch_device_registrations` ไม่มีตารางจริงใน DB
- production เคยพังเพราะ CORS origin ของ GitHub Pages ไม่ตรง
- LINE WebView ทำให้ staff cookie ไม่น่าเชื่อถือพอสำหรับ registration flow
- เราเลยเพิ่ม fallback เฉพาะ `POST /api/branch-device-registrations` ให้ใช้ `staff_username + staff_password` ได้
- KPI dashboard ต้อง tolerate optional table/section ที่หายไป ไม่ควร crash ทั้ง endpoint

## แผนที่สถาปัตยกรรมปัจจุบัน

### 1. Staff auth หลัก
- backend ใช้ `staff_users`
- login อยู่ที่ `/api/auth/login`
- success แล้วเซ็ต cookie `token`
- protected route ส่วนใหญ่ใช้ `requireAuth`
- ห้ามเข้าใจผิดว่า `Authorization: Bearer ...` คือ staff auth ของระบบหลัก เพราะมันไม่ใช่

ไฟล์อ้างอิง:
- `backend/src/controllers/authController.js`
- `backend/src/middlewares/requireAuth.js`

### 2. LIFF role ในระบบนี้
- LIFF ใช้เพื่อพิสูจน์ LINE identity ของ “มือถือ/อุปกรณ์”
- ไม่ได้แทน `req.user`
- ไม่ได้แทน role system
- ไม่ได้แทน admin/staff auth flow เดิม

ไฟล์อ้างอิง:
- `backend/src/services/lineLiffIdentityService.js`
- `backend/src/services/branchDeviceRegistrationsService.js`
- `backend/src/routes/branchDeviceRegistrations.js`

### 3. branch model ของระบบ
- write path ของ `branch_id` ยังเป็น text-tolerant / opaque text
- ยังไม่มี `branches` table
- ยังไม่มี direct relational mapping จาก `staff_users` ไป `branch_id`
- read filter บาง endpoint ยังต้องการ UUID branch id อยู่

ผลคือ branch model ตอนนี้ “ยังไม่ unified”

ไฟล์อ้างอิง:
- `backend/src/utils/branchContract.js`
- `backend/API_CONTRACT.md`

## การเดินทางที่เกิดขึ้นจริง

### ช่วงที่ 1: ตรวจ backend auth ก่อน
สิ่งที่พิสูจน์ได้:
- ระบบมี auth model เดิมอยู่แล้ว และค่อนข้างชัด
- `req.user` ถูกใช้เป็นฐานของ protected staff flow
- branch ไม่ได้อยู่ใน session/auth

ข้อสรุป:
- ห้ามสร้าง LIFF-first auth ใหม่ทันที
- ควรวาง LINE/LIFF เป็น layer เสริม ไม่ใช่ระบบ auth หลัก

### ช่วงที่ 2: เลือกสถาปัตยกรรม branch-device
ทางเลือกที่มีตอนนั้น:
- ทำ LINE เป็น primary auth
- map LINE เข้ากับ staff user โดยตรง
- ทำเป็น branch-device registration แยกจาก staff auth

สิ่งที่เราเลือก:
- เลือก branch-device registration

เหตุผล:
- ธุรกิจเป็นร้าน/หน้าสาขา มี turnover สูง
- สิ่งที่ต้องรู้จริง ๆ คือ “มือถือเครื่องนี้เป็นของสาขาไหน”
- ไม่จำเป็นต้อง bind LINE account ถาวรกับพนักงานทุกคน
- ลดแรงกระแทกกับระบบเดิม

### ช่วงที่ 3: เพิ่ม persistence สำหรับ branch-device
เราสร้าง:
- table `public.branch_device_registrations`
- migration script เฉพาะ
- route:
  - `POST /api/branch-device-registrations`
  - `GET /api/branch-device-registrations`
  - `GET /api/branch-device-registrations/me`
  - `PATCH /api/branch-device-registrations/:id`

business rule ที่เลือก:
- 1 `line_user_id` ต่อ 1 row
- re-register แล้ว update row เดิม
- บังคับ `status = active`

เหตุผลที่เลือกแบบนี้:
- ง่ายที่สุด
- เสี่ยงน้อย
- ไม่ต้องออกแบบ device history table เพิ่มในรอบแรก

### ช่วงที่ 4: production `/me` พังด้วย HTTP 500
อาการ:
- LIFF verification สำเร็จแล้ว
- route `/api/branch-device-registrations/me` ยัง `500`
- log เคยออกแนวขัดกันเอง เช่น verification success แต่ reason กลับเป็น `bad_request`

root cause จริงที่เจอ:
1. production DB ยังไม่มี `public.branch_device_registrations`
2. error mapping เดิมทำให้ downstream DB failure ถูก report ผิด reason

สิ่งที่แก้:
- ทำให้ unexpected error map เป็น `server_error`
- ไม่ overwrite `verificationReason` หลัง LIFF verify สำเร็จแล้ว
- แยก trace field เพิ่ม เช่น:
  - `failureStage`
  - `errorReason`
  - `lookupFailure`

บทเรียน:
- ถ้า `/me` verify ผ่านแต่ยัง 500 ให้เช็ก “table มีจริงไหม” ก่อนเป็นอันดับแรก

### ช่วงที่ 5: production CORS ไม่ผ่านจาก GitHub Pages
อาการ:
- frontend โฮสต์ที่ GitHub Pages
- browser request ไป backend ไม่ผ่าน

จุดที่ต้องจำ:
- CORS เทียบแค่ origin
- `https://akcd1998.github.io/ScGlamLiFF/` ไม่ใช่ origin สำหรับ allowlist
- origin ที่ถูกต้องคือ `https://akcd1998.github.io`

สิ่งที่แก้:
- normalize origin จาก env
- trim space
- ignore trailing slash
- เปิด preflight header ที่ LIFF ต้องใช้:
  - `Authorization`
  - `X-Line-Id-Token`
  - `X-Line-Access-Token`
  - `X-Liff-App-Id`

env ที่ต้องจำ:
```env
FRONTEND_ORIGINS=https://akcd1998.github.io
```

### ช่วงที่ 6: พิสูจน์ canonical branch value
โจทย์:
- frontend / docs ชอบพูดถึง `branch-003`
- แต่เราไม่อยากเดา
- ต้องพิสูจน์จาก backend SSOT + PostgreSQL

สิ่งที่พิสูจน์ได้:
- `staff_users` ไม่มี `branch_id`
- ไม่มี direct schema mapping `staff003 -> branch`
- แต่ `staff003` มี `display_name = SC 003 สาขาวัดช่องลม`
- จาก production `appointment_events + appointments` ที่ผูกกับ `staff003` พบว่า branch ที่ใช้จริงคือ `branch-003`

ข้อสำคัญ:
- ใน DB มีทั้ง `003` และ `branch-003`
- แต่ `003` ที่เห็นเป็นชุดข้อมูล admin/backdate บางส่วน
- สำหรับ activity ของ `staff003` ที่พิสูจน์ได้จริง ค่า canonical คือ `branch-003`

### ช่วงที่ 7: production LINE WebView ยัง register device ไม่ได้
อาการ:
- LIFF verification สำเร็จ
- แต่ `POST /api/branch-device-registrations` ยังติดเพราะ route ต้องการ staff cookie auth
- ใน LINE WebView cookie cross-site ไม่เสถียรพอ

สิ่งที่เรา “ไม่ทำ”:
- ไม่ rewrite auth system ทั้งก้อน
- ไม่เปลี่ยนทั้งระบบไปเป็น LIFF-first auth
- ไม่ไป bypass global `requireAuth`

สิ่งที่เรา “ทำจริง”:
- เพิ่ม fallback เฉพาะ route นี้
- `POST /api/branch-device-registrations` จะ:
  1. ลองใช้ cookie auth เดิมก่อน
  2. ถ้าไม่มี/ใช้ไม่ได้ ค่อยตรวจ `staff_username + staff_password` จาก request body
- fallback นี้:
  - ไม่เซ็ต cookie
  - ไม่ไปเปลี่ยน endpoint อื่น
  - ไม่แตะ `GET /api/branch-device-registrations/me`

เหตุผล:
- pragmatic ที่สุด
- แก้ปัญหา LINE WebView ได้เร็ว
- scope แคบ
- ลด regression risk

### ช่วงที่ 8: KPI dashboard production 500
อาการ:
- UI เข้าได้
- `GET /api/reporting/kpi-dashboard?month=YYYY-MM` ตอบ `500`

root cause ที่แก้:
- dashboard เดิมใช้แนวคิด “subquery ไหนพังก็ crash ทั้ง endpoint”
- production schema มีโอกาสขาด optional source table เช่น `appointment_receipts`

สิ่งที่แก้:
- ให้ KPI section รันแยกกัน
- ถ้าบางส่วนพัง ให้ทั้ง endpoint ยังตอบ `200` แบบ partial ได้
- ใส่ warning / unavailable section / partial note

บทเรียน:
- reporting/read model ต้องยอมรับ schema drift ได้ดีกว่า transactional flow

## ทางแยกที่เราเลือกแบบ pragmatic

ส่วนนี้คือ “เราไม่ได้บอกว่านี่ดีที่สุดในระยะยาว” แต่เป็นสิ่งที่ทำเพราะเวลา/งบ/ความเสี่ยงตอนนี้

### A. ยังไม่ทำ LIFF-first auth
สิ่งที่เสถียรกว่าในระยะยาวอาจเป็น:
- staff login แบบ LINE provider mapping
- device bootstrap + backend-issued app session

แต่ยังไม่ทำ เพราะ:
- กระทบ auth model ทั้งระบบ
- ต้อง redesign role/session boundary
- ต้อง migration user semantics
- เสี่ยงกับงานเดิมเยอะเกินไป

### B. ยังไม่สร้าง `branches` table
สิ่งที่ดีกว่า:
- branch SSOT ชัดเจน
- มี foreign key จริง
- ไม่มี `003` vs `branch-003` ปะปน

แต่ยังไม่ทำ เพราะ:
- branch domain model ในระบบเดิมยังไม่ครบ
- จะลาก refactor ไปหลาย endpoint
- ตอนนี้ write path ยังพึ่ง text branch id อยู่

### C. ยังไม่ทำ staff-to-LINE mapping ถาวร
สิ่งที่ดีกว่า:
- accountability รายคนดีขึ้น
- policy ล็อกคนกับ device ได้แน่นขึ้น

แต่ยังไม่ทำ เพราะ:
- ธุรกิจหน้าร้าน turnover สูง
- เป้าหมายตอนนี้คือรู้ว่า “เครื่องนี้อยู่สาขาไหน” ไม่ใช่ “LINE นี้คือพนักงานคนไหนตลอดไป”

### D. ยังไม่แก้ cross-site cookie ทั้งระบบ
สิ่งที่ดีกว่า:
- same-site app shell
- BFF / reverse proxy / single-origin deployment
- first-party cookie architecture

แต่ยังไม่ทำ เพราะ:
- ต้องยุ่งกับ deployment topology
- ต้องย้าย host/rewrite/cookie strategy
- ไม่ทัน timeline

ทางออกที่ใช้ตอนนี้:
- fallback explicit staff verification เฉพาะ registration POST

### E. ยังไม่ทำ migration automation เต็มรูปแบบสำหรับ production
สิ่งที่ดีกว่า:
- deploy แล้ว schema update อัตโนมัติ
- ลด human error

แต่ตอนนี้ยังพึ่ง:
- manual migration command บางตัว
- manual verification หลัง deploy

ผลคือ:
- ถ้า table ไม่อยู่ production จริง ระบบอาจพังก่อนจนกว่าจะมีคนสั่ง migration

## สิ่งที่ควรเช็กก่อนเป็นอันดับแรกเมื่อเกิดปัญหา

### กรณี 1: `/api/branch-device-registrations/me` พัง
เช็กลำดับนี้:
1. LIFF token ส่งมาครบไหม
2. log `[BranchDeviceGuard]` บอก `liffVerification` เป็นอะไร
3. ถ้า verify สำเร็จแล้วแต่ยังพัง ให้เช็ก table `branch_device_registrations`
4. ถ้า table มีแล้ว ให้เช็ก row ของ `line_user_id` นั้น
5. ถ้าไม่มี row ควรตอบ `200 not_registered` ไม่ใช่ `500`

### กรณี 2: `POST /api/branch-device-registrations` พังใน LINE WebView
เช็กลำดับนี้:
1. มี staff cookie ไหม
2. ถ้าไม่มี ให้ส่ง `staff_username` + `staff_password`
3. เช็กว่า request ยังส่ง LIFF token ครบ
4. เช็ก `reason`:
   - `missing_staff_auth`
   - `invalid_staff_credentials`
   - `invalid_token`
   - `server_error`

### กรณี 3: branch register แล้วสาขาผิด
เช็กลำดับนี้:
1. อย่าเดา branch จากชื่อไฟล์/frontend example อย่างเดียว
2. ตรวจ `staff_users` ว่ามี direct branch mapping หรือไม่
3. ถ้าไม่มี ให้ดู `appointment_events` + `appointments`
4. สำหรับ `staff003` ใช้ `branch-003`

### กรณี 4: KPI dashboard 500
เช็กลำดับนี้:
1. month format ต้องเป็น `YYYY-MM`
2. ดูว่า optional reporting source table ขาดไหม
3. ถ้า endpoint ยัง 500 อยู่ แปลว่า section isolation ถูกรื้อหรือ regression กลับมา

## คำสั่ง/SQL ที่ควรหยิบมาใช้ก่อน

### 1. เช็กว่า table branch-device มีจริงไหม
```sql
SELECT to_regclass('public.branch_device_registrations') AS branch_device_registrations_table;
```

### 2. เช็ก row ของ LINE user
```sql
SELECT
  id,
  line_user_id,
  branch_id,
  status,
  device_label,
  linked_at,
  last_seen_at,
  updated_at
FROM public.branch_device_registrations
WHERE line_user_id = 'FULL_LINE_USER_ID_HERE'
ORDER BY updated_at DESC, created_at DESC
LIMIT 5;
```

### 3. เช็ก canonical branch ของ `staff003`
```sql
SELECT
  a.branch_id,
  COUNT(*)::int AS created_event_count,
  COUNT(DISTINCT a.id)::int AS appointment_count,
  MIN(a.created_at) AS first_seen_at,
  MAX(a.created_at) AS last_seen_at
FROM public.appointment_events ae
JOIN public.appointments a ON a.id = ae.appointment_id
WHERE ae.event_type = 'created'
  AND (
    ae.meta->>'staff_user_id' = '8af35284-938a-4d72-8921-0053cd067b2b'
    OR ae.meta->>'staff_username' = 'staff003'
  )
GROUP BY a.branch_id
ORDER BY appointment_count DESC, a.branch_id;
```

### 4. รัน migration branch-device อย่างเดียว
```bash
cd backend
npm run migrate:branch-device-registrations
```

## request shape ที่ต้องจำ

### A. ตรวจ current LIFF device
```http
GET /api/branch-device-registrations/me
Authorization: Bearer <LINE access token>
X-Line-Id-Token: <LINE id token>
X-Line-Access-Token: <LINE access token>
X-Liff-App-Id: <LIFF app id>
```

### B. register device แบบใช้ cookie path เดิม
```http
POST /api/branch-device-registrations
Cookie: token=<staff jwt>
Authorization: Bearer <LINE access token>
X-Line-Id-Token: <LINE id token>
X-Line-Access-Token: <LINE access token>
X-Liff-App-Id: <LIFF app id>
Content-Type: application/json

{
  "branch_id": "branch-003",
  "device_label": "iPhone ทดสอบ สาขา 003"
}
```

### C. register device แบบ fallback สำหรับ LINE WebView
```http
POST /api/branch-device-registrations
Authorization: Bearer <LINE access token>
X-Line-Id-Token: <LINE id token>
X-Line-Access-Token: <LINE access token>
X-Liff-App-Id: <LIFF app id>
Content-Type: application/json

{
  "branch_id": "branch-003",
  "device_label": "iPhone ทดสอบ สาขา 003",
  "staff_username": "staff003",
  "staff_password": "..."
}
```

## สิ่งที่ห้ามลืมเวลา refactor รอบหน้า
- อย่าทำให้ LIFF กลายเป็น auth หลักแบบเงียบ ๆ โดยไม่มี design ใหม่
- อย่าทึกทักว่า `branch_id` เป็น UUID ทุกที่
- อย่าทึกทักว่า `branch-003` กับ `003` interchangeable โดยไม่มี migration plan
- อย่า overwrite trace จนแยกไม่ออกว่า fail ที่ LIFF verify หรือ fail ที่ DB lookup
- อย่าปล่อย reporting endpoint ให้ crash ทั้งก้อนเพราะ optional source table หาย
- อย่าพึ่ง cookie อย่างเดียวใน LINE WebView สำหรับ device registration flow

## ถ้าจะทำให้เสถียรกว่านี้ในอนาคต
ลำดับที่คุ้มสุดน่าจะเป็น:

1. ทำ branch SSOT ให้ชัด
   - มี `branches` table
   - มี canonical code / label / uuid

2. ทำ deployment ให้ first-party มากขึ้น
   - ลดปัญหา cross-site cookie
   - ลด fallback auth เฉพาะทาง

3. ถ้าจำเป็นค่อยออกแบบ LIFF-first bootstrap
   - แต่ต้องทำแบบ intentional ไม่ใช่แก้เฉพาะหน้า

4. ถ้าธุรกิจต้องการ accountability สูงขึ้นจริง
   - ค่อยเพิ่ม staff-to-LINE mapping หรือ device ownership history

## สถานะปัจจุบันที่ควรถือเป็น truth
- branch-device registration table มีอยู่แล้วใน DB
- ณ ช่วงที่เช็กล่าสุด table นี้เคยยังไม่มี row
- canonical branch ของ `staff003` ที่พิสูจน์ได้คือ `branch-003`
- production GitHub Pages origin ที่ต้อง allow คือ `https://akcd1998.github.io`
- fallback explicit staff verification มีผลเฉพาะ `POST /api/branch-device-registrations`

## ถ้าผมต้องกลับมา debug เรื่องนี้อีก ให้เริ่มตรงนี้ก่อน
1. อ่านไฟล์นี้ก่อน
2. ดู `backend/src/routes/branchDeviceRegistrations.js`
3. ดู `backend/src/middlewares/branchDeviceRegistrationStaffAuth.js`
4. ดู `backend/src/services/branchDeviceRegistrationsService.js`
5. ดู `backend/src/services/lineLiffIdentityService.js`
6. ดู log `[BranchDeviceGuard]`
7. เช็ก DB ด้วย SQL ในไฟล์นี้

