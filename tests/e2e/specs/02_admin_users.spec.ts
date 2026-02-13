import type { APIResponse, Page, TestInfo } from "@playwright/test";
import { test, expect } from "../fixtures/admin";

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
  password: string;
};

const PASSWORD_KEYS = new Set([
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
      if (PASSWORD_KEYS.has(key.toLowerCase())) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = redact(child);
      }
    }
    return output;
  }

  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}...(truncated)`;
  }

  return value;
}

function normalizeText(input: string | null | undefined): string {
  return String(input || "").trim();
}

async function parseResponsePayload(response: APIResponse): Promise<unknown> {
  const contentType = (response.headers()["content-type"] || "").toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      return redact(await response.json());
    } catch {
      return null;
    }
  }
  try {
    const text = await response.text();
    return text ? { raw: redact(text) } : null;
  } catch {
    return null;
  }
}

function parseRequestPayloadFromResponse(response: { request(): { postData(): string | null } }) {
  try {
    const raw = response.request().postData();
    if (!raw) return null;
    try {
      return redact(JSON.parse(raw));
    } catch {
      return { raw: redact(raw) };
    }
  } catch {
    return null;
  }
}

function pushOperation(
  log: OperationSample[],
  operation: Omit<OperationSample, "timestamp">
): OperationSample {
  const entry: OperationSample = {
    ...operation,
    timestamp: new Date().toISOString(),
  };
  log.push(entry);
  return entry;
}

async function captureUiResponseOperation(
  log: OperationSample[],
  step: string,
  response: {
    url(): string;
    request(): { method(): string; postData(): string | null };
    status(): number;
    ok(): boolean;
    json(): Promise<unknown>;
    text(): Promise<string>;
    headerValue(name: string): Promise<string | null>;
  }
): Promise<OperationSample> {
  let payloadSample: unknown = null;
  try {
    const contentType = (await response.headerValue("content-type")) || "";
    if (contentType.toLowerCase().includes("application/json")) {
      payloadSample = redact(await response.json());
    } else {
      const text = await response.text();
      payloadSample = text ? { raw: redact(text) } : null;
    }
  } catch {
    payloadSample = null;
  }

  return pushOperation(log, {
    step,
    request: {
      method: response.request().method(),
      url: response.url(),
      payloadSample: parseRequestPayloadFromResponse(response),
    },
    response: {
      status: response.status(),
      ok: response.ok(),
      payloadSample,
    },
  });
}

async function captureApiResponseOperation(params: {
  log: OperationSample[];
  step: string;
  method: string;
  url: string;
  requestPayload: unknown;
  response: APIResponse;
  note?: string;
}): Promise<OperationSample> {
  const payloadSample = await parseResponsePayload(params.response);
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
      payloadSample,
    },
    note: params.note,
  });
}

async function enrichFailureAndThrow(params: {
  testInfo: TestInfo;
  caseId: string;
  error: unknown;
  operationLog: OperationSample[];
}): Promise<never> {
  const { testInfo, caseId, error, operationLog } = params;
  const errorMessage = error instanceof Error ? error.message : String(error);

  const condensed = operationLog.slice(-12);
  await testInfo.attach(`${caseId}-operation-log`, {
    body: Buffer.from(JSON.stringify(redact(condensed), null, 2), "utf8"),
    contentType: "application/json",
  });

  throw new Error(
    `[${caseId}] ${errorMessage}\n` +
      `request/response sample (redacted): ${JSON.stringify(redact(condensed))}`
  );
}

function createE2eUserPayload(suffix: string) {
  const username = `e2e_admin_users_${suffix}`;
  const password = `E2ePass_${suffix}`;
  return {
    username,
    password,
    display_name: `E2E ${suffix}`,
    role_name: "staff",
    is_active: true,
  };
}

async function openAdminUsersTab(
  page: Page,
  operationLog: OperationSample[],
  stepLabel = "open-admin-users-tab/list"
): Promise<{
  status: number;
  body: unknown;
}> {
  const adminTab = page.locator(".top-tab", { hasText: "จัดการผู้ใช้ (Admin)" }).first();
  await adminTab.waitFor({ state: "visible" });

  const [listResponse] = await Promise.all([
    page.waitForResponse((res) => {
      return (
        res.url().includes("/api/admin/staff-users") && res.request().method() === "GET"
      );
    }),
    adminTab.click(),
  ]);

  const op = await captureUiResponseOperation(operationLog, stepLabel, listResponse);
  return {
    status: op.response?.status || 0,
    body: op.response?.payloadSample || null,
  };
}

async function ensureUserRowVisible(params: {
  page: Page;
  username: string;
  operationLog: OperationSample[];
}): Promise<void> {
  const { page, username, operationLog } = params;
  let row = page.locator(".admin-users-table tbody tr", { hasText: username }).first();
  if ((await row.count()) > 0) {
    await expect(row).toBeVisible();
    return;
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await openAdminUsersTab(page, operationLog, "refresh-admin-users-tab/list");
  row = page.locator(".admin-users-table tbody tr", { hasText: username }).first();
  await expect(row).toBeVisible();
}

async function createUserViaApi(params: {
  page: Page;
  apiBase: string;
  payload: ReturnType<typeof createE2eUserPayload>;
  operationLog: OperationSample[];
  step: string;
}): Promise<CreatedUser> {
  const url = `${params.apiBase}/api/admin/staff-users`;
  const response = await params.page.request.post(url, {
    data: params.payload,
  });
  const op = await captureApiResponseOperation({
    log: params.operationLog,
    step: params.step,
    method: "POST",
    url,
    requestPayload: params.payload,
    response,
  });

  const body = (op.response?.payloadSample || {}) as Record<string, unknown>;
  const data = (body.data || {}) as Record<string, unknown>;
  return {
    id: typeof data.id === "string" ? data.id : null,
    username: params.payload.username,
    password: params.payload.password,
  };
}

async function cleanupCreatedUser(params: {
  page: Page;
  apiBase: string;
  createdUser: CreatedUser | null;
  operationLog: OperationSample[];
  testInfo: TestInfo;
  caseId: string;
}): Promise<void> {
  const { page, apiBase, createdUser, operationLog, testInfo, caseId } = params;
  if (!createdUser?.id) return;

  const deleteUrl = `${apiBase}/api/admin/staff-users/${encodeURIComponent(createdUser.id)}`;

  try {
    const deleteResponse = await page.request.delete(deleteUrl);
    await captureApiResponseOperation({
      log: operationLog,
      step: `${caseId}/cleanup-delete-attempt`,
      method: "DELETE",
      url: deleteUrl,
      requestPayload: null,
      response: deleteResponse,
      note: "Delete attempted; fallback to deactivate if unsupported.",
    });

    if (deleteResponse.ok()) {
      testInfo.annotations.push({
        type: "cleanup",
        description: `Deleted test user: ${createdUser.username}`,
      });
      return;
    }
  } catch (error) {
    pushOperation(operationLog, {
      step: `${caseId}/cleanup-delete-attempt`,
      request: { method: "DELETE", url: deleteUrl, payloadSample: null },
      response: null,
      note: `Delete threw: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const patchUrl = deleteUrl;
  const patchPayload = { is_active: false };
  try {
    const patchResponse = await page.request.patch(patchUrl, {
      data: patchPayload,
    });
    await captureApiResponseOperation({
      log: operationLog,
      step: `${caseId}/cleanup-deactivate-fallback`,
      method: "PATCH",
      url: patchUrl,
      requestPayload: patchPayload,
      response: patchResponse,
      note: `Delete unsupported. Kept e2e_ prefix user and deactivated.`,
    });

    testInfo.annotations.push({
      type: "cleanup",
      description:
        patchResponse.ok()
          ? `Delete unsupported; deactivated user with e2e_ prefix: ${createdUser.username}`
          : `Cleanup fallback failed for user: ${createdUser.username}`,
    });
  } catch (error) {
    pushOperation(operationLog, {
      step: `${caseId}/cleanup-deactivate-fallback`,
      request: { method: "PATCH", url: patchUrl, payloadSample: patchPayload },
      response: null,
      note: `Fallback deactivate threw: ${error instanceof Error ? error.message : String(error)}`,
    });
    testInfo.annotations.push({
      type: "cleanup",
      description: `Cleanup failed for e2e user: ${createdUser.username}`,
    });
  }
}

