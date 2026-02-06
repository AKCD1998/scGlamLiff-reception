# Vitest Setup (Vite + React) — scGlamLiff-reception

เอกสารนี้สรุป “ตั้งแต่เริ่มจนถึงตอนนี้” ว่าเราตั้งค่า **Vitest** ให้เทสหน้า React ได้อย่างไร โดยใช้ไฟล์จริงในโปรเจกต์นี้เป็นแม่แบบ

> เป้าหมายตอนนี้: ให้ `npm run test:run` รันได้จริง + มี smoke test แรกสำหรับ `src/pages/WorkbenchPage.jsx`

---

## Vitest ใช้ทำอะไร (แยกชั้นการทดสอบ)

- **Unit/Integration (เร็วมาก, ไม่ยิง network จริง):** Vitest + Testing Library (โฟกัสที่ component/hook/logic)
- **Mock API แบบใกล้จริงขึ้น (ไม่ยิง backend จริง):** MSW (Mock Service Worker) — *ยังไม่ได้ทำในรอบนี้*
- **E2E (browser จริง, ช้า, ตรวจ flow ทั้งระบบ):** Playwright — *เป็นคนละชั้นกับ Vitest*

---

## Step 1) ติดตั้ง dependencies (devDependencies)

**WHY:** ต้องมี test runner + DOM environment + เครื่องมือ render UI สำหรับ React  
**WHAT:** เพิ่ม tooling เท่านั้น ไม่กระทบ production runtime  
**DO (PowerShell ที่ root โปรเจกต์):**

```powershell
npm i -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

**VERIFY:**

```powershell
npm ls vitest jsdom @testing-library/react @testing-library/jest-dom
```

> โปรเจกต์นี้ “มีครบแล้ว” (ดูใน `package.json`)

---

## Step 2) เพิ่ม npm scripts ใน `package.json`

**WHY:** ให้มีคำสั่งรันเทสที่จำง่าย และใช้ได้ทั้ง local/CI  
**WHAT:** เพิ่มแค่ command shortcut  
**EDIT:** `package.json` เพิ่มใน `"scripts"`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

**VERIFY:**

```powershell
npm run test -- --help
npm run test:run -- --help
```

**หมายเหตุ**
- `npm run test` = โหมด watch / interactive (เหมาะตอนพัฒนา)
- `npm run test:run` = รันครั้งเดียวแล้วจบ (เหมาะกับ CI)

---

## Step 3) ตั้งค่า Vitest ใน `vite.config.js` ให้ใช้ `jsdom` + setup file

**WHY:** React component ต้องใช้ DOM (`document`, `localStorage`)  
**WHAT:** บอก Vitest ว่าให้สร้าง environment แบบ browser จำลอง + โหลดไฟล์ setup ก่อนทุกเทส  
**EDIT:** `vite.config.js` เพิ่ม `test:` เข้าไปใน config object:

```js
// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'ghpages' ? '/scGlamLiff-reception/' : '/',
  server: { proxy: { '/api': 'http://localhost:5050' } },

  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    css: true,
  },
}))
```

**VERIFY:**

```powershell
npm run test:run
```

ถ้ายังไม่มีไฟล์เทสเลย จะเจอ:
- `No test files found` → *ปกติ* เพราะยังไม่สร้าง `*.test.*`

---

## Step 4) สร้าง `src/test/setup.js` (Setup file)

**WHY:** รวม “การตั้งค่ากลาง” ที่เทสทุกไฟล์ควรได้ (เช่น matchers ของ jest-dom)  
**WHAT:** ไฟล์นี้ **ไม่ใช่ test** — มันจะถูกรันก่อนทุก test file เพราะเราใส่ใน `setupFiles`  
**CREATE:** `src/test/setup.js`

```js
import "@testing-library/jest-dom/vitest";
```

**VERIFY:** ถ้าใน setup file มี syntax แปลก/JSX จะพังตั้งแต่เริ่มรันเทส  
ตัวอย่าง error ที่เคยเจอ:
- `Cannot parse .../src/test/setup.js: Expression expected.`  
สาเหตุ: เอาโค้ดเทส (เช่น `vi.mock(...)` ที่มี JSX) ไปใส่ใน setup file

---

## Step 5) สร้างไฟล์ test แรก (Smoke test)

**WHY:** ยืนยันว่าเครื่องมือทั้งหมดต่อกันครบ: Vitest → jsdom → Testing Library → React render ได้จริง  
**WHAT:** สร้าง `*.test.jsx` เพื่อให้ Vitest “discover” แล้วรัน  

**RULE เรื่องชื่อไฟล์**
- มี JSX → ใช้ `.jsx`
- เป็นเทส → ต้องมี `.test.` หรือ `.spec.` ในชื่อไฟล์

**CREATE:** `src/pages/WorkbenchPage.test.jsx`

> จุดสำคัญของ `WorkbenchPage`:
> - ใช้ `useNavigate()` → ต้องครอบด้วย `<MemoryRouter>`
> - มี call API (`getAppointments`, `getMe`) → ใน smoke test เรา “mock module” เพื่อไม่ยิงเน็ตจริง

```jsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import WorkbenchPage from "./WorkbenchPage";
import { getAppointments, deleteSheetVisit } from "../utils/appointmentsApi";
import { getMe, logout } from "../utils/authClient";

