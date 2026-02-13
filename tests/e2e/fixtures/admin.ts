import type { Page } from "@playwright/test";
import { test as authTest, expect, loginViaUi } from "./auth";
import { loadSeededIds, type SeededIds } from "./seeded-ids";

type AdminFixtures = {
  adminPage: Page;
  seededIds: SeededIds;
};

export const test = authTest.extend<AdminFixtures>({
  seededIds: async ({}, use) => {
    await use(loadSeededIds());
  },

  adminPage: async ({ page, runtimeEnv, adminCredentials }, use) => {
    const loginResponse = await loginViaUi(page, runtimeEnv.baseUrl, adminCredentials);
    expect(loginResponse.status(), "admin login should succeed").toBe(200);
    await expect(page).toHaveURL(/workbench/);
    await use(page);
  },
});

export { expect };

