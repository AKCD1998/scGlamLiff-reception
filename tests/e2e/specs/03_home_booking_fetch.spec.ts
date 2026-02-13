import type { APIResponse, Page, TestInfo } from "@playwright/test";
import { test, expect } from "../fixtures/admin";
import { saveJsonSnapshot } from "../utils/artifacts";

type EndpointSample = {
  step: string;
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  status: number;
  ok: boolean;
  payload: unknown;
  capturedAt: string;
};

function toStatusLabel(status: unknown): string {
  const value = String(status || "booked").toLowerCase();
  if (value === "completed") return "ให้บริการแล้ว";
  if (value === "cancelled" || value === "canceled") return "ยกเลิก";
  if (value === "no_show") return "ไม่มา";
  if (value === "rescheduled") return "เลื่อนนัด";
  return "จองแล้ว";
}

function readStableKey(row: Record<string, unknown>): string {
  const candidates = [
    row.id,
    row.appointment_id,
    row.appointmentId,
    row.raw_sheet_uuid,
    row.rawSheetUuid,
  ];
  for (const value of candidates) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function toObjectRows(payload: unknown, fieldName: "rows" | "options"): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") {
    throw new Error(`Expected payload object with "${fieldName}"`);
  }
  const data = payload as Record<string, unknown>;
  const list = data[fieldName];
  if (!Array.isArray(list)) {
    throw new Error(`Expected payload.${fieldName} to be an array`);
  }
  return list as Array<Record<string, unknown>>;
}

async function captureJsonResponse(
  step: string,
  response: {
    request(): { method(): string };
    url(): string;
    status(): number;
    ok(): boolean;
    json(): Promise<unknown>;
    text(): Promise<string>;
  }
): Promise<EndpointSample> {
  const url = response.url();
  const parsed = new URL(url);
  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    const text = await response.text().catch(() => "");
    payload = text ? { raw: text } : null;
  }

  return {
    step,
    method: response.request().method(),
    url,
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams.entries()),
    status: response.status(),
    ok: response.ok(),
    payload,
    capturedAt: new Date().toISOString(),
  };
}

async function waitForApiResponse(
  page: Page,
  predicate: (url: URL, response: { request(): { method(): string } }) => boolean,
  timeoutMs = 20_000
) {
  return page.waitForResponse(
    (res) => {
      try {
        const url = new URL(res.url());
        return predicate(url, res);
      } catch {
        return false;
      }
    },
    { timeout: timeoutMs }
  );
}

