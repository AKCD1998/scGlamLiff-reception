# Project Diaries

## 2026-02-13 09:54 +07:00 — Testing Protocol (lightweight prep)

### Path notes
- Selected diary file: `markdown/PROJECT_DIARIES.md` (closest existing match to requested `PROJECT_DIARY.md`)
- Selected blunder file: `markdown/BLUNDERS.md` (closest existing match to requested `BLUNDER.md`)

### Environment assumptions
- Frontend code reads `VITE_API_BASE` (not `VITE_API_BASE_URL`)
- Local frontend URL: `http://localhost:5173`
- Local backend API base: `http://localhost:5050`
- Backend port source of truth:
  - `backend/server.js` uses `PORT || 5050`
  - `backend/.env` currently sets `PORT=5050`
- CORS for local FE should include `FRONTEND_ORIGIN=http://localhost:5173`
- Note: `backend/README-backend.md` still mentions `3001`; this protocol uses `5050` based on runtime code/env

### Run FE + BE locally
1. Start backend in one terminal:
```powershell
Set-Location backend
npm install
npm run dev
```
2. Start frontend in another terminal (repo root):
```powershell
Set-Location ..
npm install
npm run dev
```
3. Quick health check:
```powershell
curl.exe -sS http://localhost:5050/api/health
```

### Test steps for upcoming chunks
Manual steps:
1. Start backend/frontend with the commands above
2. Open `http://localhost:5173`
3. Login with local admin credentials from `backend/.env` (`ADMIN_USERNAME`, `ADMIN_PASSWORD`)
4. Execute the chunk test flow (for example: admin user create/update/reset, queue/customer checks)
5. If any failure occurs, append to `markdown/BLUNDERS.md` under `Integration Test Failures` with timestamp, expected vs actual, and exact reproduction steps

curl baseline (PowerShell):
```powershell
New-Item -ItemType Directory -Force .tmp | Out-Null
curl.exe -i -sS http://localhost:5050/api/health
curl.exe -i -sS -c .tmp\admin.cookies.txt -H "Content-Type: application/json" -d "{\"username\":\"<ADMIN_USERNAME>\",\"password\":\"<ADMIN_PASSWORD>\"}" http://localhost:5050/api/auth/login
curl.exe -i -sS -b .tmp\admin.cookies.txt http://localhost:5050/api/auth/me
curl.exe -i -sS -b .tmp\admin.cookies.txt http://localhost:5050/api/admin/staff-users
```

### Reproduction note (clarity issue found during setup)
- Symptom: backend docs mention default port `3001`, but runtime backend uses `5050`
- Reproduce:
```powershell
rg -n "3001" backend/README-backend.md
rg -n "PORT|5050" backend/server.js backend/.env
```
- Resolution for this protocol: use backend at `http://localhost:5050`

## 2026-02-13 10:04 +07:00 — Backend reachability + CORS sanity check

### What was tried
1. Inspected backend entrypoint/scripts:
```powershell
Get-Content backend/package.json
Get-Content backend/server.js
Get-Content backend/src/app.js
```
2. Attempted direct run on default port:
```powershell
Set-Location backend
node server.js
```
3. Ran isolated dev boot on alternate port to avoid collision:
```powershell
$env:PORT='5052'
npm run dev
```
4. Probed endpoints and CORS (using local dev origin and Render origin):
```powershell
Invoke-WebRequest http://localhost:5051/api/health
Invoke-WebRequest http://localhost:5051/api/admin/staff-users
Invoke-WebRequest http://localhost:5051/api/visits
Invoke-WebRequest http://localhost:5051/api/appointments/queue
Invoke-WebRequest -Method OPTIONS http://localhost:5051/api/health -Headers @{ Origin='http://localhost:5173'; 'Access-Control-Request-Method'='GET' }
Invoke-WebRequest -Method OPTIONS http://localhost:5050/api/health -Headers @{ Origin='https://scglamliff-reception.onrender.com'; 'Access-Control-Request-Method'='GET' }
```

