import { getApiBaseUrl } from "./runtimeEnv";

const apiBase = getApiBaseUrl();
const isDev = Boolean(import.meta.env.DEV);

function ensureConfig() {
  if (!apiBase && !isDev) {
    throw new Error("Missing VITE_API_BASE_URL (or legacy VITE_API_BASE)");
  }
}

function buildApiError(res, data, fallbackMessage = "Server returned error") {
  const message =
    data?.message ||
    data?.error ||
    `${fallbackMessage}${res?.status ? ` (status ${res.status})` : ""}`;
  const error = new Error(message);
  if (res && typeof res.status === "number") {
    error.status = res.status;
  }
  error.details = data?.details || null;
  error.response = data || null;
  return error;
}

export async function getMonthlyKpiDashboard({ scope, month, year } = {}, signal) {
  ensureConfig();
  const params = new URLSearchParams();
  if (scope) params.set("scope", scope);
  if (month) params.set("month", month);
  if (year) params.set("year", year);
  const suffix = params.toString();
  const url = `${apiBase}/api/reporting/kpi-dashboard${suffix ? `?${suffix}` : ""}`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw buildApiError(res, data, "KPI dashboard request failed");
  }
  return data;
}
