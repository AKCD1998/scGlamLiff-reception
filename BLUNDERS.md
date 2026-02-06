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