### Failure observed
- `node server.js` on `:5050` failed with `EADDRINUSE` (port already in use).
- Short error:
  - `Error: listen EADDRINUSE: address already in use :::5050`

### Why this happened
- Existing process already listening on `localhost:5050` during test window.

### Next suspected fix
- Either:
  - stop existing process on `:5050` before starting a new local backend instance, or
  - run smoke checks on an alternate port via `PORT=5051/5052`.
- Keep `:5050` as default API base for frontend local integration.

## 2026-02-12 18:27 ICT — Bookingpage dark-mode fix (native date/time + react-select tokenized)

### Issue
- ใน Booking page โหมดมืดยังมีบาง control หลุดโทน light:
  - native `input[type=date]`, `input[type=time]`
  - `react-select` ในช่องบริการที่เลือกใช้

### Root cause
- `react-select` ใช้ `SELECT_STYLES` ที่ hard-code สีขาว/ดำ (`#fff`, `#000`) จึงไม่ตาม theme variables
- native date/time controls ต้องมี `color-scheme` และ picker indicator tuning แยกใน dark mode

### Fix
- ปรับ `SELECT_STYLES` ใน `src/pages/booking/utils/constants.js` ให้ใช้ tokens:
  - `--panel`, `--border`, `--text-strong`, `--text-muted`, `--tab-bg`, `--tab-hover`, `--booking-focus`
- เพิ่ม dark-mode CSS ใน `src/pages/Bookingpage.css`:
  - `color-scheme: dark` สำหรับ date/time/select
  - ปรับ `::-webkit-calendar-picker-indicator` ให้ไม่ขาวโดด
  - ปรับ placeholder ใน dark ให้คอนทราสต์อ่านง่าย

### Files changed
- `src/pages/booking/utils/constants.js`
- `src/pages/Bookingpage.css`

### Verification
1. สลับไป Dark mode
2. ตรวจ `queue-filter-date`, `booking-date`, `booking-time` ต้องไม่ขาวหลุดธีม
3. เปิด select บริการ ต้องได้เมนู/control โทนเดียวกับ dark theme
4. behavior เดิมของฟอร์มไม่เปลี่ยน

## 2026-02-12 18:22 ICT — Bookingpage dark-theme follow-up: force queue/tabs/table block to dark tokens

### Issue
- บล็อก `booking-panel` (tabs + queue filter + table) บางส่วนยังค้างโทนใกล้ Light mode ตอนอยู่ Dark mode

### Fix (CSS-only)
- เพิ่ม explicit `body[data-theme="dark"]` overrides ให้ block หลัก:
  - `.booking-panel`, `.booking-panel-header`, `.booking-tabs`, `.booking-tab`, `.booking-panel-body`
  - `.booking-table th`, `.booking-table td`
  - `.booking-queue-filter-clear`, `.booking-edit-button`
- เพิ่ม `color-scheme: dark` สำหรับ `.booking-field input/select` ใน dark mode เพื่อให้ native controls ไม่ขาวหลุดธีม

### Files changed
- `src/pages/Bookingpage.css`

### Verification
1. สลับธีมเป็น Dark
2. ตรวจ tabs/header/table ใน Booking queue ต้องไม่เป็นโทน light
3. ตรวจ date/input/select ไม่ขาวหลุดธีม
4. functionality เดิมไม่เปลี่ยน (style-only)

## 2026-02-12 18:14 ICT — Bookingpage visual parity pass (Light/Dark) to match Homepage baseline (CSS-only)

### Scope
- ปรับโทน UI ของ `Bookingpage` ให้สอดคล้องกับ baseline ของ `Homepage` ทั้ง Light/Dark โดยแก้เฉพาะ CSS
- ไม่มีการแตะ JS/React logic, state, props, event handlers, API calls

### What was improved
- Rebased สีหลักของ Bookingpage ไปใช้ theme tokens เดียวกับหน้า Home (`--panel`, `--border`, `--text-*`, `--tab-*`, `--button-bg`)
- ปรับ panel/header/tabs ให้คอนทราสต์และความลึกใกล้เคียงหน้า Home:
  - ลด hard-coded gradient/white overlays ที่ทำให้ dark mode แฟลตหรือสว่างเกิน
  - ใช้ border/shadow แบบเดียวกับ Home panel feel
