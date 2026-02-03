# 📦 SC GLAM – PostgreSQL Database Schema Overview

ระบบนี้ออกแบบมาเพื่อรองรับ:

* การจองจาก **LIFF (ลูกค้าจองเอง)**
* การจองจาก **หน้าร้าน / โทรศัพท์ (Walk-in / Operator)**
* การซื้อ **บริการแบบครั้งเดียว**
* การซื้อ **คอร์ส (หลายครั้ง + สิทธิ Mask ที่เลือกใช้ได้ไม่ตายตัว)**
* การติดตามว่า **ลูกค้าคนไหนใช้ไปกี่ครั้ง / เหลือกี่ครั้ง / ปิดคอร์สหรือยัง**

---

## 1️⃣ Core Identity Layer (ตัวตนลูกค้า)

### 🧑 customers

> ตัวแทน “คนจริง 1 คน” (ไม่ผูกกับ LINE / เบอร์ โดยตรง)

```sql
customers (
  id uuid PK,
  full_name text,
  created_at timestamptz
)
```

---

### 🔑 customer_identities

> ช่องทางที่ใช้ระบุตัวลูกค้า (LINE, PHONE, EMAIL)

```sql
customer_identities (
  id uuid PK,
  customer_id uuid FK -> customers(id),
  provider text,              -- 'LINE' | 'PHONE' | 'EMAIL'
  provider_user_id text,      -- line_user_id / phone / email
  is_active boolean,
  created_at timestamptz
)

UNIQUE (provider, provider_user_id)
```

📌 ลูกค้าคนเดียวมีได้หลาย identity
📌 เปลี่ยนเบอร์ / เพิ่ม LINE ใหม่ → ไม่กระทบ customer_id

---

## 2️⃣ Staff / Operator

### 👩‍💼 staffs

> พนักงานที่ให้บริการ / กดยืนยันการใช้คอร์ส

```sql
staffs (
  id uuid PK,
  display_name text UNIQUE,
  is_active boolean,
  created_at timestamptz
)
```

---

## 3️⃣ Appointment / Booking Layer

### 📅 appointments

> การนัดแต่ละครั้ง (ทั้งจาก LIFF และหน้าร้าน)

```sql
appointments (
  id uuid PK,
  customer_id uuid FK -> customers(id),
  line_user_id text,          -- legacy / backward compatibility
  treatment_id uuid FK -> treatments(id),
  branch_id text,
  scheduled_at timestamptz,
  status text,                -- booked / completed / cancelled / no_show
  selected_toppings jsonb,
  addons_total_thb integer,
  reschedule_count integer,
  max_reschedule integer,
  cancellation_policy text,
  created_at timestamptz,
  updated_at timestamptz
)

INDEX (customer_id, scheduled_at)
```

---

### 🧾 appointment_events

> log ทุกเหตุการณ์ของ appointment (audit trail)

```sql
appointment_events (
  id uuid PK,
  appointment_id uuid FK -> appointments(id),
  event_type text,
  event_at timestamptz,
  actor text,
  note text,
  meta jsonb
)
```

---

## 4️⃣ Product / Service Definition

### 💆 treatments

> บริการพื้นฐาน (เช่น smooth)

```sql
treatments (
  id uuid PK,
  code text UNIQUE,
  title_th text,
  title_en text,
  duration_min integer,
  is_active boolean,
  created_at timestamptz
)
```

---

### ➕ toppings

> Add-on ต่อครั้ง

```sql
toppings (
  id uuid PK,
  code text UNIQUE,
  category text,
  title_th text,
  title_en text,
  price_thb integer,
  is_active boolean,
  created_at timestamptz
)
```

---

## 5️⃣ Course / Package System (หัวใจของระบบ)

### 📦 packages

> นิยามแพ็กเกจ (เช่น 10 ครั้ง / mask 3)

