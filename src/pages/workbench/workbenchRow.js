function sanitizeDisplayLineId(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text === "__STAFF__" || text === "__BACKDATE__") return "";
  const lowered = text.toLowerCase();
  if (lowered.startsWith("phone:") || lowered.startsWith("sheet:")) return "";
  return text;
}

export function normalizeRow(row = {}) {
  return {
    id: row.id ?? "",
    date: row.date ?? "",
    bookingTime: row.bookingTime ?? "",
    customerName: row.customerName ?? "",
    phone: row.phone ?? "",
    lineId: sanitizeDisplayLineId(row.lineId),
    treatmentItem: row.treatmentItemDisplay ?? row.treatmentItem ?? "",
    treatmentItemDisplay: row.treatmentItemDisplay ?? row.treatmentItem ?? "",
    staffName: row.staffName ?? row.staff_name ?? "",
    datetime: row.datetime ?? "", // backward compatibility for sorting fallback
  };
}

export function getRowTimestamp(row) {
  const combined = row.date && row.bookingTime ? `${row.date} ${row.bookingTime}` : row.datetime;
  const ts = Date.parse(combined);
  return Number.isNaN(ts) ? 0 : ts;
}