- ปรับตาราง:
  - header/background/เส้น grid ให้ยึด token เดียวกับ Home
  - dark mode ไม่บังคับหัวตารางเป็นสีสว่างขัดธีมอีก
  - เพิ่ม hover state ให้อ่านง่ายขึ้น
- ปรับฟอร์ม:
  - input/select/time controls ให้ใช้ surface เดียวกับธีม
  - focus ring ให้สม่ำเสมอ (accent เดียวกับระบบ)
  - ปุ่ม action/ปุ่มย่อยมี border + depth ใกล้เคียงหน้า Home
- ปรับ modal/status cards ในไฟล์เดียวกันให้ surface และเงาเข้าธีม

### Files changed
- `src/pages/Bookingpage.css`

### Manual test checklist
1. เปิดหน้า `Homepage` และ `Bookingpage` ใน Light mode:
   - panel depth, border weight, text contrast, accent gold ต้องไปทางเดียวกัน
2. toggle เป็น Dark mode:
   - ไม่มี header/table ที่หลุดเป็นโทนสว่างจ้า
   - panel/input/table ยังอ่านง่ายและคอนทราสต์ถูกต้อง
3. ตรวจ tabs/buttons/inputs focus:
   - focus outline เห็นชัดและคงที่
4. ทดสอบการใช้งานเดิม (กรอกฟอร์ม/บันทึก/สลับแท็บ):
   - behavior ต้องเหมือนเดิมทุกจุด (เพราะ CSS-only)

## 2026-02-12 17:57 ICT — Standardize initial-fetch guard in CustomerProfileModal (prevent empty-state flash)

### What happened
- ตอนเปิด `CustomerProfileModal` มีบางจังหวะที่เห็น state ว่าง (`ยังไม่มีคอร์ส`, ประวัติว่าง, ตารางว่าง) ก่อนที่ profile fetch จะจบจริง

### Why it recurred
- pattern เดิมยังเหมือนเคสก่อนหน้า:
  - ค่าเริ่มต้นของข้อมูลเป็น array ว่าง
  - loading flag ใน React fetch lifecycle อาจยังไม่ขึ้นทัน render แรก หรือมีจังหวะ flip ระหว่าง transition
  - UI branch ของ empty state จึงยิงเร็วกว่า “initial fetch resolved”
- นี่เป็นปัญหาเชิงระบบของ flow ที่อิง `loading` ตรงๆ โดยไม่มี guard สำหรับการ resolve รอบแรก

### Standardized pattern applied
- ใช้ `hasResolvedOnce` gating สำหรับ initial fetch
- ใช้ `fetchCompletedRef` + `sawLoadingRef` ป้องกันปิด overlay ก่อนเวลา
- overlay เปิดทันทีเมื่อ modal เปิด และจะปิดเมื่อ:
  - fetch lifecycle ถูกมองว่าจบจริง
  - และ state commit แล้ว (ผ่าน `requestAnimationFrame`)
- empty state ทุกจุดถูก gate ด้วย `hasResolvedOnce`
- reset guard ตอน modal ปิด/เปิดใหม่ และตอนสลับ customer

### Coverage status
- หน้า/โมดอลหลักที่ใช้ pattern เดียวกันแล้ว:
  - `Homepage`
  - `Bookingpage`
  - `ServiceConfirmationModal`
  - `CustomerProfileModal`

### Files changed
- `src/components/CustomerProfileModal.jsx`
- `src/components/CustomerProfileModal.css`

### How to test
1. เปิด Customer Profile modal
2. throttle network (เช่น Slow 3G)
3. ยืนยันว่า overlay แสดงทันที
4. ยืนยันว่าไม่มี empty-state flash ระหว่างโหลด
5. overlay ต้องหายเมื่อ UI data นิ่งแล้วเท่านั้น
6. ปิดแล้วเปิดใหม่ ต้อง reset overlay guard ถูกต้อง