vi.mock("./Homepage", () => ({
  default: (props) => (
    <div data-testid="homepage">
      Homepage mock | loading: {String(props.loading)} | rows: {props.rows?.length ?? 0}
    </div>
  ),
}));
vi.mock("./Bookingpage", () => ({ default: () => <div data-testid="bookingpage">Booking mock</div> }));
vi.mock("./AdminBackdate", () => ({ default: () => <div data-testid="adminbackdate">Admin mock</div> }));

vi.mock("../utils/appointmentsApi", () => ({
  getAppointments: vi.fn(),
  deleteSheetVisit: vi.fn(),
}));
vi.mock("../utils/authClient", () => ({
  getMe: vi.fn(),
  logout: vi.fn(),
}));

beforeEach(() => {
  getMe.mockResolvedValue({
    ok: true,
    data: { display_name: "Test", username: "test", role_name: "staff" },
  });
  getAppointments.mockResolvedValue({ rows: [] });
  deleteSheetVisit.mockResolvedValue({ ok: true });
  logout.mockResolvedValue({ ok: true });
});

describe("WorkbenchPage", () => {
  it("renders without crashing", async () => {
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: /workbench/i })).toBeInTheDocument();
    expect(await screen.findByTestId("homepage")).toBeInTheDocument();

    await waitFor(() => {
      expect(getMe).toHaveBeenCalled();
      expect(getAppointments).toHaveBeenCalled();
    });
  });
});
```

---

## Step 6) รันเทส (ต้องรันจาก root โปรเจกต์)

**WHY:** npm script อยู่ใน `package.json` ที่ root (ไม่ใช่ `backend/`)  
**WHAT:** รันแบบ one-shot เพื่อให้เหมือน CI  
**DO:**

```powershell
cd "C:\Users\scgro\Desktop\Webapp training project\scGlamLiff-reception"
npm run test:run
```

**EXPECT:**
- เจอ `src/pages/WorkbenchPage.test.jsx`
- รัน 1 test และผ่าน

---

## Cheatsheet: รู้ได้ไงว่าไฟล์ควรเป็น `.js` / `.jsx` / `.test.jsx`

- `*.jsx` = มี JSX (เช่น `<div/>`, `<Component/>`)
- `*.js` = ไม่มี JSX (logic/hook/utils)
- `*.test.*` หรือ `*.spec.*` = ไฟล์เทสที่ Vitest จะ “เจอ” และรัน
- `src/test/setup.js` = setup file (ถูกเรียกก่อนเทส) แต่ **ไม่ใช่ test file**

ตัวอย่างจากโปรเจกต์นี้:
- `src/pages/WorkbenchPage.jsx` → component
- `src/pages/WorkbenchPage.test.jsx` → test ของ component
- `src/pages/workbench/useAppointments.js` → hook (ไม่มี JSX)
- `src/test/setup.js` → setup (jest-dom)

ค้นหา test files ทั้งโปรเจกต์:

```powershell
Get-ChildItem -Recurse -File src | Where-Object { $_.Name -match '\.(test|spec)\.' }
```

---

## Common mistakes (ที่เจอบ่อย + วิธีแก้)

1) **`No test files found`**
- สาเหตุ: ยังไม่มีไฟล์ชื่อ `*.test.*` / `*.spec.*`
- แก้: สร้างไฟล์เทส เช่น `src/pages/WorkbenchPage.test.jsx`

2) **`document is not defined` / `localStorage is not defined`**
- สาเหตุ: ไม่ได้ตั้ง `environment: 'jsdom'`
- แก้: ใส่ `test.environment = 'jsdom'` ใน `vite.config.js`

3) **`useNavigate() may be used only in the context of a <Router>`**
- สาเหตุ: ไม่ได้ครอบด้วย Router
- แก้: ในเทสให้ใช้ `<MemoryRouter>` ครอบ `WorkbenchPage`

4) **`Cannot parse src/test/setup.js`**
- สาเหตุ: เอาโค้ดเทส/JSX ไปใส่ `setup.js`
- แก้: ให้ `setup.js` มีแค่ setup/import ที่ไม่ใช้ JSX

5) **`Missing VITE_API_BASE` (จาก `src/utils/appointmentsApi.js`)**
- สาเหตุ: module จริงถูก import แล้ว `ensureConfig()` throw เพราะไม่มี env
- แก้ได้ 2 ทาง:
  - (ง่าย) module-mock `appointmentsApi` ในเทส
  - (จริงขึ้น) ตั้งค่า env สำหรับเทส + ใช้ MSW (ขั้นถัดไป)

---

## Next steps (ต่อยอดจาก smoke test)

ลำดับที่ “คุ้มและเห็นผลเร็ว”:

1) **UI: overlay เปิด/ปิด**
- ทำให้ `getAppointments` resolve ช้า แล้ว assert ว่า `role="status"` โผล่ตอนโหลด และหายหลังโหลดเสร็จ

2) **UI: tab switching**
- ใช้ `user-event` คลิกปุ่ม tab ใน `TopTabs` แล้ว assert ว่า content เปลี่ยน

3) **API interaction**
- assert ว่า `deleteSheetVisit` ถูกเรียกด้วย args ที่ถูกต้อง และมีการ reload (`getAppointments` ถูกเรียกซ้ำ)

4) **MSW**
- เปลี่ยนจาก module-mock เป็น mock ระดับ request เพื่อให้เทสเหมือน “frontend คุยกับ backend” แต่ไม่ยิงของจริง

5) **Playwright (optional)**
- เอาไว้ทดสอบ flow จริงบน browser + routing + CSS + build output (แยกจาก Vitest เพราะช้ากว่า)