async function throwWithFailureSample(params: {
  caseId: string;
  error: unknown;
  testInfo: TestInfo;
  samples: EndpointSample[];
}): Promise<never> {
  const { caseId, error, testInfo, samples } = params;
  const message = error instanceof Error ? error.message : String(error);
  const failingSample = samples[samples.length - 1] || null;

  let artifactPath = "";
  try {
    artifactPath = await saveJsonSnapshot(
      `${testInfo.titlePath.join(" > ")}--failing-response-sample`,
      {
        failingSample,
        allSamples: samples,
        capturedAt: new Date().toISOString(),
      }
    );
    await testInfo.attach(`${caseId}-failing-response-sample`, {
      body: Buffer.from(
        JSON.stringify(
          {
            failingSample,
            allSamples: samples,
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
    `[${caseId}] ${message}` +
      (artifactPath ? ` | failing-response-json=${artifactPath}` : "") +
      ` | last-endpoint=${failingSample?.path || "n/a"}`
  );
}

test.describe("03 Home + Booking Fetch Contract", () => {
  test("home queue fetch contract + home list UI safety", async ({ adminPage }, testInfo) => {
    const samples: EndpointSample[] = [];

    try {
      const [homeQueueResponse] = await Promise.all([
        waitForApiResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "GET" &&
            url.pathname.endsWith("/api/appointments/queue") &&
            url.searchParams.get("limit") === "50"
        ),
        adminPage.reload({ waitUntil: "domcontentloaded" }),
      ]);

      const homeQueueSample = await captureJsonResponse("home/queue", homeQueueResponse);
      samples.push(homeQueueSample);

      expect(homeQueueSample.status).toBe(200);
      expect(homeQueueSample.ok).toBe(true);
      expect(homeQueueSample.query.limit).toBe("50");

      if (homeQueueSample.query.date) {
        expect(homeQueueSample.query.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      const payload = homeQueueSample.payload as Record<string, unknown>;
      expect(payload?.ok).toBe(true);

      const rows = toObjectRows(homeQueueSample.payload, "rows");
      for (const row of rows.slice(0, 10)) {
        expect(readStableKey(row), "each row should include a stable key").not.toBe("");
        expect(typeof row.status).toBe("string");
      }

      const tablePanel = adminPage.locator(".panel.table-panel");
      await expect(tablePanel).toBeVisible();

      if (rows.length === 0) {
        await expect(tablePanel.locator("tbody")).toContainText("ไม่มีข้อมูล");
        return;
      }

      const uiRows = tablePanel.locator("tbody tr");
      await expect(uiRows.first()).toBeVisible();
      expect(await uiRows.count()).toBeGreaterThan(0);
    } catch (error) {
      await throwWithFailureSample({
        caseId: "HOME",
        error,
        testInfo,
        samples,
      });
    }
  });

  test("booking fetch contracts + status mapping + customer detail modal", async (
    { adminPage },
    testInfo
  ) => {
    const samples: EndpointSample[] = [];

    try {
      const bookingTab = adminPage.locator(".top-tab", { hasText: "ระบบการจองคิว" }).first();
      await expect(bookingTab).toBeVisible();

      const [bookingQueueResponse, bookingOptionsResponse] = await Promise.all([
        waitForApiResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "GET" &&
            url.pathname.endsWith("/api/appointments/queue") &&
            url.searchParams.get("limit") === "200"
        ),
        waitForApiResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "GET" &&
            url.pathname.endsWith("/api/appointments/booking-options")
        ),
        bookingTab.click(),
      ]);

      const bookingQueueSample = await captureJsonResponse(
        "booking/queue",
        bookingQueueResponse
      );
      const bookingOptionsSample = await captureJsonResponse(
        "booking/options",
        bookingOptionsResponse
      );
      samples.push(bookingQueueSample, bookingOptionsSample);

      expect(bookingQueueSample.status).toBe(200);
      expect(bookingQueueSample.ok).toBe(true);
      expect(bookingQueueSample.query.limit).toBe("200");

      const queuePayload = bookingQueueSample.payload as Record<string, unknown>;
      expect(queuePayload?.ok).toBe(true);

      const queueRows = toObjectRows(bookingQueueSample.payload, "rows");
      for (const row of queueRows.slice(0, 10)) {
        expect(readStableKey(row), "queue row should include stable id key").not.toBe("");
        expect(typeof row.status, "queue row should contain status").toBe("string");
      }

      expect(bookingOptionsSample.status).toBe(200);
      expect(bookingOptionsSample.ok).toBe(true);
      const optionsPayload = bookingOptionsSample.payload as Record<string, unknown>;
      expect(optionsPayload?.ok).toBe(true);
      const options = toObjectRows(bookingOptionsSample.payload, "options");
      if (options.length > 0) {
        expect(String(options[0].value || "").trim()).not.toBe("");
        expect(String(options[0].label || "").trim()).not.toBe("");
      }

      const bookingTableBody = adminPage.locator("#booking-panel-queue .booking-table tbody");
      await expect(bookingTableBody).toBeVisible();

      if (queueRows.length === 0) {
        await expect(bookingTableBody).toContainText("ไม่มีข้อมูล");
      } else {
        const firstRow = queueRows[0];
        const expectedStatusLabel = toStatusLabel(firstRow.status);
        const firstUiRow = bookingTableBody.locator("tr").first();
        await expect(firstUiRow).toBeVisible();
        await expect(firstUiRow.locator("td").nth(6)).toHaveText(expectedStatusLabel);
      }

      const customerTab = adminPage.locator("#booking-tab-customer");
      await expect(customerTab).toBeVisible();

      const [customersResponse] = await Promise.all([
        waitForApiResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "GET" &&
            url.pathname.endsWith("/api/customers")
        ),
        customerTab.click(),
      ]);

      const customersSample = await captureJsonResponse("booking/customers", customersResponse);
      samples.push(customersSample);
      expect(customersSample.status).toBe(200);
      expect(customersSample.ok).toBe(true);

      const customersPayload = customersSample.payload as Record<string, unknown>;
      expect(customersPayload?.ok).toBe(true);
      const customers = toObjectRows(customersSample.payload, "rows");
      for (const customer of customers.slice(0, 10)) {
        const id = String(customer.id || "").trim();
        expect(id, "customer row should have id").not.toBe("");
      }

      const customerTableBody = adminPage.locator("#booking-panel-customer .booking-table tbody");
      await expect(customerTableBody).toBeVisible();

      if (customers.length === 0) {
        await expect(customerTableBody).toContainText("ไม่มีข้อมูล");
        return;
      }

      const firstCustomer = customers[0];
      const expectedCustomerId = String(firstCustomer.id || "").trim();
      const expectedCustomerName = String(
        firstCustomer.full_name || firstCustomer.fullName || ""
      ).trim();

      const [profileResponse] = await Promise.all([
        waitForApiResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "GET" &&
            url.pathname.endsWith(`/api/customers/${encodeURIComponent(expectedCustomerId)}/profile`)
        ),
        customerTableBody.locator("tr").first().locator(".booking-edit-button").click(),
      ]);

      const profileSample = await captureJsonResponse("booking/customer-profile", profileResponse);
      samples.push(profileSample);
      expect(profileSample.status).toBe(200);
      expect(profileSample.ok).toBe(true);

      const profilePayload = profileSample.payload as Record<string, unknown>;
      expect(profilePayload?.ok).toBe(true);
      expect(
        String((profilePayload.customer as Record<string, unknown>)?.id || "").trim()
      ).toBe(expectedCustomerId);

      const profileModal = adminPage.locator(".customer-profile-modal");
      await expect(profileModal).toBeVisible();
      if (expectedCustomerName) {
        await expect(profileModal).toContainText(expectedCustomerName);
      }
      await expect(profileModal).toContainText(expectedCustomerId);

      await adminPage
        .locator('button[aria-label="Close customer profile"]')
        .click();
      await expect(profileModal).toBeHidden();
    } catch (error) {
      await throwWithFailureSample({
        caseId: "BOOKING",
        error,
        testInfo,
        samples,
      });
    }
  });
});
