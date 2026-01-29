const GAS_URL = process.env.GAS_APPOINTMENTS_URL || '';
const GAS_SECRET = process.env.GAS_SECRET || '';

function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const opts = { ...options, signal: controller.signal };
  return fetch(url, opts).finally(() => clearTimeout(timer));
}

export function ensureGasConfig() {
  return Boolean(GAS_URL && GAS_SECRET);
}

export async function fetchAppointments(limit) {
  if (!ensureGasConfig()) {
    const err = new Error('Server missing GAS config');
    err.status = 500;
    throw err;
  }

  const target = `${GAS_URL}?action=appointments_get&limit=${encodeURIComponent(
    limit
  )}&key=${encodeURIComponent(GAS_SECRET)}`;

  const resp = await fetchWithTimeout(target, { method: 'GET' });
  const data = await resp.json();

  if (!data.ok) {
    const err = new Error(data.error || 'GAS returned error');
    err.status = 502;
    throw err;
  }

  return data;
}

export async function createAppointmentRecord(payload) {
  if (!ensureGasConfig()) {
    const err = new Error('Server missing GAS config');
    err.status = 500;
    throw err;
  }

  const target = `${GAS_URL}?action=appointments_append&key=${encodeURIComponent(GAS_SECRET)}`;

  const resp = await fetchWithTimeout(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();

  if (!data.ok) {
    const err = new Error(data.error || 'GAS returned error');
    err.status = 502;
    throw err;
  }

  return data;
}

export async function deleteAppointmentHard(id) {
  if (!ensureGasConfig()) {
    const err = new Error('Server missing GAS config');
    err.status = 500;
    throw err;
  }

  const target = `${GAS_URL}?action=appointments_delete_hard&key=${encodeURIComponent(GAS_SECRET)}`;

  const resp = await fetchWithTimeout(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });

  const data = await resp.json();

  if (!data.ok) {
    const err = new Error(data.error || 'GAS returned error');
    err.status = 502;
    throw err;
  }

  return data;
}