## 2026-02-12 17:45 ICT — Fix: Prevent empty-state flash in ServiceConfirmationModal (third occurrence of loading bug)

### What bug happened
- ตอนเปิด `ServiceConfirmationModal` มีบางจังหวะที่ขึ้น empty state เช่น `ไม่พบคอร์สที่ใช้งานได้` ทั้งที่ข้อมูลยังโหลดไม่จบ

### Why it recurred
- รูปแบบเดิมเหมือนที่เคยเจอใน `Homepage` และ `Bookingpage`:
  - ค่าเริ่มต้น `packages=[]`
  - `packagesLoading`/`loading` มีจังหวะยังไม่เป็น true ใน render แรก หรือ flip false ก่อน UI settle
  - เงื่อนไข empty state (`activePackages.length === 0`) จึงถูก render เร็วเกินไป
- overlay เดิมอิง loading flag ตรงๆ ทำให้ปิดเร็วตาม state transition ไม่ได้ผูกกับ “initial fetch resolved แล้วจริง”

### Standardized fix pattern
- ใช้ `hasResolvedOnce` gating สำหรับ initial fetch
- ใช้ `fetchCompletedRef` เพื่อระบุว่า lifecycle fetch รอบเปิด modal จบจริง
- ตั้ง `hasResolvedOnce=true` ใน `useEffect` หลัง `loading===false` และ `packagesLoading===false` เท่านั้น
- reset `hasResolvedOnce` ทุกครั้งที่ modal ปิด/เปิดใหม่
- guard empty state ให้แสดงได้เฉพาะหลัง `hasResolvedOnce` แล้ว

### Files changed
- `src/components/ServiceConfirmationModal.jsx`
- `src/components/ServiceConfirmationModal.css`

### How to test
1. เปิด Service modal จากหน้า Booking
2. จำลอง network ช้า (DevTools Slow 3G / throttling)
3. ยืนยันว่าไม่มี empty state flash ระหว่างโหลด (`ไม่พบคอร์ส...` ต้องไม่โผล่ก่อนเวลา)
4. overlay ต้องหายเมื่อข้อมูลนิ่งแล้วเท่านั้น
5. กรณี error: overlay หายแล้วแสดง error state; ไม่เด้งไป empty state ระหว่างโหลด

## 2026-02-12 17:34 ICT — Fix recurrence: Bookingpage showed empty state during initial load

### What bug happened
- หน้า `Bookingpage` ยังมีจังหวะขึ้น `ไม่มีข้อมูล` ระหว่าง initial fetch ของแท็บ Queue/Customers
- พฤติกรรมนี้เป็น pattern เดียวกับที่เคยเกิดใน `Homepage` (empty state โผล่ก่อนโหลดเสร็จจริง)

### Why it recurred
- ข้อมูลตั้งต้นเป็น array ว่าง (`rows=[]`, `customers=[]`) อยู่แล้ว
- เดิม gating ฝั่ง panel ใช้ `loading && hasLoadedOnce` ทำให้ช่วงที่ `hasLoadedOnce=false` แต่ `loading` ยังไม่ขึ้น/มีจังหวะตกลงชั่วคราว (เช่น effect replay/abort ใน StrictMode) panel ไม่ถือว่า loading
- เมื่อ `loading=false` และ `error=null` เงื่อนไขใน table ตกไปที่ `rows.length === 0` จึงแสดง `ไม่มีข้อมูล` เร็วเกินไป
- สรุปคือขาด guard ว่า “ต้องโหลดครั้งแรกเสร็จแล้ว” ก่อนอนุญาต empty state

### Fix
- คงแนวทาง `hasLoadedOnce` และทำให้ lifecycle ชัดเจน:
  - `queueHasLoadedOnce`
  - `customersHasLoadedOnce`
- ตั้ง `hasLoadedOnce=true` เมื่อ fetch จบจริง (success/error) และไม่ตั้งตอน abort
- ปรับ loading ที่ส่งให้ panel:
  - `queuePanelLoading = loading || !queueHasLoadedOnce`
  - `customerPanelLoading = customersLoading || !customersHasLoadedOnce`
