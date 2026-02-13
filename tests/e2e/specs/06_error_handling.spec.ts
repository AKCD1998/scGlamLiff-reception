import type { APIResponse, Browser, Page, TestInfo } from "@playwright/test";
import { test as adminTest, expect } from "../fixtures/admin";
import { test as staffTest } from "../fixtures/staff";
import { saveJsonSnapshot } from "../utils/artifacts";

type SweepSample = {
  step: string;
  statusCode: number;
  uiMessage: string;
  pass: boolean;
  details?: string;
};

type OperationSample = {
  step: string;
  request: {
    method: string;
    url: string;
    payloadSample: unknown;
  };
  response: {
    status: number;
    ok: boolean;
    payloadSample: unknown;
  } | null;
  note?: string;
  timestamp: string;
};

type CreatedUser = {
  id: string | null;
  username: string;
};

const REDACT_KEYS = new Set([
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

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (REDACT_KEYS.has(key.toLowerCase())) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redact(child);
      }
    }
    return output;
  }
  return value;
}

function normalizeText(input: string | null | undefined): string {
  return String(input || "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function pushOperation(
  log: OperationSample[],
  op: Omit<OperationSample, "timestamp">
): OperationSample {
  const entry: OperationSample = {
    ...op,
    timestamp: nowIso(),
  };
  log.push(entry);
  return entry;
}

async function parsePayloadSafe(response: { json(): Promise<unknown>; text(): Promise<string> }) {
  try {
    return redact(await response.json());
  } catch {
    const raw = await response.text().catch(() => "");
    return raw ? { raw: redact(raw) } : null;
  }
}

async function recordUiResponse(
  log: OperationSample[],
  step: string,
  response: {
    url(): string;
    request(): { method(): string; postData(): string | null };
    status(): number;
    ok(): boolean;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }
) {
  let requestPayload: unknown = null;
  const rawPost = response.request().postData();
  if (rawPost) {
    try {
      requestPayload = redact(JSON.parse(rawPost));
    } catch {
      requestPayload = { raw: redact(rawPost) };
    }
  }

  const responsePayload = await parsePayloadSafe(response);
  return pushOperation(log, {
    step,
    request: {
      method: response.request().method(),
      url: response.url(),
      payloadSample: requestPayload,
    },
    response: {
      status: response.status(),
      ok: response.ok(),
      payloadSample: responsePayload,
    },
  });
}

async function recordApiResponse(params: {
  log: OperationSample[];
  step: string;
  method: string;
  url: string;
  requestPayload: unknown;
  response: APIResponse;
  note?: string;
}) {
  const payload = await parsePayloadSafe(params.response);
  return pushOperation(params.log, {
    step: params.step,
    request: {
      method: params.method,
      url: params.url,
      payloadSample: redact(params.requestPayload),
    },
    response: {
      status: params.response.status(),
      ok: params.response.ok(),
      payloadSample: payload,
    },
    note: params.note,
  });
}

async function waitForEndpointResponse(
  page: Page,
  matcher: (url: URL, response: { request(): { method(): string } }) => boolean,
  timeoutMs = 20_000
) {
  return page.waitForResponse(
    (res) => {
      try {
        const parsed = new URL(res.url());
        return matcher(parsed, res);
      } catch {
        return false;
      }
    },
    { timeout: timeoutMs }
  );
}

async function openAdminUsersTab(page: Page, operationLog: OperationSample[]) {
  const adminTab = page.locator(".top-tab", { hasText: "จัดการผู้ใช้ (Admin)" }).first();
  await expect(adminTab).toBeVisible();

  const [listRes] = await Promise.all([
    waitForEndpointResponse(
      page,
      (url, response) =>
        response.request().method() === "GET" && url.pathname.endsWith("/api/admin/staff-users")
    ),
    adminTab.click(),
  ]);

  const op = await recordUiResponse(operationLog, "admin-users/open-list", listRes);
  if (op.response?.status !== 200) {
    throw new Error(`Admin users list failed. status=${op.response?.status}`);
  }
}

async function ensureUserRowVisible(
  page: Page,
  username: string,
  operationLog: OperationSample[]
) {
  let row = page.locator(".admin-users-table tbody tr", { hasText: username }).first();
  if ((await row.count()) > 0) {
    await expect(row).toBeVisible();
    return row;
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await openAdminUsersTab(page, operationLog);
  row = page.locator(".admin-users-table tbody tr", { hasText: username }).first();
  await expect(row).toBeVisible();
  return row;
}

async function createUserViaApi(params: {
  page: Page;
  apiBase: string;
  username: string;
  password?: string;
  operationLog: OperationSample[];
  step: string;
}): Promise<CreatedUser> {
  const url = `${params.apiBase}/api/admin/staff-users`;
  const payload = {
    username: params.username,
    password: params.password || "E2ePass_123",
    role_name: "staff",
    display_name: params.username,
    is_active: true,
  };
  const res = await params.page.request.post(url, { data: payload });
  const op = await recordApiResponse({
    log: params.operationLog,
    step: params.step,
    method: "POST",
    url,
    requestPayload: payload,
    response: res,
  });

  if (op.response?.status !== 201) {
    throw new Error(`Create user via API failed. status=${op.response?.status}`);
  }

  const body = (op.response?.payloadSample || {}) as Record<string, unknown>;
  const data = (body.data || {}) as Record<string, unknown>;
  return {
    id: normalizeText(data.id as string) || null,
    username: params.username,
  };
}

async function cleanupUser(
  page: Page,
  apiBase: string,
  user: CreatedUser | null,
  operationLog: OperationSample[],
  caseId: string
) {
  if (!user?.id) return;
  const url = `${apiBase}/api/admin/staff-users/${encodeURIComponent(user.id)}`;
  try {
    const res = await page.request.patch(url, {
      data: { is_active: false },
    });
    await recordApiResponse({
      log: operationLog,
      step: `${caseId}/cleanup-user`,
      method: "PATCH",
      url,
      requestPayload: { is_active: false },
      response: res,
      note: "Cleanup fallback (disable user)",
    });
  } catch (error) {
    pushOperation(operationLog, {
      step: `${caseId}/cleanup-user`,
      request: { method: "PATCH", url, payloadSample: { is_active: false } },
      response: null,
      note: `Cleanup threw: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function failWithSweepArtifact(params: {
  caseId: string;
  error: unknown;
  testInfo: TestInfo;
  operationLog: OperationSample[];
  sweep: SweepSample[];
}) {
  const { caseId, error, testInfo, operationLog, sweep } = params;
  const message = error instanceof Error ? error.message : String(error);
  const condensed = operationLog.slice(-20);

  let artifactPath = "";
  try {
    artifactPath = await saveJsonSnapshot(
      `${testInfo.titlePath.join(" > ")}--error-sweep-failure`,
      {
        caseId,
        message,
        sweep,
        operationLog: redact(condensed),
        capturedAt: nowIso(),
      }
    );
    await testInfo.attach(`${caseId}-error-sweep`, {
      body: Buffer.from(
        JSON.stringify(
          {
            sweep,
            operationLog: redact(condensed),
          },
          null,
          2
        ),
        "utf8"
      ),
      contentType: "application/json",
    });
  } catch {
    artifactPath = "";
  }

  throw new Error(
    `[${caseId}] ${message}` + (artifactPath ? ` | artifact=${artifactPath}` : "")
  );
}

async function run401NoTokenCheck(params: {
  browser: Browser;
  baseUrl: string;
  apiBase: string;
  operationLog: OperationSample[];
}) {
  const { browser, baseUrl, apiBase, operationLog } = params;
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/#/workbench`, { waitUntil: "domcontentloaded" });
    const url = `${apiBase}/api/admin/staff-users`;
    const res = await page.request.get(url);
    const op = await recordApiResponse({
      log: operationLog,
      step: "401/no-token-protected-call",
      method: "GET",
      url,
      requestPayload: null,
      response: res,
    });

    expect(op.response?.status).toBe(401);
    const payload = (op.response?.payloadSample || {}) as Record<string, unknown>;
    expect(String(payload.error || "")).toMatch(/unauthorized/i);

    const loginPageVisible = await page
      .locator(".login-page")
      .first()
      .isVisible()
      .catch(() => false);
    const workbenchVisible = await page
      .locator(".workbench-page")
      .first()
      .isVisible()
      .catch(() => false);
    expect(loginPageVisible || workbenchVisible).toBe(true);
  } finally {
    await context.close();
  }
}

adminTest.describe("06 Error Handling Sweep", () => {
  adminTest("400 invalid payload (missing username) + disabled while loading + recovery", async (
    { adminPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    const sweep: SweepSample[] = [];
    let recoveredUser: CreatedUser | null = null;

    try {
      await openAdminUsersTab(adminPage, operationLog);

      const username = `e2e_err_400_${Date.now()}`;
      const submitBtn = adminPage.locator('.admin-users-form button[type="submit"]').first();

      await adminPage.fill("#admin-users-username", username);
      await adminPage.fill("#admin-users-password", "E2ePass_123");
      await adminPage.fill("#admin-users-display-name", "E2E Error 400");
      await adminPage.selectOption("#admin-users-role", "staff");

      await adminPage.route(
        "**/api/admin/staff-users",
        async (route) => {
          if (route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(route.request().postData() || "{}");
          } catch {
            payload = {};
          }
          delete payload.username;
          const headers = { ...route.request().headers() };
          delete headers["content-length"];
          delete headers["Content-Length"];
          await adminPage.waitForTimeout(700);
          await route.continue({
            headers,
            postData: JSON.stringify(payload),
          });
        },
        { times: 1 }
      );

      const createResponsePromise = waitForEndpointResponse(
        adminPage,
        (url, response) =>
          response.request().method() === "POST" && url.pathname.endsWith("/api/admin/staff-users")
      );

      await submitBtn.click();
      await expect(submitBtn).toBeDisabled();
      await expect(submitBtn).toContainText("กำลังบันทึก...");
      const createRes = await createResponsePromise;
      const createOp = await recordUiResponse(operationLog, "400/create-invalid-missing-username", createRes);
      expect(createOp.response?.status).toBe(400);

      const errorMessage = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );
      expect(errorMessage).toMatch(/username is required|ข้อมูลไม่ถูกต้อง/i);
      sweep.push({
        step: "400 invalid payload (missing username)",
        statusCode: 400,
        uiMessage: errorMessage,
        pass: true,
      });

      await expect(adminPage.locator(".admin-users-page")).toBeVisible();

      const [recoverPostRes] = await Promise.all([
        waitForEndpointResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "POST" && url.pathname.endsWith("/api/admin/staff-users")
        ),
        submitBtn.click(),
      ]);
      const recoverPostOp = await recordUiResponse(operationLog, "400/recover-create-valid", recoverPostRes);
      expect(recoverPostOp.response?.status).toBe(201);

      const recoverBody = (recoverPostOp.response?.payloadSample || {}) as Record<string, unknown>;
      const recoverData = (recoverBody.data || {}) as Record<string, unknown>;
      recoveredUser = {
        id: normalizeText(recoverData.id as string) || null,
        username,
      };

      const recoverMessage = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );
      expect(recoverMessage).toContain("สร้างผู้ใช้สำเร็จ");
      await ensureUserRowVisible(adminPage, username, operationLog);
      sweep.push({
        step: "recover after 400",
        statusCode: 201,
        uiMessage: recoverMessage,
        pass: true,
      });
    } catch (error) {
      await failWithSweepArtifact({
        caseId: "400",
        error,
        testInfo,
        operationLog,
        sweep,
      });
    } finally {
      await cleanupUser(adminPage, runtimeEnv.apiBase, recoveredUser, operationLog, "400");
    }
  });

  adminTest("401 protected endpoint without token (new context, no storageState)", async (
    { browser, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    const sweep: SweepSample[] = [];
    try {
      await run401NoTokenCheck({
        browser,
        baseUrl: runtimeEnv.baseUrl,
        apiBase: runtimeEnv.apiBase,
        operationLog,
      });
      sweep.push({
        step: "401 no token call /api/admin/staff-users",
        statusCode: 401,
        uiMessage: "(no dedicated Thai message in this context)",
        pass: true,
      });
    } catch (error) {
      await failWithSweepArtifact({
        caseId: "401",
        error,
        testInfo,
        operationLog,
        sweep,
      });
    }
  });

  adminTest("404 patch non-existent id via row action + recover", async (
    { adminPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    const sweep: SweepSample[] = [];
    let createdUser: CreatedUser | null = null;

    try {
      const username = `e2e_err_404_${Date.now()}`;
      createdUser = await createUserViaApi({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        username,
        operationLog,
        step: "404/setup-create-user",
      });

      await openAdminUsersTab(adminPage, operationLog);
      const row = await ensureUserRowVisible(adminPage, username, operationLog);
      const checkbox = row.locator('input[type="checkbox"]').first();
      const resetBtn = row.locator("button", { hasText: "Reset Password" }).first();

      await adminPage.route(
        "**/api/admin/staff-users/**",
        async (route) => {
          if (route.request().method() !== "PATCH") {
            await route.continue();
            return;
          }
          await adminPage.waitForTimeout(650);
          await route.fulfill({
            status: 404,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: "User not found" }),
          });
        },
        { times: 1 }
      );

      const patchResponsePromise = waitForEndpointResponse(
        adminPage,
        (url, response) =>
          response.request().method() === "PATCH" && url.pathname.includes("/api/admin/staff-users/")
      );

      await checkbox.click();
      await expect(checkbox).toBeDisabled();
      await expect(resetBtn).toBeDisabled();
      const patchRes = await patchResponsePromise;
      const patchOp = await recordUiResponse(operationLog, "404/row-toggle-not-found", patchRes);
      expect(patchOp.response?.status).toBe(404);

      await expect(checkbox).not.toBeDisabled();
      await expect(resetBtn).not.toBeDisabled();

      const errorMessage = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );
      expect(errorMessage).toMatch(/user not found|ไม่พบผู้ใช้/i);
      sweep.push({
        step: "404 patch non-existent id",
        statusCode: 404,
        uiMessage: errorMessage,
        pass: true,
      });

      const [recoverPatchRes] = await Promise.all([
        waitForEndpointResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "PATCH" && url.pathname.includes("/api/admin/staff-users/")
        ),
        checkbox.click(),
      ]);
      const recoverOp = await recordUiResponse(operationLog, "404/recover-toggle-valid", recoverPatchRes);
      expect(recoverOp.response?.status).toBe(200);
      const recoverMessage = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );
      expect(recoverMessage).toContain("อัปเดตสถานะผู้ใช้สำเร็จ");
      sweep.push({
        step: "recover after 404",
        statusCode: 200,
        uiMessage: recoverMessage,
        pass: true,
      });

      await expect(adminPage.locator(".admin-users-page")).toBeVisible();
    } catch (error) {
      await failWithSweepArtifact({
        caseId: "404",
        error,
        testInfo,
        operationLog,
        sweep,
      });
    } finally {
      await cleanupUser(adminPage, runtimeEnv.apiBase, createdUser, operationLog, "404");
    }
  });

  adminTest("409 duplicate username + recovery", async ({ adminPage, runtimeEnv }, testInfo) => {
    const operationLog: OperationSample[] = [];
    const sweep: SweepSample[] = [];
    let seedUser: CreatedUser | null = null;
    let recoverUser: CreatedUser | null = null;

    try {
      const duplicateUsername = `e2e_err_409_${Date.now()}`;
      seedUser = await createUserViaApi({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        username: duplicateUsername,
        operationLog,
        step: "409/setup-seed-user",
      });

      await openAdminUsersTab(adminPage, operationLog);

      await adminPage.fill("#admin-users-username", duplicateUsername);
      await adminPage.fill("#admin-users-password", "E2ePass_123");
      await adminPage.fill("#admin-users-display-name", "Duplicate User");
      await adminPage.selectOption("#admin-users-role", "staff");
      const submitBtn = adminPage.locator('.admin-users-form button[type="submit"]').first();

      const [duplicateRes] = await Promise.all([
        waitForEndpointResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "POST" && url.pathname.endsWith("/api/admin/staff-users")
        ),
        submitBtn.click(),
      ]);
      const duplicateOp = await recordUiResponse(operationLog, "409/duplicate-create", duplicateRes);
      expect(duplicateOp.response?.status).toBe(409);
      const duplicateMessage = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );
      expect(duplicateMessage).toMatch(/exists|มีอยู่แล้ว/i);
      sweep.push({
        step: "409 duplicate username",
        statusCode: 409,
        uiMessage: duplicateMessage,
        pass: true,
      });

      const recoverUsername = `${duplicateUsername}_ok`;
      await adminPage.fill("#admin-users-username", recoverUsername);
      await adminPage.fill("#admin-users-password", "E2ePass_123");
      await adminPage.fill("#admin-users-display-name", "Recovered User");
      await adminPage.selectOption("#admin-users-role", "staff");

      const [recoverRes] = await Promise.all([
        waitForEndpointResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "POST" && url.pathname.endsWith("/api/admin/staff-users")
        ),
        submitBtn.click(),
      ]);
      const recoverOp = await recordUiResponse(operationLog, "409/recover-create-unique", recoverRes);
      expect(recoverOp.response?.status).toBe(201);

      const recoverBody = (recoverOp.response?.payloadSample || {}) as Record<string, unknown>;
      const recoverData = (recoverBody.data || {}) as Record<string, unknown>;
      recoverUser = {
        id: normalizeText(recoverData.id as string) || null,
        username: recoverUsername,
      };

      const recoverMessage = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );
      expect(recoverMessage).toContain("สร้างผู้ใช้สำเร็จ");
      sweep.push({
        step: "recover after 409",
        statusCode: 201,
        uiMessage: recoverMessage,
        pass: true,
      });
      await expect(adminPage.locator(".admin-users-page")).toBeVisible();
    } catch (error) {
      await failWithSweepArtifact({
        caseId: "409",
        error,
        testInfo,
        operationLog,
        sweep,
      });
    } finally {
      await cleanupUser(adminPage, runtimeEnv.apiBase, recoverUser, operationLog, "409");
      await cleanupUser(adminPage, runtimeEnv.apiBase, seedUser, operationLog, "409");
    }
  });

  adminTest("500 simulated throw (safe toggle only) or mark not supported", async (
    { adminPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    const sweep: SweepSample[] = [];

    const safeTogglePath = normalizeText(process.env.E2E_SAFE_500_TOGGLE_PATH);
    if (!safeTogglePath) {
      const artifact = await saveJsonSnapshot(
        `${testInfo.titlePath.join(" > ")}--500-not-supported`,
        {
          status: 500,
          supported: false,
          reason: "No safe dev-only 500 toggle configured",
          recommendation:
            "Set E2E_SAFE_500_TOGGLE_PATH to a dedicated non-production endpoint before enabling this test.",
          capturedAt: nowIso(),
        }
      );
      testInfo.annotations.push({
        type: "not-supported",
        description: `500 simulation not supported: ${artifact}`,
      });
      sweep.push({
        step: "500 dev-only simulated throw",
        statusCode: 500,
        uiMessage: "not supported",
        pass: true,
        details: "No safe toggle found in code/env",
      });
      return;
    }

    try {
      const url = safeTogglePath.startsWith("http")
        ? safeTogglePath
        : `${runtimeEnv.apiBase}${safeTogglePath.startsWith("/") ? safeTogglePath : `/${safeTogglePath}`}`;
      const payload = { trigger: "e2e-500" };
      const res = await adminPage.request.post(url, { data: payload });
      const op = await recordApiResponse({
        log: operationLog,
        step: "500/safe-toggle-call",
        method: "POST",
        url,
        requestPayload: payload,
        response: res,
      });

      if (op.response?.status === 404 || op.response?.status === 405) {
        const artifact = await saveJsonSnapshot(
          `${testInfo.titlePath.join(" > ")}--500-toggle-unavailable`,
          {
            status: op.response?.status,
            supported: false,
            reason: "Configured safe toggle endpoint does not exist or method not allowed",
            url,
            payload: op.response?.payloadSample || null,
            capturedAt: nowIso(),
          }
        );
        testInfo.annotations.push({
          type: "not-supported",
          description: `500 toggle unavailable: ${artifact}`,
        });
        return;
      }

      expect(op.response?.status).toBe(500);
      sweep.push({
        step: "500 dev-only simulated throw",
        statusCode: 500,
        uiMessage: "(API-level toggle)",
        pass: true,
      });
    } catch (error) {
      await failWithSweepArtifact({
        caseId: "500",
        error,
        testInfo,
        operationLog,
        sweep,
      });
    }
  });
});

