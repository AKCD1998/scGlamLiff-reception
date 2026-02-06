export function normalizeRow(row = {}) {
  return {
    id: row.id ?? "",
    date: row.date ?? "",
    bookingTime: row.bookingTime ?? "",
    customerName: row.customerName ?? "",
    phone: row.phone ?? "",
    lineId: row.lineId ?? "",
    treatmentItem: row.treatmentItem ?? "",
    staffName: row.staffName ?? "",
    datetime: row.datetime ?? "", // backward compatibility for sorting fallback
  };
}

export function getRowTimestamp(row) {
  const combined = row.date && row.bookingTime ? `${row.date} ${row.bookingTime}` : row.datetime;
  const ts = Date.parse(combined);
  return Number.isNaN(ts) ? 0 : ts;
}
