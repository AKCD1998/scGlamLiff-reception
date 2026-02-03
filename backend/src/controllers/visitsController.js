import { query } from '../db.js';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = new Set(['sheet', 'appointments']);

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export async function listVisits(req, res) {
  const { date } = req.query;
  const sourceRaw = typeof req.query.source === 'string' ? req.query.source.trim() : '';
  const source = SOURCES.has(sourceRaw) ? sourceRaw : 'sheet';
  const limit = parseLimit(req.query.limit);

  if (date && !DATE_PATTERN.test(date)) {
    return res.status(400).json({ ok: false, error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  try {
    const params = [];

    if (source === 'sheet') {
      if (date) {
        params.push(date);
      }
      params.push(limit);

      const whereSql = date ? `WHERE visit_date = $1` : '';
      const limitParam = `$${params.length}`;

      const { rows } = await query(
        `
          SELECT
            COALESCE(TO_CHAR(visit_date, 'YYYY-MM-DD'), '') AS date,
            COALESCE(visit_time_text, '') AS "bookingTime",
            COALESCE(customer_full_name, '') AS "customerName",
            COALESCE(phone_raw, '') AS phone,
            COALESCE(email_or_lineid, '') AS "lineId",
            COALESCE(treatment_item_text, '') AS "treatmentItem",
            COALESCE(NULLIF(staff_name, ''), '-') AS "staffName",
            sheet_uuid::text AS id
          FROM public.sheet_visits_raw
          ${whereSql}
          ORDER BY visit_date DESC, visit_time_text DESC, imported_at DESC
          LIMIT ${limitParam}
        `,
        params
      );

      return res.json({ ok: true, rows });
    }

    const whereParts = ["LOWER(COALESCE(a.status, '')) NOT IN ('cancelled', 'canceled')"];

    if (date) {
      params.push(date);
      whereParts.push(`DATE(a.scheduled_at AT TIME ZONE 'Asia/Bangkok') = $${params.length}`);
    }

    params.push(limit);

    // Shape rows for the homepage table by joining appointments with customers and identities.
    const { rows } = await query(
      `
        SELECT
          a.id,
          COALESCE(TO_CHAR(a.scheduled_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'), '') AS date,
          COALESCE(TO_CHAR(a.scheduled_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI'), '') AS "bookingTime",
          COALESCE(c.full_name, '') AS "customerName",
          COALESCE(NULLIF(ci_phone.provider_user_id, ''), '') AS phone,
          COALESCE(
            NULLIF(ci_line.provider_user_id, ''),
            NULLIF(a.line_user_id, ''),
            ''
          ) AS "lineId",
          COALESCE(
            NULLIF(t.title_th, ''),
            NULLIF(t.title_en, ''),
            NULLIF(t.code, ''),
            ''
          ) AS "treatmentItem",
          '-' AS "staffName"
        FROM appointments a
        LEFT JOIN customers c ON a.customer_id = c.id
        LEFT JOIN treatments t ON a.treatment_id = t.id
        LEFT JOIN LATERAL (
          SELECT provider_user_id
          FROM customer_identities
          WHERE customer_id = c.id AND provider = 'PHONE'
          ORDER BY is_active DESC, created_at DESC
          LIMIT 1
        ) ci_phone ON true
        LEFT JOIN LATERAL (
          SELECT provider_user_id
          FROM customer_identities
          WHERE customer_id = c.id AND provider = 'LINE'
          ORDER BY is_active DESC, created_at DESC
          LIMIT 1
        ) ci_line ON true
        WHERE ${whereParts.join(' AND ')}
        ORDER BY a.scheduled_at DESC
        LIMIT $${params.length}
      `,
      params
    );

    return res.json({ ok: true, rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}
