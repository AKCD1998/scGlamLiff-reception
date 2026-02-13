import type { TestInfo } from "@playwright/test";
import { test, expect } from "../fixtures/admin";
import { saveJsonSnapshot } from "../utils/artifacts";

type ProfileResponseSample = {
  step: string;
  method: string;
  url: string;
  status: number;
  ok: boolean;
  payload: unknown;
  capturedAt: string;
};

const PROFILE_ROUTE_HINT = "backend/src/routes/customers.js -> GET /api/customers/:customerId/profile";
const PROFILE_CONTROLLER_HINT =
  "backend/src/controllers/customersController.js -> getCustomerProfile()";

// Locked contract from backend controller response body.
const LOCKED_PROFILE_KEYS = ["ok", "customer", "packages", "usage_history", "appointment_history"];

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (["password", "token", "jwt", "authorization", "cookie"].includes(key.toLowerCase())) {
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
): Promise<ProfileResponseSample> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    const raw = await response.text().catch(() => "");
    payload = raw ? { raw } : null;
  }

  return {
    step,
    method: response.request().method(),
    url: response.url(),
    status: response.status(),
    ok: response.ok(),
    payload: redact(payload),
    capturedAt: new Date().toISOString(),
  };
}

async function waitForApiResponse(
  page: import("@playwright/test").Page,
  matcher: (url: URL, response: { request(): { method(): string } }) => boolean,
  timeoutMs = 20_000
) {
  return page.waitForResponse(
    (res) => {
      try {
        const url = new URL(res.url());
        return matcher(url, res);
      } catch {
        return false;
      }
    },
    { timeout: timeoutMs }
  );
}

