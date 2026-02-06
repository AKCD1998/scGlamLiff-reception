import { useMemo } from "react";
import { formatDateKey, normalizeDateString } from "../../utils/dateFormat";

export function useAppointmentsFilter(rows, selectedDate) {
  const activeFilterKey = useMemo(
    () => (selectedDate ? formatDateKey(selectedDate) : ""),
    [selectedDate]
  );

  const filteredRows = useMemo(() => {
    if (!selectedDate) return rows;
    const key = activeFilterKey;
    if (!key) return rows;
    return rows.filter((row) => normalizeDateString(row.date) === key);
  }, [rows, selectedDate, activeFilterKey]);

  const bookingDates = useMemo(() => {
    const seen = new Set();
    const dates = [];

    rows.forEach((row) => {
      const key = normalizeDateString(row.date);
      const parts = key.split("-");
      if (parts.length !== 3) return;

      const [yyyy, mm, dd] = parts.map((p) => Number(p));
      if (!yyyy || !mm || !dd) return;

      const dateObj = new Date(yyyy, mm - 1, dd);
      if (Number.isNaN(dateObj.getTime())) return;

      const stamp = dateObj.toDateString();
      if (seen.has(stamp)) return;

      seen.add(stamp);
      dates.push(dateObj);
    });

    return dates;
  }, [rows]);

  return { activeFilterKey, filteredRows, bookingDates };
}
