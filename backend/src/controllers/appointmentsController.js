import {
  ensureGasConfig,
  fetchAppointments,
  createAppointmentRecord,
} from '../services/gasService.js';

function validatePayload(body) {
  const required = ['datetime', 'service', 'lineId'];
  for (const field of required) {
    if (!body || typeof body[field] !== 'string' || !body[field].trim()) {
      return field;
    }
  }
  return null;
}

export async function listAppointments(req, res) {
  if (!ensureGasConfig()) {
    return res.status(500).json({ ok: false, error: 'Server missing GAS config' });
  }

  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 500);

  try {
    const data = await fetchAppointments(limit);
    return res.json(data);
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : err.status || 500;
    return res.status(status).json({ ok: false, error: err.message || 'Upstream error' });
  }
}

export async function createAppointment(req, res) {
  if (!ensureGasConfig()) {
    return res.status(500).json({ ok: false, error: 'Server missing GAS config' });
  }

  const missingField = validatePayload(req.body);
  if (missingField) {
    return res.status(400).json({ ok: false, error: `Missing required field: ${missingField}` });
  }

  const payload = {
    datetime: req.body.datetime,
    service: req.body.service,
    lineId: req.body.lineId,
    scrub: req.body.scrub ?? '',
    facialMask: req.body.facialMask ?? '',
    misting: req.body.misting ?? '',
    extra: req.body.extra ?? '',
    note: req.body.note ?? '',
  };

  try {
    const data = await createAppointmentRecord(payload);
    return res.json(data);
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : err.status || 500;
    return res.status(status).json({ ok: false, error: err.message || 'Upstream error' });
  }
}
