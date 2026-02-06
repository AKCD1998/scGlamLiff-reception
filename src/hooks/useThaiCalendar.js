import { useMemo } from "react";

export const thaiMonths = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

export function toBuddhistYear(yearAD) {
  return yearAD + 543;
}

export function formatThaiMonthYear(date) {
  const monthName = thaiMonths[date.getMonth()];
  const yearTH = toBuddhistYear(date.getFullYear());
  return `${monthName} ${yearTH}`;
}

export function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function useThaiCalendar(displayMonth) {
  const monthLabel = useMemo(() => formatThaiMonthYear(displayMonth), [displayMonth]);

  const yearRange = useMemo(() => {
    const baseYear = new Date().getFullYear();
    return Array.from({ length: 21 }, (_, i) => baseYear - 10 + i);
  }, []);

  return { monthLabel, yearRange, thaiMonths, toBuddhistYear, addMonths };
}
