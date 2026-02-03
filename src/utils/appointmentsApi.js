const base = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

function ensureConfig() {
  if (!base) {
    throw new Error("Missing VITE_API_BASE");
  }
}

export async function appendAppointment(payload) {
  ensureConfig();
  const url = `${base}/api/appointments`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "GAS returned error");
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

export async function deleteAppointmentHard(id) {
  ensureConfig();
  const url = `${base}/api/appointments/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}
