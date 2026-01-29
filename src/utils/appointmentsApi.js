const base = import.meta.env.VITE_API_BASE;

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
  const url = `${base}/api/appointments?limit=${limit}`;
  const res = await fetch(url, { method: "GET", signal });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "GAS returned error");
  }
  return data;
}

export async function deleteAppointmentHard(id) {
  ensureConfig();
  const url = `${base}/api/appointments/delete-hard`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "GAS returned error");
  }
  return data;
}
