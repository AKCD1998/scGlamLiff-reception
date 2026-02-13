import { normalizeDateString } from "./dateFormat";

export function buildCalendarDaySet(days) {
  const set = new Set();
  (days || []).forEach((day) => {
    const key = normalizeDateString(day?.date);
    if (!key) return;
    set.add(key);
  });
  return set;
}
