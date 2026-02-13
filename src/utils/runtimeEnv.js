function normalizeBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  const primary = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  if (primary) return primary;
  return normalizeBaseUrl(import.meta.env.VITE_API_BASE);
}
