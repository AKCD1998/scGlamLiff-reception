import { normalizeDateString, parseTimeToMinutes } from "../../../utils/bookingTimeUtils";

export function normalizeRow(row = {}) {
  return {
    id: row.id ?? "",
    date: row.date ?? "",
    bookingTime: row.bookingTime ?? "",
    customerName: row.customerName ?? "",
    phone: row.phone ?? "",
    treatmentItem: row.treatmentItem ?? "",
    staffName: row.staffName ?? "",
    datetime: row.datetime ?? "",
    status: row.status ?? "",
    appointmentId: row.appointment_id ?? row.appointmentId ?? "",
    customerId: row.customer_id ?? row.customerId ?? "",
  };
}

export function normalizeCustomerRow(row = {}) {
  return {
    id: row.id ?? "",
    fullName: row.full_name ?? row.fullName ?? "",
    createdAt: row.created_at ?? row.createdAt ?? "",
  };
}

export function shortenId(value) {
  if (!value) return "";
  return String(value).slice(0, 8);
}

export function formatAppointmentStatus(status) {
  const s = String(status || "booked").toLowerCase();
  if (s === "completed") return "ให้บริการแล้ว";
  if (s === "cancelled" || s === "canceled") return "ยกเลิก";
  if (s === "no_show") return "ไม่มา";
  if (s === "rescheduled") return "เลื่อนนัด";
  return "จองแล้ว";
}

export function getRowTimestamp(row) {
  const dateKey = normalizeDateString(row.date);
  if (dateKey) {
    const timeMinutes = parseTimeToMinutes(row.bookingTime);
    if (Number.isFinite(timeMinutes)) {
      const [yyyy, mm, dd] = dateKey.split("-").map((p) => Number(p));
      if (yyyy && mm && dd) {
        const base = new Date(yyyy, mm - 1, dd);
        base.setHours(Math.floor(timeMinutes / 60), timeMinutes % 60, 0, 0);
        return base.getTime();
      }
    }
    const fallback = Date.parse(dateKey);
    if (!Number.isNaN(fallback)) return fallback;
  }
  const dt = Date.parse(row.datetime || "");
  return Number.isNaN(dt) ? 0 : dt;
}

export function normalizeTreatmentOptionRow(row = {}) {
  const value = String(row.value ?? "").trim();
  const label = String(row.label ?? "").trim();
  const treatmentId = String(row.treatment_id ?? row.treatmentId ?? "").trim();
  const treatmentItemText = String(
    row.treatment_item_text ?? row.treatmentItemText ?? label
  ).trim();

  if (!value || !label || !treatmentItemText) return null;

  return {
    value,
    label,
    treatmentId,
    treatmentItemText,
    source: String(row.source ?? "").trim(),
    packageId: String(row.package_id ?? row.packageId ?? "").trim(),
    packageCode: String(row.package_code ?? row.packageCode ?? "").trim(),
    sessionsTotal: Number(row.sessions_total ?? row.sessionsTotal) || 0,
    maskTotal: Number(row.mask_total ?? row.maskTotal) || 0,
    priceThb: Number(row.price_thb ?? row.priceThb) || 0,
  };
}