test.describe("02 AdminUsersPage Suite", () => {
  test("A) list loads + empty state safe", async ({ adminPage }, testInfo) => {
    const operationLog: OperationSample[] = [];
    try {
      const listResult = await openAdminUsersTab(adminPage, operationLog);
      const payload = (listResult.body || {}) as Record<string, unknown>;
      const rows = Array.isArray(payload.rows) ? payload.rows : [];

      if (listResult.status !== 200) {
        throw new Error(`Expected list status 200, got ${listResult.status}`);
      }
      if (payload.ok !== true) {
        throw new Error("Expected list payload.ok === true");
      }

      if (rows.length === 0) {
        await expect(adminPage.locator(".admin-users-table tbody")).toContainText("ไม่มีข้อมูล");
        return;
      }

      const uiRows = await adminPage.locator(".admin-users-table tbody tr").count();
      if (uiRows < 1) {
        throw new Error("Expected at least one table row when backend rows are non-empty.");
      }
    } catch (error) {
      await enrichFailureAndThrow({
        testInfo,
        caseId: "A",
        error,
        operationLog,
      });
    }
  });

  test("B) create user success", async ({ adminPage, runtimeEnv }, testInfo) => {
    const operationLog: OperationSample[] = [];
    let createdUser: CreatedUser | null = null;

    try {
      await openAdminUsersTab(adminPage, operationLog);

      const suffix = `${Date.now()}_b`;
      const payload = createE2eUserPayload(suffix);

      await adminPage.fill("#admin-users-username", payload.username);
      await adminPage.fill("#admin-users-password", payload.password);
      await adminPage.fill("#admin-users-display-name", payload.display_name);
      await adminPage.selectOption("#admin-users-role", payload.role_name);

      const [createResponse, refreshResponse] = await Promise.all([
        adminPage.waitForResponse((res) => {
          return (
            res.url().includes("/api/admin/staff-users") && res.request().method() === "POST"
          );
        }),
        adminPage.waitForResponse((res) => {
          return (
            res.url().includes("/api/admin/staff-users") && res.request().method() === "GET"
          );
        }),
        adminPage.click("button.admin-users-btn.admin-users-btn--brown"),
      ]);

      const createOp = await captureUiResponseOperation(
        operationLog,
        "B/create-user-post",
        createResponse
      );
      const refreshOp = await captureUiResponseOperation(
        operationLog,
        "B/create-user-refresh-list",
        refreshResponse
      );

      const createBody = (createOp.response?.payloadSample || {}) as Record<string, unknown>;
      const createData = (createBody.data || {}) as Record<string, unknown>;
      createdUser = {
        id: typeof createData.id === "string" ? createData.id : null,
        username: payload.username,
        password: payload.password,
      };

      if (createOp.response?.status !== 201) {
        throw new Error(`Expected create status 201, got ${createOp.response?.status}`);
      }
      if (refreshOp.response?.status !== 200) {
        throw new Error(`Expected refresh status 200, got ${refreshOp.response?.status}`);
      }

      const message = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );
      if (!message.includes("สร้างผู้ใช้สำเร็จ")) {
        throw new Error(`Expected success message, got "${message}"`);
      }

      const createdRow = adminPage
        .locator(".admin-users-table tbody tr", { hasText: payload.username })
        .first();
      await expect(createdRow).toBeVisible();

      const listUrl = `${runtimeEnv.apiBase}/api/admin/staff-users`;
      const persistedRes = await adminPage.request.get(listUrl);
      const persistedOp = await captureApiResponseOperation({
        log: operationLog,
        step: "B/persisted-list-check",
        method: "GET",
        url: listUrl,
        requestPayload: null,
        response: persistedRes,
      });

      const persistedBody = (persistedOp.response?.payloadSample || {}) as Record<
        string,
        unknown
      >;
      const persistedRows = Array.isArray(persistedBody.rows) ? persistedBody.rows : [];
      const found = persistedRows.some((row) => {
        const candidate = row as Record<string, unknown>;
        return candidate.username === payload.username;
      });
      if (!found) {
        throw new Error(`Expected created user "${payload.username}" in backend list.`);
      }
    } catch (error) {
      await enrichFailureAndThrow({
        testInfo,
        caseId: "B",
        error,
        operationLog,
      });
    } finally {
      await cleanupCreatedUser({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        createdUser,
        operationLog,
        testInfo,
        caseId: "B",
      });
    }
  });

  test("C) duplicate username + short password validation", async (
    { adminPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    let createdUser: CreatedUser | null = null;

    try {
      await openAdminUsersTab(adminPage, operationLog);

      const suffix = `${Date.now()}_c`;
      const payload = createE2eUserPayload(suffix);
      createdUser = await createUserViaApi({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        payload,
        operationLog,
        step: "C/setup-create-user-via-api",
      });

      const setupOp = operationLog[operationLog.length - 1];
      if (setupOp?.response?.status !== 201) {
        throw new Error(`Expected setup create status 201, got ${setupOp?.response?.status}`);
      }

      await adminPage.fill("#admin-users-username", payload.username);
      await adminPage.fill("#admin-users-password", `Another_${Date.now()}`);
      await adminPage.fill("#admin-users-display-name", "Duplicate E2E");
      await adminPage.selectOption("#admin-users-role", "staff");

      const [duplicateResponse] = await Promise.all([
        adminPage.waitForResponse((res) => {
          return (
            res.url().includes("/api/admin/staff-users") && res.request().method() === "POST"
          );
        }),
        adminPage.click("button.admin-users-btn.admin-users-btn--brown"),
      ]);

      const duplicateOp = await captureUiResponseOperation(
        operationLog,
        "C/duplicate-post",
        duplicateResponse
      );
      const duplicateMessage = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );

      if (duplicateOp.response?.status !== 409) {
        throw new Error(`Expected duplicate status 409, got ${duplicateOp.response?.status}`);
      }
      if (!/exists|มีอยู่แล้ว/i.test(duplicateMessage)) {
        throw new Error(`Expected duplicate mapped message, got "${duplicateMessage}"`);
      }

      let postCount = 0;
      const onRequest = (request: { url(): string; method(): string }) => {
        if (request.url().includes("/api/admin/staff-users") && request.method() === "POST") {
          postCount += 1;
        }
      };
      adminPage.on("request", onRequest);
      const beforeShort = postCount;

      await adminPage.fill("#admin-users-username", `e2e_short_${Date.now()}`);
      await adminPage.fill("#admin-users-password", "123");
      await adminPage.fill("#admin-users-display-name", "Short Password");
      await adminPage.selectOption("#admin-users-role", "staff");
      await adminPage.click("button.admin-users-btn.admin-users-btn--brown");
      await adminPage.waitForTimeout(700);

      adminPage.off("request", onRequest);
      const afterShort = postCount;
      const shortMessage = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );

      if (afterShort !== beforeShort) {
        throw new Error("Expected short-password submit to be blocked (no POST request).");
      }
      if (!shortMessage.includes("Password ต้องมีอย่างน้อย 6 ตัวอักษร")) {
        throw new Error(`Expected short-password validation message, got "${shortMessage}"`);
      }
    } catch (error) {
      await enrichFailureAndThrow({
        testInfo,
        caseId: "C",
        error,
        operationLog,
      });
    } finally {
      await cleanupCreatedUser({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        createdUser,
        operationLog,
        testInfo,
        caseId: "C",
      });
    }
  });

  test("D) toggle is_active + rowBusy disables controls", async (
    { adminPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    let createdUser: CreatedUser | null = null;

    try {
      await openAdminUsersTab(adminPage, operationLog);

      const suffix = `${Date.now()}_d`;
      const payload = createE2eUserPayload(suffix);
      createdUser = await createUserViaApi({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        payload,
        operationLog,
        step: "D/setup-create-user-via-api",
      });

      await ensureUserRowVisible({
        page: adminPage,
        username: payload.username,
        operationLog,
      });

      const row = adminPage
        .locator(".admin-users-table tbody tr", { hasText: payload.username })
        .first();

      const checkbox = row.locator('input[type="checkbox"]').first();
      const resetBtn = row.locator("button", { hasText: "Reset Password" }).first();
      const beforeChecked = await checkbox.isChecked();

      if (createdUser.id) {
        await adminPage.route(
          `**/api/admin/staff-users/${createdUser.id}`,
          async (route) => {
            const upstream = await route.fetch();
            await adminPage.waitForTimeout(800);
            await route.fulfill({ response: upstream });
          },
          { times: 1 }
        );
      }

      const toggleResponsePromise = adminPage.waitForResponse((res) => {
        return (
          res.url().includes("/api/admin/staff-users/") &&
          res.request().method() === "PATCH"
        );
      });
      await checkbox.click();
      await expect(checkbox).toBeDisabled();
      await expect(resetBtn).toBeDisabled();
      const toggleResponse = await toggleResponsePromise;

      const toggleOp = await captureUiResponseOperation(
        operationLog,
        "D/toggle-is-active-patch",
        toggleResponse
      );
      await expect(checkbox).not.toBeDisabled();
      await expect(resetBtn).not.toBeDisabled();
      const afterChecked = await checkbox.isChecked();

      const message = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );

      if (toggleOp.response?.status !== 200) {
        throw new Error(`Expected toggle status 200, got ${toggleOp.response?.status}`);
      }
      if (beforeChecked === afterChecked) {
        throw new Error("Expected checkbox state to change after toggle.");
      }
      if (!message.includes("อัปเดตสถานะผู้ใช้สำเร็จ")) {
        throw new Error(`Expected toggle success message, got "${message}"`);
      }
    } catch (error) {
      await enrichFailureAndThrow({
        testInfo,
        caseId: "D",
        error,
        operationLog,
      });
    } finally {
      await cleanupCreatedUser({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        createdUser,
        operationLog,
        testInfo,
        caseId: "D",
      });
    }
  });

  test("E/F) reset password flow + optional login verify", async (
    { adminPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    let createdUser: CreatedUser | null = null;
    let dialogEvents: Array<{ type: string; message: string }> = [];
    const resetPassword = `E2eReset_${Date.now()}`;

    const onDialog = async (dialog: {
      type(): string;
      message(): string;
      accept(value?: string): Promise<void>;
      dismiss(): Promise<void>;
    }) => {
      dialogEvents.push({ type: dialog.type(), message: dialog.message() });
      if (dialog.type() === "prompt") {
        await dialog.accept(resetPassword);
        return;
      }
      if (dialog.type() === "confirm") {
        await dialog.accept();
        return;
      }
      await dialog.dismiss();
    };

    try {
      await openAdminUsersTab(adminPage, operationLog);

      const suffix = `${Date.now()}_e`;
      const payload = createE2eUserPayload(suffix);
      createdUser = await createUserViaApi({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        payload,
        operationLog,
        step: "E/setup-create-user-via-api",
      });
      await ensureUserRowVisible({
        page: adminPage,
        username: payload.username,
        operationLog,
      });

      const row = adminPage
        .locator(".admin-users-table tbody tr", { hasText: payload.username })
        .first();

      const resetBtn = row.locator("button", { hasText: "Reset Password" }).first();
      adminPage.on("dialog", onDialog);

      const [resetResponse] = await Promise.all([
        adminPage.waitForResponse((res) => {
          return (
            res.url().includes("/api/admin/staff-users/") &&
            res.request().method() === "PATCH"
          );
        }),
        resetBtn.click(),
      ]);

      const resetOp = await captureUiResponseOperation(
        operationLog,
        "E/reset-password-patch",
        resetResponse
      );
      const message = normalizeText(
        await adminPage.locator(".admin-users-message").first().textContent()
      );

      if (resetOp.response?.status !== 200) {
        throw new Error(`Expected reset status 200, got ${resetOp.response?.status}`);
      }
      if (!dialogEvents.some((event) => event.type === "prompt")) {
        throw new Error("Expected prompt dialog to appear in reset password flow.");
      }
      if (!dialogEvents.some((event) => event.type === "confirm")) {
        throw new Error("Expected confirm dialog to appear in reset password flow.");
      }
      if (!/รีเซ็ตรหัสผ่าน/.test(message)) {
        throw new Error(`Expected reset success message, got "${message}"`);
      }

      // Optional verification step (safe in local/dev):
      // confirm the new password can log in via API.
      const loginUrl = `${runtimeEnv.apiBase}/api/auth/login`;
      const verifyPayload = {
        username: payload.username,
        password: resetPassword,
      };
      const verifyResponse = await adminPage.request.post(loginUrl, {
        data: verifyPayload,
      });
      const verifyOp = await captureApiResponseOperation({
        log: operationLog,
        step: "F/optional-login-verification",
        method: "POST",
        url: loginUrl,
        requestPayload: verifyPayload,
        response: verifyResponse,
      });

      if (verifyOp.response?.status !== 200) {
        throw new Error(
          `Optional login verification failed with status ${verifyOp.response?.status}`
        );
      }
    } catch (error) {
      await enrichFailureAndThrow({
        testInfo,
        caseId: "E/F",
        error,
        operationLog,
      });
    } finally {
      adminPage.off("dialog", onDialog);
      pushOperation(operationLog, {
        step: "E/F/dialog-summary",
        request: {
          method: "N/A",
          url: "window.dialog",
          payloadSample: null,
        },
        response: {
          status: 0,
          ok: true,
          payloadSample: redact(dialogEvents),
        },
      });
      await cleanupCreatedUser({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        createdUser,
        operationLog,
        testInfo,
        caseId: "E/F",
      });
    }
  });
});
