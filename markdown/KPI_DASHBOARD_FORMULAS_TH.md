# KPI Dashboard รายเดือน (Read-only)

## วัตถุประสงค์
เอกสารนี้อธิบายที่มาของตัวเลขในหน้า `KPI รายเดือน` ของระบบ `scGlamLiff-reception` โดยยึดตามข้อมูลที่มีอยู่จริงใน repo ปัจจุบัน และย้ำว่า dashboard นี้:

- อ่านข้อมูลแบบ `SELECT` เท่านั้น
- ไม่เขียนกลับตารางธุรกิจเดิม
- ไม่เปลี่ยน flow จองคิว / ตัดคอร์ส / แก้สถานะ / หักแพ็กเกจ
- ใช้เพื่อสรุปประชุมทีมรายเดือน ไม่ใช่ระบบบันทึกธุรกรรมใหม่

## Endpoint ที่ใช้
- Backend: `GET /api/reporting/kpi-dashboard?month=YYYY-MM`
- Auth: ใช้ cookie session เดิมจาก `/api/auth/login`
- สิทธิ์: ทุก role ที่ login แล้วสามารถดูได้

## ช่วงเวลาที่ใช้ใน dashboard
- เดือนที่เลือกอิง `Asia/Bangkok`
- ถ้าไม่ส่ง `month` จะใช้เดือนปัจจุบัน
- รูปแบบ `month`: `YYYY-MM`
- ตัวอย่าง: `2026-03` = `2026-03-01` ถึง `2026-03-31`

## แหล่งข้อมูลที่ใช้จริง

### 1. appointments
ใช้สำหรับ:
- นัดหมายทั้งหมด
- สถานะ `completed / cancelled / no_show`
- กราฟสถานะนัดหมายรายวัน

field หลัก:
- `scheduled_at`
- `status`
- `customer_id`
- `line_user_id`

### 2. appointment_events
ใช้สำหรับ:
- หา `staff_name` ล่าสุดของนัดหมาย

หมายเหตุ:
- ระบบไม่ได้มีตารางกะงานพนักงานหรือชั่วโมงทำงานจริง
- dashboard จึงใช้ชื่อพนักงานจาก event log เพื่อทำ proxy metric

### 3. customer_packages + packages
ใช้สำหรับ:
- ยอดขายคอร์สรายเดือน
- สัดส่วนราคา 399 / 999 / 2999
- การต่อคอร์ส / ซื้อซ้ำ

field หลัก:
- `customer_packages.purchased_at`
- `customer_packages.customer_id`
- `packages.price_thb`
- `packages.sessions_total`
- `packages.title`
- `packages.code`

### 4. package_usages
ใช้สำหรับ:
- จำนวนครั้งที่ตัดคอร์สในเดือน
- จำนวนแพ็กเกจที่ถูกใช้งาน
- จำนวนแพ็กเกจที่ปิดจบในเดือน
- จำนวนครั้งที่ใช้ mask

field หลัก:
- `used_at`
- `customer_package_id`
- `used_mask`

### 5. appointment_receipts
ใช้เป็น fallback context เท่านั้นสำหรับ:
- ยอดรวมใบเสร็จที่มีการบันทึกไว้

ข้อจำกัด:
- มีเพียง `total_amount_thb` ระดับใบเสร็จ
- ยังไม่มี itemized split ว่าเป็นบริการหรือสินค้า

## สูตรคำนวณ KPI

## 1) นัดหมายทั้งหมด
สถานะ: `พร้อมใช้`

สูตร:
- นับจำนวนแถวใน `appointments`
- เฉพาะแถวที่ `DATE(scheduled_at AT TIME ZONE 'Asia/Bangkok')` อยู่ในเดือนที่เลือก

## 2) อัตราเข้ารับบริการสำเร็จ
สถานะ: `พร้อมใช้`

สูตร:
- `completed_count / total_appointments * 100`

โดย:
- `completed_count` = จำนวน `appointments.status = 'completed'`

## 3) No-show rate
สถานะ: `พร้อมใช้`

