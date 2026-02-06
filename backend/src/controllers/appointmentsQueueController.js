import { query } from '../db.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export async function listAppointmentsQueue(req, res) {
  const date = normalizeText(req.query?.date);
  const branchId = normalizeText(req.query?.branch_id);
  const limit = parseLimit(req.query?.limit);

  if (!date) {
    return res.status(400).json({ ok: false, error: 'Missing required query: date (YYYY-MM-DD)' });
  }
  if (!DATE_PATTERN.test(date)) {
    return res.status(400).json({ ok: false, error: 'Invalid date format. Use YYYY-MM-DD' });
  }
  if (!branchId) {
    return res.status(400).json({ ok: false, error: 'Missing required query: branch_id' });
  }

  try {
    const { rows } = await query(
      `
        SELECT
          a.id,
          a.scheduled_at AS scheduled_at,
          COALESCE(TO_CHAR(a.scheduled_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'), '') AS date,
          COALESCE(TO_CHAR(a.scheduled_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI'), '') AS "bookingTime",
          COALESCE(a.status, '') AS status,
          COALESCE(c.full_name, '') AS "customerName",
          COALESCE(NULLIF(ci_phone.provider_user_id, ''), '') AS phone
        FROM appointments a
        LEFT JOIN customers c ON a.customer_id = c.id
        LEFT JOIN LATERAL (
          SELECT provider_user_id
          FROM customer_identities
          WHERE customer_id = c.id AND provider = 'PHONE'
          ORDER BY is_active DESC, created_at DESC
          LIMIT 1
        ) ci_phone ON true
        WHERE a.branch_id = $2
          AND DATE(a.scheduled_at AT TIME ZONE 'Asia/Bangkok') = $1
          AND LOWER(COALESCE(a.status, '')) NOT IN ('cancelled', 'canceled')
        ORDER BY a.scheduled_at ASC
        LIMIT $3
      `,
      [date, branchId, limit]
    );

    return res.json({ ok: true, rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

