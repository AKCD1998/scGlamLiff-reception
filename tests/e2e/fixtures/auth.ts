import type {
  APIRequestContext,
  APIResponse,
  Page,
  Response,
} from "@playwright/test";
import { test as base, expect } from "./base";
import { loadRuntimeEnv, type RuntimeEnv, type UserCredentials } from "./env";

type AuthFixtures = {
  runtimeEnv: RuntimeEnv;
  adminCredentials: UserCredentials;
  staffCredentials: UserCredentials;
};

export async function loginViaUi(
  page: Page,
  baseUrl: string,
  credentials: UserCredentials
): Promise<Response> {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.fill('input[autocomplete="username"]', credentials.username);
  await page.fill('input[autocomplete="current-password"]', credentials.password);

  const [loginResponse] = await Promise.all([
    page.waitForResponse((res) => {
      return res.url().includes("/api/auth/login") && res.request().method() === "POST";
    }),
    page.click("button.login-button"),
  ]);

  return loginResponse;
}

export async function loginViaApi(
  request: APIRequestContext,
  apiBase: string,
  credentials: UserCredentials
): Promise<APIResponse> {
  return request.post(`${apiBase}/api/auth/login`, {
    data: {
      username: credentials.username,
      password: credentials.password,
    },
  });
}

export const test = base.extend<AuthFixtures>({
  runtimeEnv: async ({}, use) => {
    await use(loadRuntimeEnv());
  },

  adminCredentials: async ({ runtimeEnv }, use) => {
    await use(runtimeEnv.admin);
  },

  staffCredentials: async ({ runtimeEnv }, use) => {
    await use(runtimeEnv.staff);
  },
});

export { expect };

