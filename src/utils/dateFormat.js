export function pad2(value) {
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