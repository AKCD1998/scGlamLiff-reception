import { resolveTreatmentDisplay } from "../../utils/treatmentDisplay";

function sanitizeDisplayLineId(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text === "__STAFF__" || text === "__BACKDATE__") return "";
  const lowered = text.toLowerCase();
  if (lowered.startsWith("phone:") || lowered.startsWith("sheet:")) return "";
  return text;
}

export function normalizeRow(row = {}) {
  const appointmentId = row.appointment_id ?? row.appointmentId ?? row.id ?? "";
  const treatmentResolution = resolveTreatmentDisplay({
    treatmentId: row.treatment_id ?? row.treatmentId ?? "",
    treatmentName: row.treatment_name ?? row.treatmentName ?? "",
    treatmentNameEn: row.treatment_name_en ?? row.treatmentNameEn ?? "",
    treatmentNameTh: row.treatment_name_th ?? row.treatmentNameTh ?? "",
    treatmentCode: row.treatment_code ?? row.treatmentCode ?? "",
    treatmentSessions: row.treatment_sessions ?? row.treatmentSessions ?? 1,
    treatmentMask: row.treatment_mask ?? row.treatmentMask ?? 0,
    treatmentPrice: row.treatment_price ?? row.treatmentPrice ?? null,
    legacyText:
      row.treatment_display ??
      row.treatmentDisplay ??
      row.treatment_item_text ??
      row.treatmentItem ??
      row.treatmentItemDisplay ??
      "",
  });
  const treatmentDisplay =
    row.treatment_display ?? row.treatmentDisplay ?? treatmentResolution.treatment_display;

  return {
    // Canonical UI identity: always appointment_id (appointments.id UUID).
    id: appointmentId,
    appointmentId,
    appointment_id: appointmentId,
    date: row.date ?? "",
    bookingTime: row.bookingTime ?? "",
    customerName: row.customerName ?? "",
    phone: row.phone ?? "",
    lineId: sanitizeDisplayLineId(row.lineId),
    // Homepage table reads canonical queue field treatment_display.
    treatmentItem: treatmentDisplay,
    treatmentDisplay,
    treatment_display: treatmentDisplay,
    treatmentDisplaySource:
      row.treatment_display_source ??
      row.treatmentDisplaySource ??
      treatmentResolution.treatment_display_source ??
      "",
    treatmentItemDisplay: treatmentDisplay,
    staffName: row.staffName ?? row.staff_name ?? "",
    datetime: row.datetime ?? "", // backward compatibility for sorting fallback
    treatmentPlanMode:
      row.treatment_plan_mode ?? row.treatmentPlanMode ?? "",
    treatmentPlanPackageId:
      row.treatment_plan_package_id ?? row.treatmentPlanPackageId ?? "",
  };
}

export function getRowTimestamp(row) {
  const combined = row.date && row.bookingTime ? `${row.date} ${row.bookingTime}` : row.datetime;
  const ts = Date.parse(combined);
  return Number.isNaN(ts) ? 0 : ts;
}
