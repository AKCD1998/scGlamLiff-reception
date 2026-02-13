import fs from "node:fs/promises";
import path from "node:path";
import type { APIResponse, Page } from "@playwright/test";
import { loadRuntimeEnv, type RuntimeEnv, type UserCredentials } from "../fixtures/env";

export const ADMIN_STORAGE_STATE_PATH = path.join(
  process.cwd(),
  "tests",
  "e2e",
  "fixtures",
  "adminStorageState.json"
);

export const STAFF_STORAGE_STATE_PATH = path.join(
  process.cwd(),
  "tests",
  "e2e",
  "fixtures",
  "staffStorageState.json"
);

type TokenStorageLocation = "cookie" | "localStorage" | "sessionStorage" | "unknown";

export interface TokenStorageDetection {
  exists: boolean;
  location: TokenStorageLocation;
  key: string | null;
}

export interface RedactedLoginSnapshot {
  endpointUsed: string;
  methodUsed: "ui" | "api-fallback";
  status: number;
  ok: boolean;
  responseBody: unknown;
  tokenStorage: TokenStorageDetection;
  capturedAt: string;
}

export interface LoginResult extends RedactedLoginSnapshot {}

const LAST_LOGIN_SNAPSHOT = new WeakMap<Page, RedactedLoginSnapshot>();

const SENSITIVE_KEYS = new Set([
  "password",
  "password_hash",
  "token",
  "jwt",
  "authorization",
  "cookie",
  "set-cookie",
  "secret",
  "access_token",
  "refresh_token",
]);

function redactSecrets(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item));
  }

  if (input && typeof input === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redactSecrets(value);
      }
    }
    return output;
  }

  return input;
}

async function safeJson(response: APIResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      const text = await response.text();
      return text ? { raw: text.slice(0, 10_000) } : null;
    } catch {
      return null;
    }
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl || "").replace(/\/+$/, "");
}

async function isLoginFormVisible(page: Page): Promise<boolean> {
  const username = page.locator('input[autocomplete="username"]').first();
  const password = page.locator('input[autocomplete="current-password"]').first();
  const submit = page.locator("button.login-button").first();
  try {
    await username.waitFor({ state: "visible", timeout: 2_500 });
    return (await password.isVisible()) && (await submit.isVisible());
  } catch {
    return false;
  }
}

async function openLoginRoute(page: Page, baseUrl: string): Promise<boolean> {
  const normalized = normalizeBaseUrl(baseUrl);
  const loginCandidates = [`${normalized}/#/login`, normalized];

  for (const target of loginCandidates) {
    try {
      await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      continue;
    }
    if (await isLoginFormVisible(page)) return true;
  }

  return false;
}

export async function detectTokenStorage(
  page: Page,
  apiBase: string
): Promise<TokenStorageDetection> {
  const cookies = await page.context().cookies(apiBase);
  const tokenCookie = cookies.find((cookie) => /token|jwt|session/i.test(cookie.name));
  if (tokenCookie) {
    return {
      exists: true,
      location: "cookie",
      key: tokenCookie.name,
    };
  }

  const localToken = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key);
      if (value && /token|jwt|session/i.test(key)) {
        return { key, value: "[REDACTED]" };
      }
    }
    return null;
  });
  if (localToken?.key) {
    return {
      exists: true,
      location: "localStorage",
      key: localToken.key,
    };
  }

  const sessionToken = await page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      const value = sessionStorage.getItem(key);
      if (value && /token|jwt|session/i.test(key)) {
        return { key, value: "[REDACTED]" };
      }
    }
    return null;
  });
  if (sessionToken?.key) {
    return {
      exists: true,
      location: "sessionStorage",
      key: sessionToken.key,
    };
  }

  return {
    exists: false,
    location: "unknown",
    key: null,
  };
}

async function performLogin(params: {
  page: Page;
  runtimeEnv: RuntimeEnv;
  credentials: UserCredentials;
}): Promise<LoginResult> {
  const { page, runtimeEnv, credentials } = params;
  const hasLoginForm = await openLoginRoute(page, runtimeEnv.baseUrl);
  const endpointUsed = `${runtimeEnv.apiBase}/api/auth/login`;

  let methodUsed: "ui" | "api-fallback" = "ui";
  let response: APIResponse;

  if (hasLoginForm) {
    await page.fill('input[autocomplete="username"]', credentials.username);
    await page.fill('input[autocomplete="current-password"]', credentials.password);
    [response] = await Promise.all([
      page.waitForResponse((res) => {
        return res.url().includes("/api/auth/login") && res.request().method() === "POST";
      }),
      page.click("button.login-button"),
    ]);
  } else {
    // Fallback path if login UI route is missing.
    // We call backend login endpoint directly and rely on browser-context cookie jar.
    response = await page.request.post(endpointUsed, {
      data: {
        username: credentials.username,
        password: credentials.password,
      },
    });
    methodUsed = "api-fallback";

    // If backend returns token in JSON instead of cookie (other repo variants),
    // we attempt localStorage injection so tests can continue.
    const responseBody = await safeJson(response);
    if (response.ok()) {
      await page.goto(`${normalizeBaseUrl(runtimeEnv.baseUrl)}/#/workbench`, {
        waitUntil: "domcontentloaded",
      });

      const detected = await detectTokenStorage(page, runtimeEnv.apiBase);
      if (!detected.exists) {
        const token = (responseBody as Record<string, unknown> | null)?.token;
        if (typeof token === "string" && token) {
          await page.evaluate((value) => {
            localStorage.setItem("token", value);
          }, token);
        }
      }
    }
  }

  const responseBody = await safeJson(response);
  if (!response.ok()) {
    const redacted = redactSecrets(responseBody);
    const failureSnapshot: RedactedLoginSnapshot = {
      endpointUsed,
      methodUsed,
      status: response.status(),
      ok: false,
      responseBody: redacted,
      tokenStorage: { exists: false, location: "unknown", key: null },
      capturedAt: new Date().toISOString(),
    };
    LAST_LOGIN_SNAPSHOT.set(page, failureSnapshot);
    throw new Error(`Login failed: status=${response.status()} body=${JSON.stringify(redacted)}`);
  }

  const tokenStorage = await detectTokenStorage(page, runtimeEnv.apiBase);
  if (!tokenStorage.exists) {
    throw new Error("Login succeeded but token/session storage was not detected.");
  }

  const snapshot: RedactedLoginSnapshot = {
    endpointUsed,
    methodUsed,
    status: response.status(),
    ok: response.ok(),
    responseBody: redactSecrets(responseBody),
    tokenStorage,
    capturedAt: new Date().toISOString(),
  };
  LAST_LOGIN_SNAPSHOT.set(page, snapshot);
  return snapshot;
}

export async function loginAsAdmin(
  page: Page,
  runtimeEnv: RuntimeEnv = loadRuntimeEnv()
): Promise<LoginResult> {
  return performLogin({
    page,
    runtimeEnv,
    credentials: runtimeEnv.admin,
  });
}

export async function loginAsStaff(
  page: Page,
  runtimeEnv: RuntimeEnv = loadRuntimeEnv()
): Promise<LoginResult> {
  return performLogin({
    page,
    runtimeEnv,
    credentials: runtimeEnv.staff,
  });
}

export function getLastLoginSnapshot(page: Page): RedactedLoginSnapshot | null {
  return LAST_LOGIN_SNAPSHOT.get(page) || null;
}

export async function writeStorageState(
  page: Page,
  targetPath: string
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await page.context().storageState({ path: targetPath });
}

