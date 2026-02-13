import { test, expect } from "../fixtures/auth";
import { loginAsAdmin } from "../utils/auth";

test.describe("01 Auth Flow", () => {
  test("positive: admin login succeeds and protected API can be called", async ({
    page,
    runtimeEnv,
    adminCredentials,
  }) => {
    const loginResult = await loginAsAdmin(page, runtimeEnv);
    expect(loginResult.status).toBe(200);
    expect(loginResult.ok).toBe(true);
    expect(loginResult.endpointUsed).toBe(`${runtimeEnv.apiBase}/api/auth/login`);
    expect(loginResult.tokenStorage.exists).toBe(true);

    const meResponse = await page.request.get(`${runtimeEnv.apiBase}/api/auth/me`);
    expect(meResponse.status()).toBe(200);
    const mePayload = await meResponse.json();
    expect(mePayload?.ok).toBe(true);
    expect(mePayload?.data?.username).toBe(adminCredentials.username);
  });

  test("negative: wrong password shows proper error and is not 404", async ({
    page,
    runtimeEnv,
    adminCredentials,
  }) => {
    const loginUrl = `${runtimeEnv.baseUrl.replace(/\/+$/, "")}/#/login`;
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

    const hasLoginForm = await page
      .locator('input[autocomplete="username"]')
      .first()
      .isVisible()
      .catch(() => false);

    if (hasLoginForm) {
      await page.fill('input[autocomplete="username"]', adminCredentials.username);
      await page.fill('input[autocomplete="current-password"]', "wrong-password-e2e");

      const [loginResponse] = await Promise.all([
        page.waitForResponse((res) => {
          return res.url().includes("/api/auth/login") && res.request().method() === "POST";
        }),
        page.click("button.login-button"),
      ]);

      expect(loginResponse.status()).toBe(401);
      expect(loginResponse.status()).not.toBe(404);

      const loginPayload = await loginResponse.json();
      expect(loginPayload?.ok).toBe(false);
      expect(loginPayload?.error).toBeTruthy();
      await expect(page.locator(".status")).toContainText(/invalid|failed|ไม่สามารถ/i);
      return;
    }

    // Fallback approach for projects without login UI route:
    // call API login directly and assert status/body only.
    const response = await page.request.post(`${runtimeEnv.apiBase}/api/auth/login`, {
      data: {
        username: adminCredentials.username,
        password: "wrong-password-e2e",
      },
    });
    expect(response.status()).toBe(401);
    expect(response.status()).not.toBe(404);
    const payload = await response.json();
    expect(payload?.ok).toBe(false);
  });
});

