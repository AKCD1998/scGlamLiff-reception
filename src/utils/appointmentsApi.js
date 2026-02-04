const base = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

function ensureConfig() {
  if (!base) {
    throw new Error("Missing VITE_API_BASE");
  }
}

export async function appendAppointment(payload) {
  ensureConfig();
  const url = `${base}/api/visits`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

export async function getAppointments(limit = 200, signal) {
  ensureConfig();
  // Frontend table reads visit rows from backend /api/visits (Postgres).
  const url = `${base}/api/visits?limit=${limit}`;
  const res = await fetch(url, { method: "GET", signal });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

export async function getCustomers(signal) {
  ensureConfig();
  const url = `${base}/api/customers`;
  const res = await fetch(url, { method: "GET", signal });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

export async function deleteSheetVisit(id, pin, reason = "") {
  ensureConfig();
  const url = `${base}/api/sheet-visits/${encodeURIComponent(id)}/delete`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ pin, reason }),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}