```sql
packages (
  id uuid PK,
  code text UNIQUE,
  title text,
  sessions_total integer,     -- จำนวนครั้งทั้งหมด
  mask_total integer,         -- สิทธิ mask ทั้งหมด
  price_thb integer,
  created_at timestamptz
)
```

---

### 🧾 customer_packages

> แพ็กเกจที่ “ลูกค้าคนหนึ่ง” ซื้อ

```sql
customer_packages (
  id uuid PK,
  customer_id uuid FK -> customers(id),
  package_id uuid FK -> packages(id),
  status text,                -- active / completed / expired
  purchased_at timestamptz,
  expires_at timestamptz,
  note text
)
```

📌 ลูกค้าซื้อคอร์สเดียวกันซ้ำได้
📌 การปิดคอร์ส = ดูจาก usage เทียบ sessions_total

---

### ✅ package_usages

> การใช้คอร์ส “ต่อครั้ง” (เลือกใช้ mask หรือไม่ก็ได้)

```sql
package_usages (
  id uuid PK,
  customer_package_id uuid FK -> customer_packages(id),
  appointment_id uuid FK -> appointments(id),
  session_no integer,         -- ครั้งที่ 1..N
  used_mask boolean,
  used_at timestamptz,
  staff_id uuid FK -> staffs(id),
  note text
)

UNIQUE (customer_package_id, session_no)
```

📌 Mask ไม่จำเป็นต้องใช้ตามลำดับ
📌 ใช้ครั้งไหนก็ได้ → ระบบนับจาก used_mask = true

---

## 6️⃣ Purchase / Usage History (Legacy + One-off)

### 🧾 purchase_history

```sql
purchase_history (
  id uuid PK,
  line_user_id text,
  treatment_id uuid,
  sessions_bought integer,
  price_thb integer,
  purchased_at timestamptz,
  expires_at timestamptz,
  note text
)
```

---

### 📊 usage_history

```sql
usage_history (
  id uuid PK,
  line_user_id text,
  treatment_id uuid,
  appointment_id text,
  used_at timestamptz,
  provider text,
  scrub text,
  facial_mask text,
  misting text,
  extra_price_thb integer,
  note text
)
```

---

## 7️⃣ Raw Import Layer (จาก Google Sheet)

### 📄 sheet_visits_raw

> เก็บข้อมูลจากชีต “แบบไม่แปลง” เพื่อกันข้อมูลหาย

```sql
sheet_visits_raw (
  sheet_row_id uuid PK,           -- internal
  sheet_uuid uuid UNIQUE,          -- id จาก Google Sheet
  visit_date date,
  visit_time_text text,
  customer_full_name text,
  phone_raw text,
  email_or_lineid text,
  treatment_item_text text,
  staff_name text,
  imported_at timestamptz
)
```

📌 ใช้ `ON CONFLICT (sheet_uuid)` เพื่อ import ซ้ำได้
📌 เป็น source สำหรับ ETL → customers / appointments / packages

---

### 👀 View สำหรับดูข้อมูลเหมือนในชีต

```sql
v_sheet_visits (
  "วันที่",
  "เวลาจอง",
  "ชื่อ-นามสกุล ลูกค้า",
  "โทรศัพท์",
  "อีเมล / line ID",
  "Treatment item",
  "Staff Name",
  "id"
)
```

---

## 8️⃣ Business Logic ที่ระบบรองรับได้แล้ว

* ลูกค้าคนเดียว:

  * เริ่มจากหน้าร้าน → มาใช้ LINE ทีหลัง ✔
  * เปลี่ยนเบอร์โทร ✔
* คอร์ส:

  * ใช้ไม่เรียงลำดับ ✔
  * เลือกใช้ mask ครั้งไหนก็ได้ ✔
* ตรวจสอบ:

  * คอร์สไหน “ปิดแล้ว” / “เหลือกี่ครั้ง” ✔
* Audit:

  * ใครกดยืนยัน / ใช้เมื่อไร ✔
