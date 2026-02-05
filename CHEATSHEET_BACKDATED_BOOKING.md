# 🧾 SC GLAM – Cheatsheet: เพิ่ม “จองย้อนหลัง” (Admin)

Frontend (`src/pages/Bookingpage.jsx`) ตั้งกฎไม่ให้ผู้ใช้ “จองย้อนหลัง” เพื่อ data integrity แต่ในชีวิตจริงอาจต้องมีการบันทึกย้อนหลังเป็นครั้งคราว (เช่น ลูกค้ามาแล้วแต่ลืมลง, เคสโทรจองย้อนหลัง ฯลฯ)

Cheatsheet นี้สรุป 2 วิธีที่ทำให้ “คิว/booking” โผล่ในหน้า Workbench ได้:

1) **SQL ตรงเข้า PostgreSQL** (แนะนำถ้าเข้าถึง DB ได้)  
2) **เรียก API `POST /api/visits`** (แนะนำถ้าอยากทำเร็วโดยไม่เข้า DB)

> หมายเหตุ: ระบบ UI หลักอ่านคิวจาก `public.sheet_visits_raw` ผ่าน `GET /api/visits` (default source = `sheet`)

---

## ✅ รูปแบบข้อมูลที่ถูกต้อง

- `visit_date`: **`YYYY-MM-DD`** (เช่น `2026-02-05`)
- `visit_time_text`: **`HH:MM`** 24 ชั่วโมง (ต้อง 2 หลัก เช่น `09:00`, `14:00`)
- `sheet_uuid`: UUID แบบ `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

> แนะนำให้ใช้ ISO format เสมอเพื่อเลี่ยงความกำกวมแบบ `5/2/2026` (ก.พ. vs พ.ค.)

---

## วิธี A) Inject ด้วย SQL (แนะนำ)

### A1) Insert/Upsert 1 แถว เข้า `sheet_visits_raw`

แทนค่าตัวแปร:  
- `<SHEET_UUID>` = UUID ของแถว (ใช้ `gen_random_uuid()` ก็ได้)  
- `<DATE>` = `YYYY-MM-DD`  
- `<TIME>` = `HH:MM`

```sql
BEGIN;

INSERT INTO public.sheet_visits_raw (
  sheet_uuid,
  visit_date,
  visit_time_text,
  customer_full_name,
  phone_raw,
  email_or_lineid,
  treatment_item_text,
  staff_name,
  imported_at
) VALUES (
  '<SHEET_UUID>',
  DATE '<DATE>',
  '<TIME>',
  '<CUSTOMER_FULL_NAME>',
  '<PHONE_RAW>',
  '<EMAIL_OR_LINEID>',
  '<TREATMENT_ITEM_TEXT>',
  '<STAFF_NAME>',
  now()
)
ON CONFLICT (sheet_uuid) DO UPDATE
SET
  visit_date = EXCLUDED.visit_date,
  visit_time_text = EXCLUDED.visit_time_text,
  customer_full_name = EXCLUDED.customer_full_name,
  phone_raw = EXCLUDED.phone_raw,
  email_or_lineid = EXCLUDED.email_or_lineid,
  treatment_item_text = EXCLUDED.treatment_item_text,
  staff_name = EXCLUDED.staff_name,
  imported_at = now(),
  deleted_at = NULL,
  deleted_by_staff_id = NULL,
  delete_note = NULL;

COMMIT;
```

### A2) ตัวอย่างจริง (ตามเคส)

```sql
BEGIN;

INSERT INTO public.sheet_visits_raw (
  sheet_uuid,
  visit_date,
  visit_time_text,
  customer_full_name,
  phone_raw,
  email_or_lineid,
  treatment_item_text,
  staff_name,
  imported_at
) VALUES (
  '7e65a0b9-0a76-4c7b-bfba-e1fdaf9b8bcc',
  DATE '2026-02-05',
  '14:00',
  'คุณ ฉัตรวดี เทพบุตร',
  '0943489361',
  '',
  '1/3 smooth 999 1 mask',
  'ส้ม',
  now()
)
ON CONFLICT (sheet_uuid) DO UPDATE
SET
  visit_date = EXCLUDED.visit_date,
  visit_time_text = EXCLUDED.visit_time_text,
  customer_full_name = EXCLUDED.customer_full_name,
  phone_raw = EXCLUDED.phone_raw,
  email_or_lineid = EXCLUDED.email_or_lineid,
  treatment_item_text = EXCLUDED.treatment_item_text,
  staff_name = EXCLUDED.staff_name,
  imported_at = now(),
  deleted_at = NULL,
  deleted_by_staff_id = NULL,
  delete_note = NULL;

