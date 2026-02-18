import type { APIResponse } from "@playwright/test";
import { test, expect } from "../fixtures/admin";

type JsonRecord = Record<string, unknown>;

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function buildFutureSlot(seed = 0): { visitDate: string; visitTime: string } {
  const base = new Date();
  base.setDate(base.getDate() + 3);
  const hour = 10 + (seed % 6);
  const minute = seed % 2 === 0 ? "00" : "30";
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return {
    visitDate: `${yyyy}-${mm}-${dd}`,
    visitTime: `${String(hour).padStart(2, "0")}:${minute}`,
  };
}

function buildPhone(seed: number): string {
  const digits = String(seed).replace(/\D+/g, "");
  return `09${digits.slice(-8).padStart(8, "0")}`;
}

async function readJson(response: APIResponse): Promise<JsonRecord> {
  try {
    const payload = await response.json();
    return (payload as JsonRecord) || {};
  } catch {
    return {};
  }
}

async function createStaffAppointment(params: {
  apiBase: string;
  request: {
    get(url: string): Promise<APIResponse>;
    post(url: string, options?: { data?: unknown }): Promise<APIResponse>;
  };
  seed: number;
  lineValue: string;
  customerName: string;
  staffName: string;
}): Promise<string> {
  const { apiBase, request, seed, lineValue, customerName, staffName } = params;
  const optionsRes = await request.get(`${apiBase}/api/appointments/booking-options`);
  expect(optionsRes.status()).toBe(200);
  const optionsPayload = await readJson(optionsRes);
  const options = Array.isArray(optionsPayload.options) ? (optionsPayload.options as JsonRecord[]) : [];
  const option = options.find((row) => normalizeText(row.treatment_id)) || null;
  if (!option) {
    throw new Error("No booking option available for SSOT identity test.");
  }
  const treatmentId = normalizeText(option.treatment_id);
  if (!treatmentId) {
    throw new Error("Selected booking option is missing treatment_id.");
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { visitDate, visitTime } = buildFutureSlot(seed + attempt);
    const payload = {
      visit_date: visitDate,
      visit_time_text: visitTime,
      customer_full_name: `${customerName}_${attempt}`,
      phone_raw: buildPhone(seed + attempt),
      email_or_lineid: lineValue,
      treatment_item_text:
        normalizeText(option.treatment_item_text) || normalizeText(option.label) || "Smooth",
      treatment_id: treatmentId,
      staff_name: staffName,
    };

    const createRes = await request.post(`${apiBase}/api/appointments`, { data: payload });
    if (createRes.status() === 409) {
      continue;
    }
    expect(createRes.status()).toBe(200);
    const createPayload = await readJson(createRes);
    const appointmentId = normalizeText(createPayload.appointment_id);
    if (!appointmentId) {
      throw new Error("Create appointment response missing appointment_id.");
    }
    return appointmentId;
  }

  throw new Error("Unable to create appointment fixture after slot-conflict retries.");
}

async function getQueueRowByAppointmentId(params: {
  apiBase: string;
  request: { get(url: string): Promise<APIResponse> };
  visitDate: string;
  appointmentId: string;
}): Promise<JsonRecord> {
  const { apiBase, request, visitDate, appointmentId } = params;
  const queueRes = await request.get(
    `${apiBase}/api/appointments/queue?date=${encodeURIComponent(visitDate)}&limit=500`
  );
  expect(queueRes.status()).toBe(200);
  const queuePayload = await readJson(queueRes);
  const rows = Array.isArray(queuePayload.rows) ? (queuePayload.rows as JsonRecord[]) : [];
  const row =
    rows.find((item) => normalizeText(item.appointment_id) === appointmentId) ||
    rows.find((item) => normalizeText(item.id) === appointmentId) ||
    null;
  if (!row) {
    throw new Error(`Queue row not found for appointment ${appointmentId}`);
  }
  return row;
}

