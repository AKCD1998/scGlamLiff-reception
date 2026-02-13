import type { BrowserContext, Page } from "@playwright/test";
import { test as authTest, expect } from "./auth";
import { loadSeededIds, type SeededIds } from "./seeded-ids";
import { ADMIN_STORAGE_STATE_PATH, loginAsAdmin, writeStorageState } from "../utils/auth";

type AdminFixtures = {
  adminPage: Page;
  seededIds: SeededIds;
};

export const test = authTest.extend<AdminFixtures>({
  seededIds: async ({}, use) => {
    await use(loadSeededIds());
  },

  adminPage: async ({ browser, runtimeEnv }, use) => {
    let context: BrowserContext = await browser.newContext({
      storageState: ADMIN_STORAGE_STATE_PATH,
    });
    let page = await context.newPage();
    await page.goto(`${runtimeEnv.baseUrl}/#/workbench`, { waitUntil: "domcontentloaded" });

    let meStatus = 0;
    try {
      const meRes = await page.request.get(`${runtimeEnv.apiBase}/api/auth/me`);
      meStatus = meRes.status();
    } catch {
      meStatus = 0;
    }

    if (meStatus !== 200) {
      await context.close();
      context = await browser.newContext();
      page = await context.newPage();
      const loginResult = await loginAsAdmin(page, runtimeEnv);
      expect(loginResult.status, "admin login should succeed when refreshing storage state").toBe(
        200
      );
      await writeStorageState(page, ADMIN_STORAGE_STATE_PATH);
      await page.goto(`${runtimeEnv.baseUrl}/#/workbench`, { waitUntil: "domcontentloaded" });
    }

    await use(page);
    await context.close();
  },
});

export { expect };
