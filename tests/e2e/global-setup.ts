import { chromium, type FullConfig } from "@playwright/test";
import { loadRuntimeEnv } from "./fixtures/env";
import {
  ADMIN_STORAGE_STATE_PATH,
  STAFF_STORAGE_STATE_PATH,
  loginAsAdmin,
  loginAsStaff,
  writeStorageState,
} from "./utils/auth";

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const runtimeEnv = loadRuntimeEnv();
  const browser = await chromium.launch({ headless: true });

  try {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage, runtimeEnv);
    await writeStorageState(adminPage, ADMIN_STORAGE_STATE_PATH);
    await adminContext.close();

    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    await loginAsStaff(staffPage, runtimeEnv);
    await writeStorageState(staffPage, STAFF_STORAGE_STATE_PATH);
    await staffContext.close();
  } finally {
    await browser.close();
  }
}

