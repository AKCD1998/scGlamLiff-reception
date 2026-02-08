# Blunders / Lessons Learned

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