- ปรับ full-page initial overlay ให้ยึด first-load-per-tab:
  - `isQueueInitialLoading = activeTab === "queue" && !queueHasLoadedOnce`
  - `isCustomersInitialLoading = activeTab !== "queue" && !customersHasLoadedOnce`
- ผลคือระหว่าง first load จะเห็น loading UI เสมอ และ `ไม่มีข้อมูล` จะแสดงได้ต่อเมื่อโหลดรอบแรกจบแล้วเท่านั้น

### Files changed
- `src/pages/Bookingpage.jsx`

### How to test
1. เข้า `Bookingpage` ครั้งแรก:
   - ต้องเห็น loading UI และต้องไม่เห็น `ไม่มีข้อมูล` ระหว่างโหลด
2. หลังโหลดเสร็จ:
   - มีข้อมูล -> แสดงแถวข้อมูล
   - ไม่มีข้อมูล -> แสดง `ไม่มีข้อมูล`
3. จำลอง error ตอนโหลด:
   - loading ต้องหาย และแสดง error state
   - ต้องไม่ fallback เป็น `ไม่มีข้อมูล` ระหว่างยังโหลด
4. สลับแท็บไป `Customers` ครั้งแรก:
   - ใช้กติกาเดียวกัน (loading ก่อน, empty หลัง first load จบ)

## 2026-02-12 17:27 ICT — Add Bookingpage full-page loading overlay (queue + customers) with hasLoadedOnce gating; prevent double overlay

### Summary
- เพิ่ม full-page loading overlay บน `Bookingpage` สำหรับโหลดครั้งแรกของแต่ละแท็บ (Queue / Customers)
- กัน overlay ซ้อน โดยแยกเงื่อนไข:
  - initial load ต่อแท็บ = ใช้ full-page overlay
  - โหลดรอบถัดไป = ใช้ panel/table-level loading เดิม
- ปรับให้ error ยังแสดงใน panel ได้ตามปกติ (overlay ปิดเมื่อโหลดจบ แม้จบด้วย error)

### Files changed
- `src/pages/Bookingpage.jsx`
- `src/pages/Bookingpage.css`

### Implementation notes
- เพิ่ม state:
  - `queueHasLoadedOnce`
  - `customersHasLoadedOnce`
- เพิ่ม computed loading:
  - `isQueueInitialLoading = activeTab === "queue" && loading && !queueHasLoadedOnce`
  - `isCustomersInitialLoading = activeTab !== "queue" && customersLoading && !customersHasLoadedOnce` (ครอบกรณี first open ก่อน fetch เริ่มด้วย `!customersLoaded`)
  - `isPageOverlayOpen = isQueueInitialLoading || isCustomersInitialLoading`
- ปรับ prop ลง panel:
  - `QueuePanel.loading = loading && queueHasLoadedOnce`
  - `CustomerPanel.customersLoading = customersLoading && customersHasLoadedOnce`
- เพิ่ม `LoadingOverlay` ใน `booking-grid` และใส่ `aria-busy` ตอน overlay เปิด
- เพิ่ม `position: relative` ให้ `.booking-grid` เพื่อให้ overlay ครอบเฉพาะพื้นที่ grid

### Regression risk
- หากมี flow ที่พึ่งพา `loading=true` ของ panel ตั้งแต่รอบแรก อาจเปลี่ยน behavior เล็กน้อย (รอบแรกจะถูกบังด้วย page overlay แทน)
- ในโหมด StrictMode ที่ abort/replay effect เร็วมาก อาจมีจังหวะเปลี่ยน state ถี่ แต่ overlay/empty-state ถูกกันไว้ด้วย hasLoadedOnce gating

### How to test
1. เปิดหน้า Booking ครั้งแรก:
   - เห็น full-page overlay (`กำลังโหลดข้อมูล...`) แล้วหายเมื่อคิวโหลดเสร็จ
2. เปลี่ยนไปแท็บ Customers ครั้งแรก:
   - หากกำลังโหลดลูกค้า ให้เห็น full-page overlay ครั้งเดียว แล้วหาย
