const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5050;
const GAS_URL = process.env.GAS_APPOINTMENTS_URL || "";
const GAS_SECRET = process.env.GAS_SECRET || "";

app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const opts = { ...options, signal: controller.signal };
  return fetch(url, opts).finally(() => clearTimeout(timer));
}

function ensureConfig(res) {
  if (!GAS_URL || !GAS_SECRET) {
    res.status(500).json({ ok: false, error: 'Server missing GAS config' });
    return false;
  }
  return true;
}

app.get('/api/appointments', async (req, res) => {
  if (!ensureConfig(res)) return;
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 500);
  const target = `${GAS_URL}?action=appointments_get&limit=${encodeURIComponent(limit)}&key=${encodeURIComponent(GAS_SECRET)}`;

  try {
    const resp = await fetchWithTimeout(target, { method: 'GET' });
    const data = await resp.json();
    if (!data.ok) {
      return res.status(502).json({ ok: false, error: data.error || 'GAS returned error' });
    }
    return res.json(data);
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : 500;
    return res.status(status).json({ ok: false, error: err.message || 'Upstream error' });
  }
});

app.post('/api/appointments', async (req, res) => {
  if (!ensureConfig(res)) return;
  const required = ['datetime', 'service', 'lineId'];
  for (const field of required) {
    if (!req.body || typeof req.body[field] !== 'string' || !req.body[field].trim()) {
      return res.status(400).json({ ok: false, error: `Missing required field: ${field}` });
    }
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

  const target = `${GAS_URL}?action=appointments_append&key=${encodeURIComponent(GAS_SECRET)}`;

  try {
    const resp = await fetchWithTimeout(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!data.ok) {
      return res.status(502).json({ ok: false, error: data.error || 'GAS returned error' });
    }
    return res.json(data);
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : 500;
    return res.status(status).json({ ok: false, error: err.message || 'Upstream error' });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy API listening on http://localhost:${PORT}`);
});
