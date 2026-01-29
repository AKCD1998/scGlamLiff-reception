function pad2(value) {
  return String(value).padStart(2, "0");
}

export function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

export function normalizeDateString(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (raw.includes("-")) {
    const parts = raw.split("-").map((p) => p.trim());
    if (parts.length === 3) {
      const [a, b, c] = parts;
      if (a.length === 4) {
        return `${a}-${pad2(b)}-${pad2(c)}`;
      }
      if (c.length === 4) {
        return `${c}-${pad2(b)}-${pad2(a)}`;
      }
    }
  }
  if (raw.includes("/")) {
    const parts = raw.split("/").map((p) => p.trim());
    if (parts.length === 3) {
      const [a, b, c] = parts;
      if (a.length === 4) {
        return `${a}-${pad2(b)}-${pad2(c)}`;
      }
      if (c.length === 4) {
        return `${c}-${pad2(b)}-${pad2(a)}`;
      }
    }
  }
  return raw;
}

export function isSameDayKey(a, b) {
  return normalizeDateString(a) === normalizeDateString(b);
}

export function parseTimeToMinutes(value) {
  if (!value) return Number.NaN;
  const raw = String(value).toLowerCase().replace(/\s/g, "").replace(/น\.?/g, "");
  const match = raw.match(/(\d{1,2})[:.](\d{2})/);
  if (match) {
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return Number.NaN;
    return hh * 60 + mm;
  }
  const hourOnly = raw.match(/^\d{1,2}$/);
  if (hourOnly) {
    return Number(hourOnly[0]) * 60;
  }
  return Number.NaN;
}

export function parseHHMM(value) {
  return parseTimeToMinutes(value);
}

export function minutesToHHMM(min) {
  if (!Number.isFinite(min)) return "";
  const hh = Math.floor(min / 60);
  const mm = Math.round(min % 60);
  return `${pad2(hh)}:${pad2(mm)}`;
}

export function toIsoDateFromDDMMYYYY(value) {
  if (!value) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  if (raw.includes("-")) {
    const normalized = normalizeDateString(raw);
    if (normalized) return normalized;
  }
  if (raw.includes("/")) {
    const parts = raw.split("/").map((p) => p.trim());
    if (parts.length === 3) {
      const [dd, mm, yyyy] = parts;
      if (yyyy && mm && dd) {
        return `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
      }
    }
  }
  return raw;
}

export function toDmyDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getDate()}/${value.getMonth() + 1}/${value.getFullYear()}`;
  }
  const normalized = normalizeDateString(value);
  if (!normalized) return String(value).trim();
  const parts = normalized.split("-");
  if (parts.length === 3) {
    const [yyyy, mm, dd] = parts.map((p) => Number(p));
    if (yyyy && mm && dd) {
      return `${dd}/${mm}/${yyyy}`;
    }
  }
  return String(value).trim();
}

export function normalizeBookingTime(value) {
  if (!value) return "";
  const minutes = parseTimeToMinutes(value);
  if (Number.isFinite(minutes)) {
    return minutesToHHMM(minutes);
  }
  return String(value).trim();
}

export function buildDailySlots({
  openHHMM = "08:00",
  closeHHMM = "20:00",
  intervalMin = 120,
} = {}) {
  const openMin = parseTimeToMinutes(openHHMM);
  const closeMin = parseTimeToMinutes(closeHHMM);
  if (!Number.isFinite(openMin) || !Number.isFinite(closeMin) || intervalMin <= 0) {
    return [];
  }
  const slots = [];
  for (let t = openMin; t < closeMin; t += intervalMin) {
    slots.push(minutesToHHMM(t));
  }
  return slots;
}

export function buildOccupiedRanges(rowsForDay, cfg) {
  const ranges = [];
  rowsForDay.forEach((row) => {
    const startMin = parseTimeToMinutes(row.bookingTime);
    if (!Number.isFinite(startMin)) return;
    const endMin = startMin + cfg.slotBlockMin;
    ranges.push({ startMin, endMin });
  });
  return ranges;
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

export function isTimeAvailable(candidateMin, occupiedRanges, cfg) {
  const candidateEnd = candidateMin + cfg.slotBlockMin;
  return !occupiedRanges.some((range) =>
    overlaps(candidateMin, candidateEnd, range.startMin, range.endMin)
  );
}

export function getRecommendedSlots({
  selectedDate,
  now = new Date(),
  openHHMM = "08:00",
  closeHHMM = "20:00",
  intervalMin = 120,
  leadTimeMin = 60,
  lastBookingHHMM,
  maxRecommend = 6,
} = {}) {
  const selectedKey = formatDateKey(selectedDate);
  if (!selectedKey) return [];
  const todayKey = formatDateKey(now);
  if (selectedKey < todayKey) return [];

  const openMin = parseTimeToMinutes(openHHMM);
  const closeMin = parseTimeToMinutes(closeHHMM);
  const lastBookingMin = Number.isFinite(parseTimeToMinutes(lastBookingHHMM))
    ? parseTimeToMinutes(lastBookingHHMM)
    : closeMin;
  const minAllowed = isSameDayKey(selectedKey, todayKey)
    ? now.getHours() * 60 + now.getMinutes() + leadTimeMin
    : openMin;

  return buildDailySlots({ openHHMM, closeHHMM, intervalMin })
    .map((slot) => ({ slot, minutes: parseTimeToMinutes(slot) }))
    .filter((item) => Number.isFinite(item.minutes))
    .filter((item) => item.minutes >= minAllowed && item.minutes <= lastBookingMin)
    .map((item) => item.slot)
    .slice(0, maxRecommend);
}

export function getRecommendedSlotsWithAvailability({
  selectedDate,
  now = new Date(),
  rows = [],
  cfg,
} = {}) {
  const selectedKey = formatDateKey(selectedDate);
  if (!selectedKey) return [];
  const todayKey = formatDateKey(now);
  if (selectedKey < todayKey) return [];

  const openMin = parseTimeToMinutes(cfg.open);
  const closeMin = parseTimeToMinutes(cfg.close);
  const lastBookingMin = Number.isFinite(parseTimeToMinutes(cfg.lastBooking))
    ? parseTimeToMinutes(cfg.lastBooking)
    : closeMin;
  const isToday = isSameDayKey(selectedKey, todayKey);
  const minAllowed = isToday
    ? now.getHours() * 60 + now.getMinutes() + cfg.leadTimeMin
    : openMin;

  const rowsForDay = rows.filter(
    (row) => normalizeDateString(row.date) === selectedKey
  );
  const occupiedRanges = buildOccupiedRanges(rowsForDay, cfg);

  return buildDailySlots({
    openHHMM: cfg.open,
    closeHHMM: cfg.close,
    intervalMin: cfg.intervalMin,
  })
    .map((slot) => ({ slot, minutes: parseTimeToMinutes(slot) }))
    .filter((item) => Number.isFinite(item.minutes))
    .filter((item) => item.minutes >= minAllowed)
    .filter((item) => item.minutes <= lastBookingMin)
    .filter((item) => item.minutes + cfg.slotBlockMin <= closeMin)
    .filter((item) => isTimeAvailable(item.minutes, occupiedRanges, cfg))
    .map((item) => item.slot)
    .slice(0, cfg.maxRecommend);
}
