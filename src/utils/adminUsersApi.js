import { getApiBaseUrl } from "./runtimeEnv";

const base = getApiBaseUrl();

function ensureConfig() {
  if (!base) {
    throw new Error("Missing VITE_API_BASE_URL (or legacy VITE_API_BASE)");
  }
}

export async function createStaffUser(payload) {
  ensureConfig();
  const url = `${base}/api/admin/staff-users`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const message = data?.error || "Server returned error";
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function listStaffUsers() {
  ensureConfig();
  const url = `${base}/api/admin/staff-users`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const message = data?.error || "Server returned error";
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function patchStaffUser(id, payload) {
  ensureConfig();
  if (!id) {
    throw new Error("Missing user id");
  }
  const url = `${base}/api/admin/staff-users/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const message = data?.error || "Server returned error";
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return data;
}