staffTest.describe("06 Error Handling Sweep (staff role)", () => {
  staffTest("403 staff tries admin page (endpoint forbidden, UI still stable)", async (
    { staffPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    const sweep: SweepSample[] = [];
    try {
      const adminTabCount = await staffPage
        .locator(".top-tab", { hasText: "จัดการผู้ใช้ (Admin)" })
        .count();
      expect(adminTabCount).toBe(0);

      const url = `${runtimeEnv.apiBase}/api/admin/staff-users`;
      const res = await staffPage.request.get(url);
      const op = await recordApiResponse({
        log: operationLog,
        step: "403/staff-call-admin-endpoint",
        method: "GET",
        url,
        requestPayload: null,
        response: res,
      });
      expect(op.response?.status).toBe(403);
      const payload = (op.response?.payloadSample || {}) as Record<string, unknown>;
      expect(String(payload.error || "")).toMatch(/forbidden/i);

      await expect(staffPage.locator(".workbench-page")).toBeVisible();
      await expect(staffPage.locator(".top-tab", { hasText: "ระบบการจองคิว" }).first()).toBeVisible();
      sweep.push({
        step: "403 staff tries admin page",
        statusCode: 403,
        uiMessage: "(no dedicated Thai message; admin tab hidden for staff)",
        pass: true,
      });
    } catch (error) {
      await failWithSweepArtifact({
        caseId: "403",
        error,
        testInfo,
        operationLog,
        sweep,
      });
    }
  });
});
