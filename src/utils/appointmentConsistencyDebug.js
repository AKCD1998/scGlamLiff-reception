import * as appointmentsApi from "./appointmentsApi";

const TARGET_APPOINTMENT_IDS = [
  "216cb944-5d28-4945-b4a8-56c90b42cc89",
  "a0a94f48-2978-4b31-86c5-550907087ffe",
];

const CRITICAL_FIELDS = [
  "appointment_id",
  "raw_sheet_uuid",
  "scheduled_at",
  "branch_id",
  "customer_full_name",
  "phone",
  "treatment_id",
  "treatment_item_text",
  "status",
  "staff_name",
];

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeFieldValue(field, value) {
  if (field === "scheduled_at") {
    const text = normalizeText(value);
    if (!text) return "";
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) return text;
    return new Date(parsed).toISOString();
  }
  if (field === "phone") {
    return normalizeText(value).replace(/\D+/g, "");
  }
  return normalizeText(value);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toBangkokDateKey(iso) {
  const raw = normalizeText(iso);
  if (!raw) return "";

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw.slice(0, 10);
  }

  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const bangkokDate = new Date(parsed.getTime() + bangkokOffsetMs);
  return `${bangkokDate.getUTCFullYear()}-${pad2(bangkokDate.getUTCMonth() + 1)}-${pad2(
    bangkokDate.getUTCDate()
  )}`;
}

function shouldRunDebug() {
  const env = import.meta.env || {};
  const flag =
    String(env.VITE_DEBUG_APPOINTMENT_CONSISTENCY || "")
      .trim()
      .toLowerCase() === "true";

  if (flag) return true;
  if (Boolean(env.PROD)) return false;
  if (String(env.MODE || "").toLowerCase() === "test") return false;
  return true;
}

function pickQueueRow(queueRows, appointmentId) {
  const targetId = normalizeText(appointmentId);
  return (
    (queueRows || []).find(
      (row) =>
        normalizeText(row?.appointment_id) === targetId || normalizeText(row?.id) === targetId
    ) || null
  );
}

function toQueueSnapshot(row, fallbackId) {
  return {
    appointment_id: normalizeText(row?.appointment_id || row?.id || fallbackId),
    raw_sheet_uuid: normalizeText(row?.raw_sheet_uuid),
    scheduled_at: normalizeText(row?.scheduled_at),
    branch_id: normalizeText(row?.branch_id),
    customer_full_name: normalizeText(row?.customer_full_name || row?.customerName),
    phone: normalizeText(row?.phone),
    treatment_id: normalizeText(row?.treatment_id),
    treatment_item_text: normalizeText(
      row?.treatment_item_text ||
        row?.treatment_item_text_override ||
        row?.treatmentItem ||
        row?.treatmentItemDisplay
    ),
    status: normalizeText(row?.status),
    staff_name: normalizeText(row?.staff_name || row?.staffName),
  };
}

function toAdminSnapshot(appointment, fallbackId) {
  return {
    appointment_id: normalizeText(appointment?.id || fallbackId),
    raw_sheet_uuid: normalizeText(appointment?.raw_sheet_uuid),
    scheduled_at: normalizeText(appointment?.scheduled_at),
    branch_id: normalizeText(appointment?.branch_id),
    customer_full_name: normalizeText(appointment?.customer_full_name),
    phone: normalizeText(appointment?.phone),
    treatment_id: normalizeText(appointment?.treatment_id),
    treatment_item_text: normalizeText(
      appointment?.treatment_item_text || appointment?.treatment_title
    ),
    status: normalizeText(appointment?.status),
    staff_name: normalizeText(appointment?.staff_name),
  };
}

function diffSnapshots(queueSnapshot, adminSnapshot) {
  return CRITICAL_FIELDS.filter((field) => {
    const queueValue = normalizeFieldValue(field, queueSnapshot[field]);
    const adminValue = normalizeFieldValue(field, adminSnapshot[field]);
    return queueValue !== adminValue;
  }).map((field) => ({
    field,
    queue: queueSnapshot[field] || "",
    admin: adminSnapshot[field] || "",
  }));
}

export async function runAppointmentConsistencyDebug({
  appointmentIds = TARGET_APPOINTMENT_IDS,
  signal,
} = {}) {
  if (!shouldRunDebug()) return { ran: false, rows: [] };
  if (
    typeof appointmentsApi.getAppointmentsQueue !== "function" ||
    typeof appointmentsApi.getAdminAppointmentById !== "function"
  ) {
    return { ran: false, rows: [] };
  }

  const ids = Array.from(
    new Set(
      (Array.isArray(appointmentIds) ? appointmentIds : [])
        .map((item) => normalizeText(item))
        .filter(Boolean)
    )
  );

  if (ids.length === 0) return { ran: false, rows: [] };

  const summary = [];
  console.groupCollapsed(
    `[appointment-consistency] Comparing Homepage queue vs Admin detail for ${ids.length} id(s)`
  );

  for (const appointmentId of ids) {
    try {
      const adminResponse = await appointmentsApi.getAdminAppointmentById(appointmentId, signal);
      const adminAppointment = adminResponse?.appointment || null;
      const adminSnapshot = toAdminSnapshot(adminAppointment, appointmentId);

      const dateKey = toBangkokDateKey(adminSnapshot.scheduled_at);
      const queueResponse = await appointmentsApi.getAppointmentsQueue(
        { date: dateKey || undefined, limit: 500 },
        signal
      );
      let queueRow = pickQueueRow(queueResponse?.rows || [], appointmentId);

      if (!queueRow && dateKey) {
        const broadQueue = await appointmentsApi.getAppointmentsQueue({ limit: 500 }, signal);
        queueRow = pickQueueRow(broadQueue?.rows || [], appointmentId);
      }

      const queueSnapshot = toQueueSnapshot(queueRow, appointmentId);
      const diffs = diffSnapshots(queueSnapshot, adminSnapshot);

      console.groupCollapsed(`[appointment-consistency] appointment_id=${appointmentId}`);
      console.table([
        { source: "Homepage:/api/appointments/queue", ...queueSnapshot },
        { source: "AdminEdit:/api/admin/appointments/:id", ...adminSnapshot },
      ]);
      if (!queueRow) {
        console.warn(
          `[appointment-consistency] queue row not found for appointment_id=${appointmentId}`
        );
      } else if (diffs.length > 0) {
        console.warn("[appointment-consistency] field mismatches", diffs);
      } else {
        console.info("[appointment-consistency] PASS: fields matched");
      }
      console.groupEnd();

      summary.push({
        appointment_id: appointmentId,
        found_in_queue: Boolean(queueRow),
        mismatches: diffs,
      });
    } catch (error) {
      console.error(
        `[appointment-consistency] debug failed for appointment_id=${appointmentId}`,
        error
      );
      summary.push({
        appointment_id: appointmentId,
        found_in_queue: false,
        mismatches: [{ field: "error", queue: "", admin: normalizeText(error?.message) }],
      });
    }
  }

  console.groupEnd();
  return { ran: true, rows: summary };
}