async function failWithContractArtifact(params: {
  testInfo: TestInfo;
  error: unknown;
  samples: ProfileResponseSample[];
  expectedKeys: string[];
  actualKeys: string[];
}) {
  const { testInfo, error, samples, expectedKeys, actualKeys } = params;
  const message = error instanceof Error ? error.message : String(error);
  const last = samples[samples.length - 1] || null;

  let artifactPath = "";
  try {
    artifactPath = await saveJsonSnapshot(
      `${testInfo.titlePath.join(" > ")}--customer-profile-contract-mismatch`,
      {
        error: message,
        expectedKeys,
        actualKeys,
        routeHint: PROFILE_ROUTE_HINT,
        controllerHint: PROFILE_CONTROLLER_HINT,
        samples,
        capturedAt: new Date().toISOString(),
      }
    );

    await testInfo.attach("customer-profile-contract-mismatch", {
      body: Buffer.from(
        JSON.stringify(
          {
            expectedKeys,
            actualKeys,
            routeHint: PROFILE_ROUTE_HINT,
            controllerHint: PROFILE_CONTROLLER_HINT,
            samples,
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
    `[CUSTOMER_PROFILE_CONTRACT] ${message}` +
      ` | expectedKeys=${JSON.stringify(expectedKeys)}` +
      ` | actualKeys=${JSON.stringify(actualKeys)}` +
      ` | route=${PROFILE_ROUTE_HINT}` +
      ` | controller=${PROFILE_CONTROLLER_HINT}` +
      (artifactPath ? ` | artifact=${artifactPath}` : "") +
      ` | endpoint=${last?.url || "n/a"}`
  );
}

test.describe("05 CustomerProfileModal Contract", () => {
  test("fetch/render contract for first customer profile", async ({ adminPage }, testInfo) => {
    const samples: ProfileResponseSample[] = [];
    let actualKeys: string[] = [];

    try {
      const bookingTab = adminPage.locator(".top-tab", { hasText: "ระบบการจองคิว" }).first();
      await expect(bookingTab).toBeVisible();
      await bookingTab.click();

      const customerTab = adminPage.locator("#booking-tab-customer");
      await expect(customerTab).toBeVisible();

      const [customersResponse] = await Promise.all([
        waitForApiResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "GET" && url.pathname.endsWith("/api/customers")
        ),
        customerTab.click(),
      ]);

      const customersSample = await captureJsonResponse("booking/customers", customersResponse);
      samples.push(customersSample);
      expect(customersSample.status).toBe(200);
      expect(customersSample.ok).toBe(true);

      const customersPayload = (customersSample.payload || {}) as Record<string, unknown>;
      expect(customersPayload?.ok).toBe(true);
      const customers = Array.isArray(customersPayload.rows)
        ? (customersPayload.rows as Array<Record<string, unknown>>)
        : [];

      const customerTableBody = adminPage.locator("#booking-panel-customer .booking-table tbody");
      await expect(customerTableBody).toBeVisible();

      if (customers.length === 0) {
        await expect(customerTableBody).toContainText("ไม่มีข้อมูล");
        throw new Error(
          "Cannot validate CustomerProfileModal contract because /api/customers returned empty rows."
        );
      }

      const firstCustomer = customers[0];
      const expectedCustomerId = normalizeText(firstCustomer.id as string);
      const expectedCustomerName = normalizeText(
        (firstCustomer.full_name as string) || (firstCustomer.fullName as string)
      );
      if (!expectedCustomerId) {
        throw new Error("First customer row missing id.");
      }

      const firstCustomerRow = customerTableBody.locator("tr").first();
      await expect(firstCustomerRow).toBeVisible();
      if (expectedCustomerName) {
        await expect(firstCustomerRow).toContainText(expectedCustomerName);
      }

      const [profileResponse] = await Promise.all([
        waitForApiResponse(
          adminPage,
          (url, response) =>
            response.request().method() === "GET" &&
            url.pathname.endsWith(`/api/customers/${encodeURIComponent(expectedCustomerId)}/profile`)
        ),
        firstCustomerRow.locator(".booking-edit-button").click(),
      ]);

      const profileSample = await captureJsonResponse("booking/customer-profile", profileResponse);
      samples.push(profileSample);
      expect(profileSample.status).toBe(200);
      expect(profileSample.ok).toBe(true);

      const payload = (profileSample.payload || {}) as Record<string, unknown>;
      expect(payload?.ok).toBe(true);

      actualKeys = Object.keys(payload).sort();
      const expectedKeys = [...LOCKED_PROFILE_KEYS].sort();
      expect(actualKeys).toEqual(expectedKeys);

      const profileCustomer = (payload.customer || {}) as Record<string, unknown>;
      expect(normalizeText(profileCustomer.id as string)).toBe(expectedCustomerId);

      const packages = Array.isArray(payload.packages)
        ? (payload.packages as Array<Record<string, unknown>>)
        : [];
      const usageHistory = Array.isArray(payload.usage_history)
        ? (payload.usage_history as Array<Record<string, unknown>>)
        : [];
      const appointmentHistory = Array.isArray(payload.appointment_history)
        ? (payload.appointment_history as Array<Record<string, unknown>>)
        : [];

      const modal = adminPage.locator(".customer-profile-modal");
      await expect(modal).toBeVisible();
      await expect(modal).toContainText(expectedCustomerId);
      if (expectedCustomerName) {
        await expect(modal).toContainText(expectedCustomerName);
      }

      const coursesSection = modal.locator(".cpm-section.cpm-courses");
      await expect(coursesSection).toBeVisible();
      if (packages.length > 0) {
        await expect(coursesSection.locator(".cpm-course-card").first()).toBeVisible();
      } else {
        await expect(coursesSection).toContainText("ยังไม่มีคอร์ส");
      }

      const usageSection = modal.locator(".cpm-section.cpm-history");
      await expect(usageSection).toBeVisible();
      if (usageHistory.length > 0) {
        await expect(usageSection.locator("tbody tr").first()).toBeVisible();
      } else {
        await expect(usageSection).toContainText("ยังไม่มีประวัติการใช้");
      }

      const appointmentSection = modal.locator(".cpm-section.cpm-appointments");
      await expect(appointmentSection).toBeVisible();
      if (appointmentHistory.length > 0) {
        await expect(appointmentSection.locator("tbody tr").first()).toBeVisible();
      } else {
        await expect(appointmentSection).toContainText("ยังไม่มีประวัติการจอง");
      }
    } catch (error) {
      await failWithContractArtifact({
        testInfo,
        error,
        samples,
        expectedKeys: [...LOCKED_PROFILE_KEYS].sort(),
        actualKeys,
      });
    } finally {
      const closeButton = adminPage.locator('button[aria-label="Close customer profile"]');
      if (await closeButton.count()) {
        await closeButton.first().click().catch(() => {});
      }
    }
  });
});