สูตร:
- `no_show_count / total_appointments * 100`

โดย:
- `no_show_count` = จำนวน `appointments.status IN ('no_show', 'no-show', 'noshow')`

## 4) Cancellation rate
สถานะ: `พร้อมใช้`

สูตร:
- `cancelled_count / total_appointments * 100`

โดย:
- `cancelled_count` = จำนวน `appointments.status IN ('cancelled', 'canceled')`

## 5) Course sales mix (399 / 999 / 2999)
สถานะ: `พร้อมใช้`

สูตร:
- นับจาก `customer_packages`
- ใช้วันที่ซื้อจาก `customer_packages.purchased_at`
- join `packages` เพื่ออ่าน `price_thb`
- จัด bucket เป็น:
  - `399 บาท`
  - `999 บาท`
  - `2999 บาท`
  - `ราคาอื่น`

ค่าที่แสดง:
- `sales_count` = จำนวนรายการขาย
- `buyer_count` = จำนวนลูกค้าไม่ซ้ำที่ซื้อ bucket นั้น
- `revenue_thb` = ผลรวม `packages.price_thb`

ข้อจำกัด:
- ไม่มี branch บน `customer_packages` โดยตรง
- dashboard เวอร์ชันนี้จึงสรุปภาพรวมทั้งระบบ ไม่ใช่ยอดขายแยกสาขา

## 6) Staff utilization
สถานะ: `ใช้ค่าแทน (proxy)`

เหตุผล:
- ระบบยังไม่มีตารางกะงาน, ชั่วโมงเข้างาน, capacity ต่อวัน, หรือ roster จริง
- จึงยังคำนวณ utilization แบบ operational จริงไม่ได้

สูตร proxy ที่ใช้แทน:
- ดึง `staff_name` ล่าสุดของแต่ละ appointment จาก `appointment_events`
- นับจำนวนเคสทั้งหมดต่อพนักงานในเดือน
- นับจำนวน `completed`, `cancelled`, `no_show` ต่อพนักงาน
- คำนวณ `completion_rate_pct = completed_count / total_appointments * 100`

สรุป:
- ตัวเลขนี้ใช้ดู “ภาระงานและผลลัพธ์ต่อพนักงาน”
- ยังไม่ใช่ “อัตราการใช้กำลังคนต่อชั่วโมงทำงานจริง”

## 7) Course redemption / usage completion
สถานะ: `พร้อมใช้`

### 7.1 การตัดคอร์สทั้งหมด
สูตร:
- นับจำนวนแถวใน `package_usages`
- ใช้ `used_at` เป็นวันที่อ้างอิง

### 7.2 ลูกค้าที่ถูกตัดคอร์ส
สูตร:
- นับ `COUNT(DISTINCT customer_package_id)` จาก `package_usages` ในเดือน

### 7.3 ใช้ Mask
สูตร:
- นับ `package_usages` ที่ `used_mask = true`

### 7.4 ปิดคอร์สในเดือนนี้
สูตร:
- สร้าง rollup ต่อ `customer_package_id`
- นับจำนวน usage ทั้งหมดต่อแพ็กเกจ
- เปรียบเทียบกับ `packages.sessions_total`
- ถ้า `sessions_used >= sessions_total`
- และ `MAX(used_at)` อยู่ในเดือนที่เลือก
- ให้นับเป็น `packages_completed_count`

หมายเหตุ:
- ใช้วิธีคำนวณจาก usage จริง
- ไม่ได้เชื่อสถานะ `customer_packages.status` อย่างเดียว

## 8) Renewal / repurchase rate
สถานะ: `พร้อมใช้`

นิยามที่ใช้:
- ลูกค้าที่ “ซื้อคอร์สในเดือนนี้” = `customer_id` ไม่ซ้ำใน `customer_packages` ที่ `purchased_at` อยู่ในเดือนที่เลือก
- ลูกค้าที่ “ซื้อซ้ำ / ต่อคอร์ส” = ลูกค้าในกลุ่มข้างต้นที่มี `customer_packages.purchased_at` ก่อนวันแรกของเดือนนี้อย่างน้อย 1 รายการ