3. หลังแท็บนั้นโหลดครบแล้ว:
   - เปลี่ยน filter/รีโหลดข้อมูล ต้องไม่ขึ้น full-page overlay อีก
   - เห็นเฉพาะ panel-level loading (`กำลังโหลด...`) ได้
4. จำลอง error:
   - overlay ต้องหายเมื่อโหลดจบด้วย error
   - ข้อความ error ในตารางยังแสดง

## 2026-02-12 — Homepage loading UX: initial-load overlay + no double overlay

### Problem observed
- หน้า Home/Workbench เคยมี 2 ปัญหา:
  - บางจังหวะขึ้น `ไม่มีข้อมูล` ระหว่างที่ request แรกยังไม่จบ
  - มี overlay ซ้อนกัน 2 ชั้น (full-page + table overlay) ตอนโหลด

### What changed
- เพิ่ม reusable full-page overlay component:
  - `src/components/LoadingOverlay.jsx`
  - `src/components/LoadingOverlay.css`
- ผูก full-page overlay กับ `Homepage` และเพิ่ม accessibility:
  - `aria-busy` ที่ container หลัก
  - `role="status"` / `aria-live="polite"` ที่ overlay
  - ไฟล์: `src/pages/Homepage.jsx`, `src/pages/Homepage.css`
- ทำให้ fetch state ใน `useAppointments` แข็งแรงขึ้นด้วย request guard + `hasLoadedOnce`:
  - ป้องกัน stale/aborted request มากด `loading=false` ก่อน request ล่าสุดจบ
  - ไฟล์: `src/pages/workbench/useAppointments.js`
- ส่ง `hasLoadedOnce` จาก parent ลงหน้า Home/Table:
  - `src/pages/WorkbenchPage.jsx`
  - `src/pages/Homepage.jsx`
  - `src/components/appointments/AppointmentsTablePanel.jsx`
- ปรับกติกาการแสดง loading ให้ไม่ซ้อนกัน:
  - `pageInitialLoading = loading && !hasLoadedOnce` (ใช้ full-page overlay เฉพาะ initial load)
  - `tableLoading = loading && hasLoadedOnce` (ใช้ table overlay เฉพาะ reload รอบถัดไป)
  - Empty state `ไม่มีข้อมูล` จะแสดงเมื่อโหลดเสร็จแล้วเท่านั้น

### Result
- เข้า Home ครั้งแรกหลัง login: เห็น full-page loading ชัดเจน
- โหลดรอบถัดไป (เช่นเปลี่ยนวัน/รีโหลด): เห็นเฉพาะ table-level loading
- ไม่เกิด overlay ซ้อนสองชั้น และ error state ยังแสดงได้ตามปกติเมื่อโหลดล้มเหลว

### Verification
- `npx eslint src/pages/workbench/useAppointments.js src/pages/WorkbenchPage.jsx src/pages/Homepage.jsx src/components/appointments/AppointmentsTablePanel.jsx`
- `npm run build`

## 2026-02-11 — Refactor: Bookingpage Step 1 (extract helpers/constants)

### What changed
- Extracted pure helper functions/constants/validators from `src/pages/Bookingpage.jsx` into small modules (no logic/UI/styling changes).
- Updated `src/pages/Bookingpage.jsx` imports to use the new modules.

### Files added
- `src/pages/booking/utils/bookingPageFormatters.js`
  - `normalizeRow`, `normalizeCustomerRow`, `shortenId`, `formatAppointmentStatus`, `getRowTimestamp`, `normalizeTreatmentOptionRow`
- `src/pages/booking/utils/constants.js`
  - `TIME_CFG`, `SELECT_STYLES`, `EMAIL_PATTERN`, `LINE_ID_PATTERN`, `buildFallbackTreatmentOptions`
- `src/pages/booking/utils/validators.js`
  - `sanitizeThaiPhone`, `sanitizeEmailOrLine`

### Verification
- `npm run test:run`
- `npm run build`

### Commit
- `refactor(booking): extract Bookingpage utils` (33b6921)

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

