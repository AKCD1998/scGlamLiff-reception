import type { APIResponse, Page, TestInfo } from "@playwright/test";
import { test as adminTest, expect } from "../fixtures/admin";
import { test as staffTest } from "../fixtures/staff";
import { saveJsonSnapshot } from "../utils/artifacts";

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

type BookingOption = {
  value?: string;
  label?: string;
  source?: string;
  treatment_id?: string;
  treatment_item_text?: string;
  package_id?: string;
};

type SeededAppointment = {
  appointmentId: string;
  customerName: string;
  phone: string;
  treatmentText: string;
  requiresPackage: boolean;
};

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

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
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

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(input: string | null | undefined): string {
  return String(input || "").trim();
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

function requireSeedAllowed() {
  const allowed = String(process.env.E2E_ALLOW_SEED || "").trim().toLowerCase();
  if (allowed !== "true") {
    throw new Error(
      "Seeding is disabled. Set E2E_ALLOW_SEED=true to run workflow tests deterministically."
    );
  }
}

function formatFutureDateTime(attempt = 0): { visitDate: string; visitTime: string } {
  const base = new Date();
  base.setDate(base.getDate() + 2);
  const slot = (base.getMinutes() + attempt * 13) % 16;
  const hour = 10 + Math.floor(slot / 2);
  const minute = slot % 2 === 0 ? "00" : "30";

  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");

  return {
    visitDate: `${yyyy}-${mm}-${dd}`,
    visitTime: `${String(hour).padStart(2, "0")}:${minute}`,
  };
}

function buildPhone(seedNum: number): string {
  const digits = String(seedNum).replace(/\D+/g, "");
  return `09${digits.slice(-8).padStart(8, "0")}`;
}

async function chooseBookingOption(params: {
  page: Page;
  apiBase: string;
  requiresPackage: boolean;
  operationLog: OperationSample[];
}) {
  const { page, apiBase, requiresPackage, operationLog } = params;
  const url = `${apiBase}/api/appointments/booking-options`;
  const res = await page.request.get(url);
  const op = await recordApiResponse({
    log: operationLog,
    step: "seed/get-booking-options",
    method: "GET",
    url,
    requestPayload: null,
    response: res,
  });

  if (op.response?.status !== 200) {
    throw new Error(`Failed to load booking options. status=${op.response?.status}`);
  }

  const body = (op.response?.payloadSample || {}) as Record<string, unknown>;
  const options = Array.isArray(body.options) ? (body.options as BookingOption[]) : [];
  if (options.length === 0) {
    throw new Error("No booking options returned from API.");
  }

  if (requiresPackage) {
    const pkg = options.find(
      (opt) =>
        normalizeText(opt.source) === "package" &&
        normalizeText(opt.treatment_id) &&
        normalizeText(opt.package_id)
    );
    if (!pkg) {
      throw new Error("No package booking option found for package-required flow.");
    }
    return pkg;
  }

  const oneOff =
    options.find(
      (opt) =>
        normalizeText(opt.source) === "treatment" &&
        !/smooth/i.test(`${opt.label || ""} ${opt.treatment_item_text || ""}`) &&
        normalizeText(opt.treatment_id)
    ) ||
    options.find(
      (opt) => normalizeText(opt.source) === "treatment" && normalizeText(opt.treatment_id)
    ) ||
    options.find((opt) => normalizeText(opt.treatment_id));

  if (!oneOff) {
    throw new Error("No treatment option found for one-off flow.");
  }

  return oneOff;
}

async function seedAppointment(params: {
  page: Page;
  apiBase: string;
  requiresPackage: boolean;
  tag: string;
  operationLog: OperationSample[];
}): Promise<SeededAppointment> {
  requireSeedAllowed();

  const { page, apiBase, requiresPackage, tag, operationLog } = params;
  const option = await chooseBookingOption({
    page,
    apiBase,
    requiresPackage,
    operationLog,
  });

  const createUrl = `${apiBase}/api/appointments`;
  const uniqueBase = Date.now();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { visitDate, visitTime } = formatFutureDateTime(attempt);
    const customerName = `e2e_${tag}_${uniqueBase}_${attempt}`;
    const phone = buildPhone(uniqueBase + attempt);
    const payload: Record<string, unknown> = {
      visit_date: visitDate,
      visit_time_text: visitTime,
      customer_full_name: customerName,
      phone_raw: phone,
      email_or_lineid: `e2e_${uniqueBase}_${attempt}@example.test`,
      treatment_item_text:
        normalizeText(option.treatment_item_text) ||
        normalizeText(option.label) ||
        "E2E Treatment",
      treatment_id: normalizeText(option.treatment_id),
      staff_name: "E2E Staff",
    };

    const packageId = normalizeText(option.package_id);
    if (requiresPackage && packageId) {
      payload.package_id = packageId;
    }

    const res = await page.request.post(createUrl, { data: payload });
    const op = await recordApiResponse({
      log: operationLog,
      step: `seed/create-appointment/attempt-${attempt + 1}`,
      method: "POST",
      url: createUrl,
      requestPayload: payload,
      response: res,
    });

    if (op.response?.status === 409) {
      continue;
    }

    if (op.response?.status !== 200) {
      throw new Error(
        `Seed appointment failed. status=${op.response?.status} payload=${JSON.stringify(
          op.response?.payloadSample || {}
        )}`
      );
    }

    const body = (op.response?.payloadSample || {}) as Record<string, unknown>;
    const appointmentId = normalizeText(body.appointment_id as string);
    if (!appointmentId) {
      throw new Error("Seed response missing appointment_id.");
    }

    return {
      appointmentId,
      customerName,
      phone,
      treatmentText: normalizeText(payload.treatment_item_text as string),
      requiresPackage,
    };
  }

  throw new Error("Unable to seed appointment after multiple retries due slot conflicts.");
}

