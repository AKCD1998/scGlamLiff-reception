import { test, expect } from "../fixtures/auth";
import { loginViaUi } from "../fixtures/auth";

test.describe("Auth E2E", () => {
  test("admin can login and receives cookie-based session", async ({
    page,
    context,
    runtimeEnv,
    adminCredentials,
  }) => {
    const loginResponse = await loginViaUi(page, runtimeEnv.baseUrl, adminCredentials);
    expect(loginResponse.status()).toBe(200);

    const payload = await loginResponse.json();
    expect(payload?.ok).toBe(true);
    expect(payload?.data?.username).toBe(adminCredentials.username);

    await expect(page).toHaveURL(/workbench/);

    const cookies = await context.cookies(runtimeEnv.apiBase);
    const tokenCookie = cookies.find((cookie) => cookie.name === "token");
    expect(tokenCookie).toBeTruthy();
    expect(tokenCookie?.httpOnly).toBeTruthy();
  });

  test("wrong password returns 401 (not 404) and shows error on UI", async ({
    page,
    runtimeEnv,
    adminCredentials,
  }) => {
    await page.goto(runtimeEnv.baseUrl, { waitUntil: "domcontentloaded" });
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

    const payload = await loginResponse.json();
    expect(payload?.ok).toBe(false);
    expect(payload?.error).toBe("Invalid credentials");

    await expect(page.locator(".status")).toContainText("Invalid credentials");
    await expect(page).toHaveURL(/login/);
  });
});