## 2026-02-13 — E2E Error Handling Sweep (Prompt 7)

### What was done
- เพิ่มไฟล์ทดสอบใหม่ `tests/e2e/specs/06_error_handling.spec.ts`
- ครอบคลุมสถานะ error ตามหัวข้อ:
  - `400` invalid payload (create user missing username)
  - `401` protected endpoint without token (new context, no storageState)
  - `403` staff tries admin endpoint/page
  - `404` patch non-existent id
  - `409` duplicate username
  - `500` simulated throw: ตรวจแล้วไม่มี safe toggle ที่รองรับ จึงบันทึกเป็น `not supported`
- เพิ่ม assertion ฝั่ง FE ในสเปก:
  - แสดงข้อความ error ที่คาดหวัง (Thai message/fallback ตามที่มีจริงในหน้า)
  - หน้าไม่ crash หลังเจอ error
  - ปุ่ม/คอนโทรลถูก disable ระหว่าง loading (เช่น submit/row controls)
  - กรณี `400`, `404`, `409` ต้อง recover ได้ด้วย action ที่ถูกต้องรอบถัดไป

### Verification
- คำสั่งที่รัน:
  - `npm run test:e2e -- tests/e2e/specs/06_error_handling.spec.ts`
- ผลลัพธ์:
  - `6 passed`
  - matrix ผ่านครบสำหรับ `400/401/403/404/409`
  - `500` ถูก mark เป็น `not supported` ตามเงื่อนไข safe toggle

### Notes
- ระหว่างเขียนเทสต์มี issue selector ปุ่ม submit กว้างเกินไป (ชนปุ่ม Reset Password หลายแถว) ใน run แรก และได้แก้ให้เลือกเฉพาะ `.admin-users-form button[type="submit"]` แล้ว rerun ผ่านครบ
- รอบนี้ **ไม่ได้ append `markdown/BLUNDERS.md`** เพราะไม่มี blunder ฝั่งแอปที่ยังค้างหลังแก้ไข

## 2026-02-13T04:54:19.982Z — E2E Prod-like Check (Prompt 8)

- Spec: `07_prod_like.spec.ts > 07 Production-like check > build + backend prod boot + localhost scan + preview sanity`
- Result: FAIL
- Build: PASS (exit=0)
- Missing env vars: (none)
- Backend check: SKIPPED
- Localhost scan: FAIL (1 hits)
- Preview console check: SKIPPED
- Summary artifact: `tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-localhost-hits.json`