COMMIT;
```

### A3) Query ตรวจสอบว่าเข้าแล้ว

```sql
SELECT
  sheet_uuid,
  visit_date,
  visit_time_text,
  customer_full_name,
  phone_raw,
  treatment_item_text,
  staff_name,
  deleted_at,
  imported_at
FROM public.sheet_visits_raw
WHERE sheet_uuid = '<SHEET_UUID>';
```

---

## วิธี B) ยิง API (ไม่ต้องเข้า DB)

Backend มี endpoint ที่ insert ลง `sheet_visits_raw` ให้เลย: `POST /api/visits`

> ข้อดี: เร็ว/ไม่ต้องเข้า DB  
> ข้อควรระวัง: endpoint นี้ **ไม่ได้บล็อก “ย้อนหลัง” ที่ backend** (กฎบล็อกอยู่ที่ frontend) ดังนั้นควรใช้เฉพาะในวงที่ควบคุมได้

ตัวอย่าง (PowerShell):

```powershell
$apiBase = "<API_BASE>" # เช่น http://localhost:5050

$payload = @{
  visit_date = "2026-02-05"
  visit_time_text = "14:00"
  customer_full_name = "คุณ ฉัตรวดี เทพบุตร"
  phone_raw = "0943489361"
  email_or_lineid = ""
  treatment_item_text = "1/3 smooth 999 1 mask"
  staff_name = "ส้ม"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post -Uri "$apiBase/api/visits" -ContentType "application/json" -Body $payload
```

ผลลัพธ์จะได้ `{ ok: true, id: "<sheet_uuid>" }` (เก็บ `id` ไว้ใช้ขั้นต่อไป)

---

## หลัง Inject แล้ว: ให้ระบบ “สร้าง appointment/customer” (ถ้าต้องตัดคอร์ส/ทำสถานะ)

ระบบ staff จะ “ผูก” แถวใน `sheet_visits_raw` ให้กลายเป็น `appointments/customers/customer_identities` ผ่าน:

- `POST /api/appointments/from-sheet/:sheetUuid/ensure` (ต้อง login staff/admin ก่อน)

ใน UI ปกติ **ตอนกดเปิด modal ทำรายการ/ยืนยันบริการ** มันจะเรียก ensure ให้อัตโนมัติ (ดู `src/components/ServiceConfirmationModal.jsx`).

---

## (Optional) คอร์ส/แพ็กเกจ: ทำไมบางที ensure แล้วไม่สร้างคอร์สให้?

ใน backend ปัจจุบัน logic จะ “เดา” `package_code` จาก `treatment_item_text` เฉพาะเคสที่เป็นคอร์สแนว `1/3 smooth 999 1 mask` แล้วไปหาในตาราง `packages` ว่ามี `code` ตรงกันหรือไม่

ตัวอย่าง mapping:
- `1/3 smooth 999 1 mask` → `SMOOTH_C3_999_M1`

ถ้า `packages.code` ยังไม่มี ระบบจะไม่ auto-create ให้ (จะข้ามไป)  
ดังนั้นถ้าต้องการให้เลือกคอร์สได้ ให้สร้าง package definition ก่อน เช่น:

```sql
INSERT INTO public.packages (
  id,
  code,
  title,
  sessions_total,
  mask_total,
  price_thb,
  created_at
) VALUES (
  gen_random_uuid(),
  'SMOOTH_C3_999_M1',
  'Smooth 3 ครั้ง (Mask 1)',
  3,
  1,
  999,
  now()
)
ON CONFLICT (code) DO NOTHING;
```