async function openBookingTab(page: Page, operationLog: OperationSample[]) {
  const bookingTab = page.locator(".top-tab", { hasText: "ระบบการจองคิว" }).first();
  await expect(bookingTab).toBeVisible();

  const [queueRes] = await Promise.all([
    waitForEndpointResponse(
      page,
      (url, response) =>
        response.request().method() === "GET" &&
        url.pathname.endsWith("/api/appointments/queue") &&
        url.searchParams.get("limit") === "200"
    ),
    bookingTab.click(),
  ]);

  const op = await recordUiResponse(operationLog, "booking/open-tab-queue", queueRes);
  if (op.response?.status !== 200) {
    throw new Error(`Queue load failed. status=${op.response?.status}`);
  }
}

function queueRowByCustomer(page: Page, customerName: string) {
  return page.locator("#booking-panel-queue .booking-table tbody tr", { hasText: customerName });
}

async function waitForQueueRow(page: Page, customerName: string) {
  const row = queueRowByCustomer(page, customerName).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

async function readQueueStatusCellText(page: Page, customerName: string) {
  const row = queueRowByCustomer(page, customerName).first();
  await expect(row).toBeVisible();
  return normalizeText(await row.locator("td").nth(6).textContent());
}

async function openServiceModal(params: {
  page: Page;
  customerName: string;
  appointmentId: string;
  operationLog: OperationSample[];
}) {
  const { page, customerName, appointmentId, operationLog } = params;
  const row = await waitForQueueRow(page, customerName);
  const treatmentText = normalizeText(await row.locator("td").nth(4).textContent());
  const looksLikeCourse = /\d+\s*\/\s*\d+/.test(treatmentText);

  const syncPromise = waitForEndpointResponse(
    page,
    (url, response) =>
      response.request().method() === "POST" &&
      url.pathname.endsWith(`/api/appointments/${encodeURIComponent(appointmentId)}/sync-course`),
    6_000
  ).catch(() => null);

  await row.locator("input.booking-check-input").first().click();
  const modal = page.locator(".service-confirmation-modal");
  await expect(modal).toBeVisible();

  const syncRes = await syncPromise;
  if (looksLikeCourse && !syncRes) {
    throw new Error("Expected sync-course ensure call for course-style booking.");
  }
  if (syncRes) {
    const op = await recordUiResponse(operationLog, "modal/sync-course", syncRes);
    if (op.response?.status !== 200) {
      throw new Error(`sync-course failed. status=${op.response?.status}`);
    }
  }

  return modal;
}

async function performCompleteFromModal(params: {
  page: Page;
  modal: ReturnType<Page["locator"]>;
  appointmentId: string;
  operationLog: OperationSample[];
  selectPackage: boolean;
}) {
  const { page, modal, appointmentId, operationLog, selectPackage } = params;

  if (selectPackage) {
    const firstPackage = modal.locator(".scm-packages .scm-package").first();
    await expect(firstPackage).toBeVisible();
    await firstPackage.click();
  }

  const [completeRes] = await Promise.all([
    waitForEndpointResponse(
      page,
      (url, response) =>
        response.request().method() === "POST" &&
        url.pathname.endsWith(`/api/appointments/${encodeURIComponent(appointmentId)}/complete`)
    ),
    modal.locator("button.scm-btn.scm-btn--primary").click(),
  ]);

  const op = await recordUiResponse(operationLog, "action/complete", completeRes);
  if (op.response?.status !== 200) {
    throw new Error(`complete action failed. status=${op.response?.status}`);
  }
}

async function performCancelFromModal(params: {
  page: Page;
  modal: ReturnType<Page["locator"]>;
  appointmentId: string;
  operationLog: OperationSample[];
}) {
  const { page, modal, appointmentId, operationLog } = params;
  await modal.locator('input[name="scm-status"][value="cancelled"]').check();

  const [cancelRes] = await Promise.all([
    waitForEndpointResponse(
      page,
      (url, response) =>
        response.request().method() === "POST" &&
        url.pathname.endsWith(`/api/appointments/${encodeURIComponent(appointmentId)}/cancel`)
    ),
    modal.locator("button.scm-btn.scm-btn--primary").click(),
  ]);

  const op = await recordUiResponse(operationLog, "action/cancel", cancelRes);
  if (op.response?.status !== 200) {
    throw new Error(`cancel action failed. status=${op.response?.status}`);
  }
}

async function performNoShowFromModal(params: {
  page: Page;
  modal: ReturnType<Page["locator"]>;
  appointmentId: string;
  operationLog: OperationSample[];
}) {
  const { page, modal, appointmentId, operationLog } = params;
  await modal.locator('input[name="scm-status"][value="no_show"]').check();

  const [noShowRes] = await Promise.all([
    waitForEndpointResponse(
      page,
      (url, response) =>
        response.request().method() === "POST" &&
        url.pathname.endsWith(`/api/appointments/${encodeURIComponent(appointmentId)}/no-show`)
    ),
    modal.locator("button.scm-btn.scm-btn--primary").click(),
  ]);

  const op = await recordUiResponse(operationLog, "action/no-show", noShowRes);
  if (op.response?.status !== 200) {
    throw new Error(`no-show action failed. status=${op.response?.status}`);
  }
}

async function performRevertFromModal(params: {
  page: Page;
  modal: ReturnType<Page["locator"]>;
  appointmentId: string;
  operationLog: OperationSample[];
}) {
  const { page, modal, appointmentId, operationLog } = params;
  const revertButton = modal.locator("button.scm-btn.scm-btn--danger");
  await expect(revertButton).toBeVisible();

  const [revertRes] = await Promise.all([
    waitForEndpointResponse(
      page,
      (url, response) =>
        response.request().method() === "POST" &&
        url.pathname.endsWith(`/api/appointments/${encodeURIComponent(appointmentId)}/revert`)
    ),
    revertButton.click(),
  ]);

  const op = await recordUiResponse(operationLog, "action/revert", revertRes);
  if (op.response?.status !== 200) {
    throw new Error(`revert action failed. status=${op.response?.status}`);
  }
}

async function cleanupAppointment(params: {
  page: Page;
  apiBase: string;
  appointmentId: string | null;
  operationLog: OperationSample[];
  caseId: string;
}) {
  const { page, apiBase, appointmentId, operationLog, caseId } = params;
  if (!appointmentId) return;
  const url = `${apiBase}/api/appointments/${encodeURIComponent(appointmentId)}/cancel`;
  try {
    const res = await page.request.post(url, { data: {} });
    await recordApiResponse({
      log: operationLog,
      step: `${caseId}/cleanup-cancel`,
      method: "POST",
      url,
      requestPayload: {},
      response: res,
      note: "Cleanup attempt; 200/404/409 are acceptable.",
    });
  } catch (error) {
    pushOperation(operationLog, {
      step: `${caseId}/cleanup-cancel`,
      request: {
        method: "POST",
        url,
        payloadSample: {},
      },
      response: null,
      note: `Cleanup threw: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function failWithWorkflowArtifacts(params: {
  caseId: string;
  error: unknown;
  testInfo: TestInfo;
  operationLog: OperationSample[];
}) {
  const { caseId, error, testInfo, operationLog } = params;
  const message = error instanceof Error ? error.message : String(error);
  const stackSnippet =
    error instanceof Error && error.stack
      ? error.stack.split("\n").slice(0, 4).join(" | ").trim()
      : "n/a";
  const condensed = operationLog.slice(-20);
  const last = condensed[condensed.length - 1] || null;

  let artifactPath = "";
  try {
    artifactPath = await saveJsonSnapshot(
      `${testInfo.titlePath.join(" > ")}--workflow-failure-sample`,
      redact({
        caseId,
        message,
        stackSnippet,
        lastEndpoint: last?.request?.url || null,
        lastPayload: last?.request?.payloadSample || null,
        operationLog: condensed,
        capturedAt: nowIso(),
      })
    );

    await testInfo.attach(`${caseId}-workflow-failure`, {
      body: Buffer.from(
        JSON.stringify(
          redact({
            stackSnippet,
            operationLog: condensed,
          }),
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
    `[${caseId}] ${message}` +
      ` | endpoint=${last?.request?.url || "n/a"}` +
      ` | payload=${JSON.stringify(redact(last?.request?.payloadSample || null)).slice(0, 250)}` +
      ` | stack=${stackSnippet}` +
      (artifactPath ? ` | artifact=${artifactPath}` : "")
  );
}

adminTest.describe("04 Staff Workflow Actions (admin path)", () => {
  adminTest("ensure(sync-course) + complete + revert update UI without hard refresh", async (
    { adminPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    let seeded: SeededAppointment | null = null;
    const beforeUrl = adminPage.url();

    try {
      seeded = await seedAppointment({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        requiresPackage: true,
        tag: "workflow_complete_revert",
        operationLog,
      });

      await openBookingTab(adminPage, operationLog);
      await waitForQueueRow(adminPage, seeded.customerName);

      let statusText = await readQueueStatusCellText(adminPage, seeded.customerName);
      expect(statusText).toBe("จองแล้ว");

      const modalBeforeComplete = await openServiceModal({
        page: adminPage,
        customerName: seeded.customerName,
        appointmentId: seeded.appointmentId,
        operationLog,
      });

      await performCompleteFromModal({
        page: adminPage,
        modal: modalBeforeComplete,
        appointmentId: seeded.appointmentId,
        operationLog,
        selectPackage: true,
      });

      await expect(modalBeforeComplete).toBeHidden();
      statusText = await readQueueStatusCellText(adminPage, seeded.customerName);
      expect(statusText).toBe("ให้บริการแล้ว");
      expect(adminPage.url()).toBe(beforeUrl);

      const modalBeforeRevert = await openServiceModal({
        page: adminPage,
        customerName: seeded.customerName,
        appointmentId: seeded.appointmentId,
        operationLog,
      });
      await performRevertFromModal({
        page: adminPage,
        modal: modalBeforeRevert,
        appointmentId: seeded.appointmentId,
        operationLog,
      });

      await expect(modalBeforeRevert).toBeHidden();
      statusText = await readQueueStatusCellText(adminPage, seeded.customerName);
      expect(statusText).toBe("จองแล้ว");
      expect(adminPage.url()).toBe(beforeUrl);
    } catch (error) {
      await failWithWorkflowArtifacts({
        caseId: "ADMIN-COMPLETE-REVERT",
        error,
        testInfo,
        operationLog,
      });
    } finally {
      await cleanupAppointment({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        appointmentId: seeded?.appointmentId || null,
        operationLog,
        caseId: "ADMIN-COMPLETE-REVERT",
      });
    }
  });

  adminTest("cancel action calls /cancel and row disappears without hard refresh", async (
    { adminPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    let seeded: SeededAppointment | null = null;
    const beforeUrl = adminPage.url();

    try {
      seeded = await seedAppointment({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        requiresPackage: false,
        tag: "workflow_cancel",
        operationLog,
      });

      await openBookingTab(adminPage, operationLog);
      await waitForQueueRow(adminPage, seeded.customerName);

      const modal = await openServiceModal({
        page: adminPage,
        customerName: seeded.customerName,
        appointmentId: seeded.appointmentId,
        operationLog,
      });
      await performCancelFromModal({
        page: adminPage,
        modal,
        appointmentId: seeded.appointmentId,
        operationLog,
      });

      await expect(modal).toBeHidden();
      await expect(queueRowByCustomer(adminPage, seeded.customerName)).toHaveCount(0);
      expect(adminPage.url()).toBe(beforeUrl);
    } catch (error) {
      await failWithWorkflowArtifacts({
        caseId: "ADMIN-CANCEL",
        error,
        testInfo,
        operationLog,
      });
    } finally {
      await cleanupAppointment({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        appointmentId: seeded?.appointmentId || null,
        operationLog,
        caseId: "ADMIN-CANCEL",
      });
    }
  });

  adminTest("negative: missing required field on complete -> 400 + UI message", async (
    { adminPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    let seeded: SeededAppointment | null = null;

    try {
      seeded = await seedAppointment({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        requiresPackage: true,
        tag: "workflow_negative_400",
        operationLog,
      });

      await openBookingTab(adminPage, operationLog);
      await waitForQueueRow(adminPage, seeded.customerName);

      const modal = await openServiceModal({
        page: adminPage,
        customerName: seeded.customerName,
        appointmentId: seeded.appointmentId,
        operationLog,
      });

      const packageButton = modal.locator(".scm-packages .scm-package").first();
      await expect(packageButton).toBeVisible();
      await packageButton.click();

      await adminPage.route(
        `**/api/appointments/${seeded.appointmentId}/complete`,
        async (route) => {
          const req = route.request();
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(req.postData() || "{}") as Record<string, unknown>;
          } catch {
            payload = {};
          }
          payload.customer_package_id = "invalid-package-id";
          const headers = { ...req.headers() };
          delete headers["content-length"];
          delete headers["Content-Length"];
          await route.continue({
            headers,
            postData: JSON.stringify(payload),
          });
        },
        { times: 1 }
      );

      const [completeRes] = await Promise.all([
        waitForEndpointResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "POST" &&
            url.pathname.endsWith(`/api/appointments/${encodeURIComponent(seeded.appointmentId)}/complete`)
        ),
        modal.locator("button.scm-btn.scm-btn--primary").click(),
      ]);

      const op = await recordUiResponse(operationLog, "negative/complete-invalid-payload", completeRes);
      expect(op.response?.status).toBe(400);

      await expect(modal.locator(".scm-state.scm-state--error")).toContainText(
        /invalid customer_package_id/i
      );
      await expect(modal).toBeVisible();

      const statusText = await readQueueStatusCellText(adminPage, seeded.customerName);
      expect(statusText).toBe("จองแล้ว");
    } catch (error) {
      await failWithWorkflowArtifacts({
        caseId: "ADMIN-NEGATIVE-400",
        error,
        testInfo,
        operationLog,
      });
    } finally {
      await cleanupAppointment({
        page: adminPage,
        apiBase: runtimeEnv.apiBase,
        appointmentId: seeded?.appointmentId || null,
        operationLog,
        caseId: "ADMIN-NEGATIVE-400",
      });
    }
  });
});

staffTest.describe("04 Staff Workflow Actions (staff path)", () => {
  staffTest("no-show action calls /no-show and row disappears without hard refresh", async (
    { staffPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    let seeded: SeededAppointment | null = null;
    const beforeUrl = staffPage.url();

    try {
      seeded = await seedAppointment({
        page: staffPage,
        apiBase: runtimeEnv.apiBase,
        requiresPackage: false,
        tag: "workflow_noshow",
        operationLog,
      });

      await openBookingTab(staffPage, operationLog);
      await waitForQueueRow(staffPage, seeded.customerName);

      const modal = await openServiceModal({
        page: staffPage,
        customerName: seeded.customerName,
        appointmentId: seeded.appointmentId,
        operationLog,
      });

      await performNoShowFromModal({
        page: staffPage,
        modal,
        appointmentId: seeded.appointmentId,
        operationLog,
      });

      await expect(modal).toBeHidden();
      await expect(queueRowByCustomer(staffPage, seeded.customerName)).toHaveCount(0);
      expect(staffPage.url()).toBe(beforeUrl);
    } catch (error) {
      await failWithWorkflowArtifacts({
        caseId: "STAFF-NOSHOW",
        error,
        testInfo,
        operationLog,
      });
    } finally {
      await cleanupAppointment({
        page: staffPage,
        apiBase: runtimeEnv.apiBase,
        appointmentId: seeded?.appointmentId || null,
        operationLog,
        caseId: "STAFF-NOSHOW",
      });
    }
  });

  staffTest("negative: staff unauthorized for revert -> 403", async (
    { staffPage, runtimeEnv },
    testInfo
  ) => {
    const operationLog: OperationSample[] = [];
    let seeded: SeededAppointment | null = null;

    try {
      seeded = await seedAppointment({
        page: staffPage,
        apiBase: runtimeEnv.apiBase,
        requiresPackage: false,
        tag: "workflow_negative_403",
        operationLog,
      });

      await openBookingTab(staffPage, operationLog);
      await waitForQueueRow(staffPage, seeded.customerName);

      const modal = await openServiceModal({
        page: staffPage,
        customerName: seeded.customerName,
        appointmentId: seeded.appointmentId,
        operationLog,
      });

      await performCompleteFromModal({
        page: staffPage,
        modal,
        appointmentId: seeded.appointmentId,
        operationLog,
        selectPackage: true,
      });

      await expect(modal).toBeHidden();
      const statusText = await readQueueStatusCellText(staffPage, seeded.customerName);
      expect(statusText).toBe("ให้บริการแล้ว");

      const revertUrl = `${runtimeEnv.apiBase}/api/appointments/${encodeURIComponent(
        seeded.appointmentId
      )}/revert`;
      const revertRes = await staffPage.request.post(revertUrl, { data: {} });
      const op = await recordApiResponse({
        log: operationLog,
        step: "negative/staff-revert-forbidden",
        method: "POST",
        url: revertUrl,
        requestPayload: {},
        response: revertRes,
      });

      expect(op.response?.status).toBe(403);
      const payload = (op.response?.payloadSample || {}) as Record<string, unknown>;
      expect(payload?.ok).toBe(false);
      expect(String(payload?.error || "")).toMatch(/forbidden/i);

      const modalAfterComplete = await openServiceModal({
        page: staffPage,
        customerName: seeded.customerName,
        appointmentId: seeded.appointmentId,
        operationLog,
      });
      await expect(modalAfterComplete).toContainText(/เฉพาะแอดมิน/i);
      await expect(modalAfterComplete.locator("button.scm-btn.scm-btn--danger")).toHaveCount(0);
    } catch (error) {
      await failWithWorkflowArtifacts({
        caseId: "STAFF-NEGATIVE-403",
        error,
        testInfo,
        operationLog,
      });
    } finally {
      await cleanupAppointment({
        page: staffPage,
        apiBase: runtimeEnv.apiBase,
        appointmentId: seeded?.appointmentId || null,
        operationLog,
        caseId: "STAFF-NEGATIVE-403",
      });
    }
  });
});
