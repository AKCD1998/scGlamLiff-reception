import { query } from '../db.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const DEFAULT_EXCLUDED_STATUSES = new Set(['cancelled', 'canceled', 'no_show']);
const DEBUG_PHONE_FRAGMENT = String(process.env.DEBUG_QUEUE_PHONE_FRAGMENT || '').replace(/\D+/g, '');

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function sanitizeThaiPhone(value) {
  const digits = normalizeText(value).replace(/\D+/g, '');
  if (!digits) return '';

  if (digits.startsWith('66') && digits.length === 11) {
    return `0${digits.slice(-9)}`;
  }

  if (digits.length === 10 && digits.startsWith('0')) {
    return digits;
  }

  if (digits.length === 9 && !digits.startsWith('0')) {
    return `0${digits}`;
  }

  return '';
}

export async function listAppointmentsQueue(req, res) {
  const date = normalizeText(req.query?.date);
  const branchId = normalizeText(req.query?.branch_id);
  const limit = parseLimit(req.query?.limit);

  if (date && !DATE_PATTERN.test(date)) {
    return res.status(400).json({ ok: false, error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  try {
    const params = [];
    const whereParts = [];

    // Default: hide cancelled/no_show from the operational queue.
    const excluded = [...DEFAULT_EXCLUDED_STATUSES];
    whereParts.push(
      `LOWER(COALESCE(a.status, '')) NOT IN (${excluded.map((_, i) => `$${i + 1}`).join(', ')})`
    );
    params.push(...excluded);

    if (branchId) {
      params.push(branchId);
      whereParts.push(`a.branch_id = $${params.length}`);
    }

    if (date) {
      params.push(date);
      whereParts.push(`DATE(a.scheduled_at AT TIME ZONE 'Asia/Bangkok') = $${params.length}`);
    }

    params.push(limit);
    const limitParam = `$${params.length}`;

    const orderBy = date ? 'a.scheduled_at ASC' : 'a.scheduled_at DESC';

    const { rows } = await query(
      `
        SELECT
          a.id,
          a.id AS appointment_id,
          a.scheduled_at AS scheduled_at,
          a.status AS status,
          a.branch_id AS branch_id,
          a.treatment_id AS treatment_id,
          a.customer_id AS customer_id,
          a.raw_sheet_uuid AS raw_sheet_uuid,
          COALESCE(TO_CHAR(a.scheduled_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD'), '') AS date,
          COALESCE(TO_CHAR(a.scheduled_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI'), '') AS "bookingTime",
          COALESCE(c.full_name, '') AS customer_full_name,
          COALESCE(c.full_name, '') AS "customerName",
          COALESCE(
            NULLIF(ci_phone.provider_user_id, ''),
            CASE
              WHEN a.line_user_id LIKE 'phone:%' THEN SUBSTRING(a.line_user_id FROM 7)
              ELSE ''
            END
          ) AS phone,
          COALESCE(
            NULLIF(ci_line.provider_user_id, ''),
            NULLIF(ci_email.provider_user_id, ''),
            NULLIF(a.line_user_id, ''),
            ''
          ) AS "lineId",
          COALESCE(
            NULLIF(t.title_th, ''),
            NULLIF(t.title_en, ''),
            NULLIF(t.code, ''),
            ''
          ) AS treatment_name,
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
          WHERE customer_id = c.id AND provider = 'PHONE' AND is_active = true
          ORDER BY created_at DESC
          LIMIT 1
        ) ci_phone ON true
        LEFT JOIN LATERAL (
          SELECT provider_user_id
          FROM customer_identities
          WHERE customer_id = c.id AND provider = 'LINE' AND is_active = true
          ORDER BY created_at DESC
          LIMIT 1
        ) ci_line ON true
        LEFT JOIN LATERAL (
          SELECT provider_user_id
          FROM customer_identities
          WHERE customer_id = c.id AND provider = 'EMAIL' AND is_active = true
          ORDER BY created_at DESC
          LIMIT 1
        ) ci_email ON true
        ${whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''}
        ORDER BY ${orderBy}
        LIMIT ${limitParam}
      `,
      params
    );

    const normalizedRows = rows.map((row) => {
      const rawPhone = normalizeText(row.phone);
      const normalizedPhone = sanitizeThaiPhone(rawPhone);

      if (DEBUG_PHONE_FRAGMENT) {
        const rawDigits = rawPhone.replace(/\D+/g, '');
        const normalizedDigits = normalizedPhone.replace(/\D+/g, '');
        if (rawDigits.includes(DEBUG_PHONE_FRAGMENT) || normalizedDigits.includes(DEBUG_PHONE_FRAGMENT)) {
          console.log(
            `[appointmentsQueue] phone_trace raw_sheet_uuid=${row.raw_sheet_uuid || ''} customer="${normalizeText(row.customer_full_name || row.customerName)}" raw_phone="${rawPhone}" normalized_phone="${normalizedPhone}"`
          );
        }
      }

      return {
        ...row,
        phone: normalizedPhone,
      };
    });

    return res.json({ ok: true, rows: normalizedRows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

