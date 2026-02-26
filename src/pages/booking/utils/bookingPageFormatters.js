import { normalizeDateString, parseTimeToMinutes } from "../../../utils/bookingTimeUtils";

export function normalizeRow(row = {}) {
  const appointmentId = row.appointment_id ?? row.appointmentId ?? row.id ?? "";
  const smoothSessionsTotal = Number(row.smooth_sessions_total ?? row.smoothSessionsTotal) || 0;
  const smoothSessionsUsed = Number(row.smooth_sessions_used ?? row.smoothSessionsUsed) || 0;
  const smoothSessionsRemaining = Math.max(smoothSessionsTotal - smoothSessionsUsed, 0);
  const smoothPackageStatus = String(
    row.smooth_customer_package_status ?? row.smoothCustomerPackageStatus ?? ""
  )
    .trim()
    .toLowerCase();
  const hasContinuousCourseRaw =
    row.has_continuous_course ??
    row.hasContinuousCourse ??
    (Boolean(row.smooth_customer_package_id ?? row.smoothCustomerPackageId) &&
      smoothSessionsRemaining > 0 &&
      (smoothPackageStatus === "active" || smoothPackageStatus === ""));

  return {
    // Canonical UI identity: appointment_id only (never raw_sheet_uuid).
    id: appointmentId,
    date: row.date ?? "",
    bookingTime: row.bookingTime ?? "",
    customerName: row.customerName ?? "",
    phone: row.phone ?? "",
    treatmentItem: row.treatment_item_text ?? row.treatmentItem ?? "",
    staffName: row.staffName ?? "",
    datetime: row.datetime ?? "",
    status: row.status ?? "",
    appointmentId,
    appointment_id: appointmentId,
    customerId: row.customer_id ?? row.customerId ?? "",
    treatmentPlanMode:
      row.treatment_plan_mode ?? row.treatmentPlanMode ?? "",
    treatmentPlanPackageId:
      row.treatment_plan_package_id ?? row.treatmentPlanPackageId ?? "",
    smoothCustomerPackageId:
      row.smooth_customer_package_id ?? row.smoothCustomerPackageId ?? "",
    smoothCustomerPackageStatus: smoothPackageStatus,
    smoothSessionsTotal,
    smoothSessionsUsed,
    smoothSessionsRemaining,
    hasContinuousCourse: Boolean(hasContinuousCourseRaw),
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
  const raw = String(status ?? "").trim();
  const s = raw.toLowerCase();

  if (!s || s === "booked") return "จองแล้ว";
  if (s === "completed") return "ให้บริการแล้ว";
  if (s === "no_show" || s === "no-show" || s === "noshow") {
    return "ลูกค้าไม่มารับบริการ";
  }
  if (s === "cancelled" || s === "canceled") return "ยกเลิกการจอง";
  if (s === "ensured" || s === "confirmed") return "ยืนยันแล้ว";
  if (s === "pending") return "รอยืนยัน";
  if (s === "in_progress" || s === "in-progress") return "กำลังให้บริการ";
  if (s === "rescheduled") return "เลื่อนนัด";
  if (s === "check_in" || s === "checked_in") return "เช็กอินแล้ว";

  return raw ? `ไม่ทราบสถานะ (${raw})` : "ไม่ทราบสถานะ";
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
