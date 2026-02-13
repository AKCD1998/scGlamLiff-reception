import type { Page } from "@playwright/test";
import { test as authTest, expect, loginViaUi } from "./auth";
import { loadSeededIds, type SeededIds } from "./seeded-ids";

type StaffFixtures = {
  staffPage: Page;
  seededIds: SeededIds;
};

export const test = authTest.extend<StaffFixtures>({
  seededIds: async ({}, use) => {
    await use(loadSeededIds());
  },

  staffPage: async ({ page, runtimeEnv, staffCredentials }, use) => {
    const loginResponse = await loginViaUi(page, runtimeEnv.baseUrl, staffCredentials);
    expect(loginResponse.status(), "staff login should succeed").toBe(200);
    await expect(page).toHaveURL(/workbench/);
    await use(page);
  },
});

export { expect };