สูตร:
- `repeat_buyers_count / unique_buyers_count * 100`

ค่าที่แสดง:
- `unique_buyers_count`
- `repeat_buyers_count`
- `first_time_buyers_count`
- `repurchase_rate_pct`

## KPI ที่ยังไม่สามารถคำนวณได้อย่างโปร่งใส

## 9) Free facial scan conversion
สถานะ: `ยังไม่พร้อม`

สาเหตุ:
- schema ปัจจุบันยังไม่มี field หรือ table ที่ระบุชัดว่า lead/appointment/customer มาจาก “free facial scan”
- ไม่มี source funnel ที่เชื่อม scan -> นัดหมาย -> ซื้อคอร์ส

สิ่งที่ต้องมีในอนาคตถ้าจะทำ:
- lead source ที่ชัดเจน
- event ว่ามีการสแกนจริงเมื่อไร
- event หรือ mapping ว่า scan รายใด convert เป็นลูกค้าหรือยอดขาย

## 10) Upsell conversion to skincare / products
สถานะ: `ยังไม่พร้อม`

สาเหตุ:
- ยังไม่มีตารางขายสินค้าแบบแยกรายการ
- ยังไม่มี field ที่บอกว่ามีการ upsell ผลิตภัณฑ์ในธุรกรรมใด

สิ่งที่ต้องมีในอนาคต:
- product sale line items
- transaction type หรือ sale category
- appointment-to-sale linkage ที่เชื่อถือได้

## 11) Revenue mix (service vs product)
สถานะ: `ยังไม่พร้อม`

สาเหตุ:
- `appointment_receipts` มีเพียงยอดรวมใบเสร็จ (`total_amount_thb`)
- ยังไม่มี split ว่าเงินส่วนใดเป็นบริการ และส่วนใดเป็นสินค้า

fallback ที่ dashboard แสดงได้ตอนนี้:
- จำนวนใบเสร็จที่บันทึก
- ยอดรวมใบเสร็จที่บันทึก

แต่:
- ห้ามตีความ fallback นี้ว่าเป็น product revenue หรือ service revenue แยกประเภทแล้ว

## กฎการตัดข้อมูลทดสอบ
dashboard ใช้ pattern เดียวกับ queue/calendar ที่ backend มีอยู่แล้วเพื่อตัดข้อมูล test/e2e ออก เช่น:
- ชื่อลูกค้าที่ขึ้นต้นแนว `e2e_`, `e2e_workflow_`, `verify-`
- `line_user_id` ลักษณะเดียวกันใน appointment

## สิ่งที่ dashboard นี้ “ไม่ทำ”
- ไม่สร้าง table ใหม่เพื่อเก็บ aggregate
- ไม่รัน ETL เขียนข้อมูลกลับ
- ไม่แก้ไขสถานะนัดหมาย
- ไม่ตัดคอร์ส
- ไม่แก้ไขแพ็กเกจ
- ไม่เปลี่ยน auth/session เดิม

## Short Test Checklist
- Login ด้วย user role ปกติ แล้วเห็น tab `KPI รายเดือน`
- เปิดหน้า dashboard แล้ว request ไปที่ `GET /api/reporting/kpi-dashboard`
- เปลี่ยนเดือนแล้วข้อมูล refresh โดยไม่เกิด write operation
- ตรวจว่า summary card แสดงตัวเลขตาม payload
- ตรวจว่า section `การใช้กำลังคนพนักงาน` แสดงป้าย `ใช้ค่าแทน`
- ตรวจว่า free scan / upsell / revenue mix แสดงเป็น `ยังไม่มีข้อมูล` พร้อมเหตุผล
- ตรวจว่า dashboard เปิดได้ทั้ง desktop และ mobile โดย table ยัง scroll ได้
- ตรวจจาก DB log หรือ code review ว่า endpoint นี้ใช้ `SELECT` / `WITH` เท่านั้น