test.describe("08 SSOT Staff + Identity Consistency", () => {
  test("queue staffName must match admin detail staff_name when sheet staff differs", async ({
    adminPage,
    runtimeEnv,
  }) => {
    const apiBase = runtimeEnv.apiBase;
    const seed = Date.now();
    const sheetStaffName = "E2E Sheet Staff";
    const eventStaffName = "E2E Event Staff";
    const customerName = `e2e_ssot_staff_${seed}`;
    const { visitDate, visitTime } = buildFutureSlot(seed);
    const phone = buildPhone(seed);
    let appointmentId = "";

    try {
      const createVisitRes = await adminPage.request.post(`${apiBase}/api/visits`, {
        data: {
          visit_date: visitDate,
          visit_time_text: visitTime,
          customer_full_name: customerName,
          phone_raw: phone,
          email_or_lineid: `line_ssot_staff_${seed}`,
          treatment_item_text: "smooth",
          staff_name: sheetStaffName,
        },
      });
      expect(createVisitRes.status()).toBe(200);
      const createVisitPayload = await readJson(createVisitRes);
      const sheetUuid = normalizeText(createVisitPayload.id);
      expect(sheetUuid).not.toBe("");

      const ensureRes = await adminPage.request.post(
        `${apiBase}/api/appointments/from-sheet/${encodeURIComponent(sheetUuid)}/ensure`,
        { data: {} }
      );
      expect(ensureRes.status()).toBe(200);
      const ensurePayload = await readJson(ensureRes);
      appointmentId = normalizeText(
        (ensurePayload.appointment as JsonRecord | undefined)?.id ||
          (ensurePayload.appointment as JsonRecord | undefined)?.appointment_id
      );
      expect(appointmentId).not.toBe("");

      const patchRes = await adminPage.request.patch(
        `${apiBase}/api/admin/appointments/${encodeURIComponent(appointmentId)}`,
        {
          data: {
            reason: "e2e ssot staff parity check",
            staff_name: eventStaffName,
          },
        }
      );
      expect(patchRes.status()).toBe(200);

      const queueRow = await getQueueRowByAppointmentId({
        apiBase,
        request: adminPage.request,
        visitDate,
        appointmentId,
      });
      const queueStaff = normalizeText(queueRow.staffName ?? queueRow.staff_name);

      const adminRes = await adminPage.request.get(
        `${apiBase}/api/admin/appointments/${encodeURIComponent(appointmentId)}`
      );
      expect(adminRes.status()).toBe(200);
      const adminPayload = await readJson(adminRes);
      const adminStaff = normalizeText((adminPayload.appointment as JsonRecord | undefined)?.staff_name);

      expect(queueStaff).toBe(eventStaffName);
      expect(adminStaff).toBe(eventStaffName);
      expect(queueStaff).not.toBe(sheetStaffName);
    } finally {
      if (appointmentId) {
        await adminPage.request.post(
          `${apiBase}/api/appointments/${encodeURIComponent(appointmentId)}/cancel`,
          { data: {} }
        );
      }
    }
  });

  test("queue lineId must match admin email_or_lineid from customer_identities (not event meta)", async ({
    adminPage,
    runtimeEnv,
  }) => {
    const apiBase = runtimeEnv.apiBase;
    const seed = Date.now() + 17;
    const lineOnlyInEvent = `line_event_only_${seed}`;
    const customerName = `e2e_ssot_identity_${seed}`;
    const { visitDate } = buildFutureSlot(seed);
    let appointmentId = "";

    try {
      appointmentId = await createStaffAppointment({
        apiBase,
        request: adminPage.request,
        seed,
        lineValue: lineOnlyInEvent,
        customerName,
        staffName: "E2E Identity Staff",
      });

      const queueRow = await getQueueRowByAppointmentId({
        apiBase,
        request: adminPage.request,
        visitDate,
        appointmentId,
      });
      const queueLineId = normalizeText(queueRow.lineId ?? queueRow.line_id);

      const adminRes = await adminPage.request.get(
        `${apiBase}/api/admin/appointments/${encodeURIComponent(appointmentId)}`
      );
      expect(adminRes.status()).toBe(200);
      const adminPayload = await readJson(adminRes);
      const adminEmailOrLine = normalizeText(
        (adminPayload.appointment as JsonRecord | undefined)?.email_or_lineid
      );

      expect(queueLineId).toBe(adminEmailOrLine);
      expect(adminEmailOrLine).toBe("");
      expect(queueLineId).not.toBe(lineOnlyInEvent);
    } finally {
      if (appointmentId) {
        await adminPage.request.post(
          `${apiBase}/api/appointments/${encodeURIComponent(appointmentId)}/cancel`,
          { data: {} }
        );
      }
    }
  });
});
