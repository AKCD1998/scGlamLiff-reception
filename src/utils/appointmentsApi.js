import { getApiBaseUrl } from "./runtimeEnv";

const base = getApiBaseUrl();
const shouldLogApiBase =
  import.meta.env.DEV ||
  String(import.meta.env.VITE_LOG_API_BASE || "").trim().toLowerCase() === "true";

if (typeof window !== "undefined" && shouldLogApiBase) {
  console.info(`[appointmentsApi] VITE_API_BASE_URL=${base || "(missing)"}`);
}

function ensureConfig() {
  if (!base) {
    throw new Error("Missing VITE_API_BASE_URL (or legacy VITE_API_BASE)");
  }
}

export async function appendAppointment(payload, options = {}) {
  ensureConfig();
  const bodyPayload = { ...(payload || {}) };
  if (options?.override !== undefined) {
    bodyPayload.override = options.override;
  }
  const url = `${base}/api/appointments`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(bodyPayload),
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
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  const url = `${base}/api/visits?${params.toString()}`;
  const res = await fetch(url, { method: "GET", signal });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

export async function getAppointmentsByDate(date, limit = 200, signal) {
  ensureConfig();
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (date) {
    params.set("date", date);
  }
  const url = `${base}/api/visits?${params.toString()}`;
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

export async function getCustomerProfile(customerId, signal) {
  ensureConfig();
  if (!customerId) {
    throw new Error("Missing customer id");
  }
  const url = `${base}/api/customers/${encodeURIComponent(customerId)}/profile`;
  const res = await fetch(url, { method: "GET", signal });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

export async function ensureAppointmentFromSheet(sheetUuid, signal) {
  ensureConfig();
  if (!sheetUuid) {
    throw new Error("Missing sheet UUID");
  }
  const url = `${base}/api/appointments/from-sheet/${encodeURIComponent(sheetUuid)}/ensure`;
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    signal,
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

async function postAppointmentAction(path, payload, signal) {
  ensureConfig();
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal,
    body: payload ? JSON.stringify(payload) : "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

export async function completeService(appointmentId, payload, signal) {
  if (!appointmentId) throw new Error("Missing appointment id");
  return postAppointmentAction(
    `/api/appointments/${encodeURIComponent(appointmentId)}/complete`,
    payload,
    signal
  );
}

export async function syncAppointmentCourse(appointmentId, signal) {
  if (!appointmentId) throw new Error("Missing appointment id");
  return postAppointmentAction(
    `/api/appointments/${encodeURIComponent(appointmentId)}/sync-course`,
    null,
    signal
  );
}

export async function cancelService(appointmentId, signal) {
  if (!appointmentId) throw new Error("Missing appointment id");
  return postAppointmentAction(
    `/api/appointments/${encodeURIComponent(appointmentId)}/cancel`,
    null,
    signal
  );
}

export async function cancelAppointment(appointmentId, note = "", signal) {
  if (!appointmentId) throw new Error("Missing appointment id");
  const payload = note ? { note } : {};
  return postAppointmentAction(
    `/api/appointments/${encodeURIComponent(appointmentId)}/cancel`,
    payload,
    signal
  );
}

export async function noShowService(appointmentId, signal) {
  if (!appointmentId) throw new Error("Missing appointment id");
  return postAppointmentAction(
    `/api/appointments/${encodeURIComponent(appointmentId)}/no-show`,
    null,
    signal
  );
}

export async function revertService(appointmentId, signal) {
  if (!appointmentId) throw new Error("Missing appointment id");
  return postAppointmentAction(
    `/api/appointments/${encodeURIComponent(appointmentId)}/revert`,
    null,
    signal
  );
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

export async function adminBackdate(payload, signal) {
  ensureConfig();
  const url = `${base}/api/appointments/admin/backdate`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal,
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

export async function getAdminAppointmentById(appointmentId, signal) {
  ensureConfig();
  if (!appointmentId) throw new Error("Missing appointment id");
  const url = `${base}/api/admin/appointments/${encodeURIComponent(appointmentId)}`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

export async function patchAdminAppointment(appointmentId, payload, signal) {
  ensureConfig();
  if (!appointmentId) throw new Error("Missing appointment id");
  const url = `${base}/api/admin/appointments/${encodeURIComponent(appointmentId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal,
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

export async function getAppointmentsQueue({ date, branchId, limit = 200 } = {}, signal) {
  ensureConfig();
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (branchId) params.set("branch_id", branchId);
  params.set("limit", String(limit));
  const url = `${base}/api/appointments/queue?${params.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}

export async function getBookingTreatmentOptions(signal) {
  ensureConfig();
  const url = `${base}/api/appointments/booking-options`;
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Server returned error");
  }
  return data;
}