### Commands
- `npm run build` (cwd: `.`) -> exit=0, timeout=false | stderr: [33m (!) Some chunks are larger than 500 kB after minification. Consider: - Using dynamic import() to code-split the application - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m

## 2026-02-13T04:54:20.153Z — E2E Failure: 07_prod_like.spec.ts > 07 Production-like check > build + backend prod boot + localhost scan + preview sanity

- Spec: `07_prod_like.spec.ts > 07 Production-like check > build + backend prod boot + localhost scan + preview sanity`
- Reproduction: `npm run test:e2e -- tests/e2e/specs/07_prod_like.spec.ts --grep "build + backend prod boot + localhost scan + preview sanity"`
- Error: Error: [PROD_LIKE_FAILURE] step=dist-localhost-scan command="grep dist for "localhost|127.0.0.1"" expected="built dist has no hardcoded localhost/127.0.0.1 URLs" actual="found 1 localhost references" artifact="tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-localhost-hits.json"
- Artifacts: screenshot: `tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-retry-0.png`, metadata: `tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-retry-0--failure-meta.json`

<!-- e2e-log-index: 2026-02-13T04:54:20.153Z diary=markdown/PROJECT_DIARIES.md blunder=markdown/BLUNDERS.md -->

## 2026-02-13T04:55:28.511Z — E2E Prod-like Check (Prompt 8)

- Spec: `07_prod_like.spec.ts > 07 Production-like check > build + backend prod boot + localhost scan + preview sanity`
- Result: FAIL
- Build: PASS (exit=0)
- Missing env vars: (none)
- Backend check: FAIL (npm run start)
- Localhost scan: PASS
- Preview console check: SKIPPED
- Summary artifact: `tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-backend-probe-failure.json`

### Commands
- `npm run build` (cwd: `.`) -> exit=0, timeout=false | stderr: [33m (!) Some chunks are larger than 500 kB after minification. Consider: - Using dynamic import() to code-split the application - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m

## 2026-02-13T04:55:28.618Z — E2E Failure: 07_prod_like.spec.ts > 07 Production-like check > build + backend prod boot + localhost scan + preview sanity

- Spec: `07_prod_like.spec.ts > 07 Production-like check > build + backend prod boot + localhost scan + preview sanity`
- Reproduction: `npm run test:e2e -- tests/e2e/specs/07_prod_like.spec.ts --grep "build + backend prod boot + localhost scan + preview sanity"`
- Error: Error: [PROD_LIKE_FAILURE] step=backend-endpoint-probe command="npm run start && probe /api/admin/staff-users, /api/appointments/queue, /api/visits" expected="base URL responds and required API routes are not 404" actual="missing routes: /api/admin/staff-users, /api/appointments/queue, /api/visits" artifact="tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-backend-probe-failure.json"
- Artifacts: screenshot: `tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-retry-0.png`, metadata: `tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-retry-0--failure-meta.json`

<!-- e2e-log-index: 2026-02-13T04:55:28.618Z diary=markdown/PROJECT_DIARIES.md blunder=markdown/BLUNDERS.md -->

## 2026-02-13T04:57:48.987Z — E2E Prod-like Check (Prompt 8)

- Spec: `07_prod_like.spec.ts > 07 Production-like check > build + backend prod boot + localhost scan + preview sanity`
- Result: FAIL
- Build: PASS (exit=0)
- Missing env vars: (none)
- Backend check: PASS (npm run start)
- Localhost scan: PASS
- Preview console check: FAIL
- Summary artifact: `tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-preview-boot-failure.json`

### Commands
- `npm run build` (cwd: `.`) -> exit=0, timeout=false | stderr: [33m (!) Some chunks are larger than 500 kB after minification. Consider: - Using dynamic import() to code-split the application - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m

## 2026-02-13T04:57:49.141Z — E2E Failure: 07_prod_like.spec.ts > 07 Production-like check > build + backend prod boot + localhost scan + preview sanity

- Spec: `07_prod_like.spec.ts > 07 Production-like check > build + backend prod boot + localhost scan + preview sanity`
- Reproduction: `npm run test:e2e -- tests/e2e/specs/07_prod_like.spec.ts --grep "build + backend prod boot + localhost scan + preview sanity"`
- Error: Error: [PROD_LIKE_FAILURE] step=preview-boot command="npm run preview -- --host 127.0.0.1 --port 4173 --strictPort" expected="vite preview boots and serves dist" actual="vite preview process did not report ready state within 30000ms" artifact="tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-preview-boot-failure.json"
- Artifacts: screenshot: `tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-retry-0.png`, metadata: `tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-retry-0--failure-meta.json`

<!-- e2e-log-index: 2026-02-13T04:57:49.141Z diary=markdown/PROJECT_DIARIES.md blunder=markdown/BLUNDERS.md -->

## 2026-02-13T04:58:38.038Z — E2E Prod-like Check (Prompt 8)

- Spec: `07_prod_like.spec.ts > 07 Production-like check > build + backend prod boot + localhost scan + preview sanity`
- Result: PASS
- Build: PASS (exit=0)
- Missing env vars: (none)
- Backend check: PASS (npm run start)
- Localhost scan: PASS
- Preview console check: PASS
- Summary artifact: `tests/e2e/artifacts/2026-02-13/07_prod_like.spec.ts-07-Production-like-check-build-+-backend-prod-boot-+-localhost-scan-+-preview-sanity-prod-like-summary.json`

### Commands
- `npm run build` (cwd: `.`) -> exit=0, timeout=false | stderr: (!) Some chunks are larger than 500 kB after minification. Consider: - Using dynamic import() to code-split the application - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
