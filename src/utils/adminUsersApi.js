const base = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

function ensureConfig() {
  if (!base) {
    throw new Error("Missing VITE_API_BASE");
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

