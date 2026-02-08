import { query } from '../db.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const DEFAULT_EXCLUDED_STATUSES = new Set(['cancelled', 'canceled', 'no_show']);
const DEBUG_PHONE_FRAGMENT = String(process.env.DEBUG_QUEUE_PHONE_FRAGMENT || '').replace(/\D+/g, '');
const SMOOTH_CODE = 'smooth';

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function toInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.trunc(parsed);
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

function sanitizeDisplayLineId(value) {
  const text = normalizeText(value);
  if (!text) return '';

  if (text === '__STAFF__' || text === '__BACKDATE__') {
    return '';
  }

  const lowered = text.toLowerCase();
  if (lowered.startsWith('phone:') || lowered.startsWith('sheet:')) {
    return '';
  }

  return text;
}

function getTreatmentTitle(row) {
  return (
    normalizeText(row.treatment_item_text_override) ||
    normalizeText(row.treatment_name) ||
    normalizeText(row.treatmentItem) ||
    normalizeText(row.treatment_title_en) ||
    normalizeText(row.treatment_code)
  );
}

function buildTreatmentItemDisplay(row) {
  const fallback = getTreatmentTitle(row);
  const treatmentCode = normalizeText(row.treatment_code).toLowerCase();
  if (treatmentCode !== SMOOTH_CODE) {
    return fallback;
  }

  const totalSessions = Math.max(0, toInt(row.smooth_sessions_total));
  const maskTotal = Math.max(0, toInt(row.smooth_mask_total));
  const usedMask = Math.max(0, toInt(row.smooth_mask_used));
  const price = Math.max(0, toInt(row.smooth_price_thb));
  const courseName = price > 0 ? `Smooth (${price})` : 'Smooth';

  if (totalSessions <= 1) {
    return `1/1 ${courseName} | Mask 0/0`;
  }

  const usedSessions = Math.max(0, toInt(row.smooth_sessions_used));

  return `${usedSessions}/${totalSessions} ${courseName} | Mask ${Math.min(usedMask, maskTotal)}/${maskTotal}`;
}

function formatSmoothPackageLabel(pkgRow) {
  const sessions = Math.max(0, toInt(pkgRow.sessions_total));
  const masks = Math.max(0, toInt(pkgRow.mask_total));
  const price = Math.max(0, toInt(pkgRow.price_thb));
  const priceText = price > 0 ? ` (${price})` : '';

  if (sessions > 1) {
    return `${sessions}x Smooth${priceText} | Mask ${masks}`;
  }
  return `Smooth${priceText}`;
}

function mapTreatmentToOption(row) {
  const treatmentId = normalizeText(row.id);
  const title =
    normalizeText(row.title_th) ||
    normalizeText(row.title_en) ||
    normalizeText(row.code) ||
    'Treatment';

  return {
    value: `treatment:${treatmentId}`,
    label: title,
    source: 'treatment',
    treatment_id: treatmentId,
    treatment_item_text: title,
  };
}

export async function listBookingTreatmentOptions(req, res) {
  try {
    const treatmentResult = await query(
      `
        SELECT
          id,
          code,
          title_th,
          title_en,
          is_active
        FROM treatments
        WHERE is_active = true
        ORDER BY code ASC, created_at ASC
      `
    );

    const treatments = treatmentResult.rows || [];
    const options = [];

    const smoothTreatment = treatments.find(
      (row) => normalizeText(row.code).toLowerCase() === SMOOTH_CODE
    );

    if (smoothTreatment) {
      const packageResult = await query(
        `
          SELECT
            id,
            code,
            title,
            sessions_total,
            mask_total,
            price_thb
          FROM packages
          WHERE LOWER(COALESCE(code, '')) LIKE 'smooth%'
          ORDER BY sessions_total ASC, price_thb ASC, title ASC
        `
      );

      for (const pkg of packageResult.rows || []) {
        const value = normalizeText(pkg.id);
        if (!value) continue;
        const label = formatSmoothPackageLabel(pkg);
        options.push({
          value: `package:${value}`,
          label,
          source: 'package',
          treatment_id: smoothTreatment.id,
          treatment_item_text: normalizeText(pkg.title) || label,
          package_id: value,
          package_code: normalizeText(pkg.code),
          sessions_total: Math.max(0, toInt(pkg.sessions_total)),
          mask_total: Math.max(0, toInt(pkg.mask_total)),
          price_thb: Math.max(0, toInt(pkg.price_thb)),
        });
      }

      if (!options.some((option) => option.source === 'package')) {
        options.push(mapTreatmentToOption(smoothTreatment));
      }
    }

    for (const treatment of treatments) {
      if (normalizeText(treatment.code).toLowerCase() === SMOOTH_CODE) continue;
      options.push(mapTreatmentToOption(treatment));
    }

    return res.json({ ok: true, options });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
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
          COALESCE(NULLIF(t.code, ''), '') AS treatment_code,
          COALESCE(NULLIF(t.title_en, ''), '') AS treatment_title_en,
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
          CASE
            WHEN COALESCE(contact_evt.has_email_or_lineid, false)
              THEN COALESCE(NULLIF(contact_evt.email_or_lineid_raw, ''), '')
            ELSE COALESCE(
              NULLIF(ci_line.provider_user_id, ''),
              NULLIF(ci_email.provider_user_id, ''),
              CASE
                WHEN COALESCE(a.line_user_id, '') IN ('__STAFF__', '__BACKDATE__') THEN ''
                WHEN a.line_user_id LIKE 'phone:%' THEN ''
                WHEN a.line_user_id LIKE 'sheet:%' THEN ''
                ELSE COALESCE(NULLIF(a.line_user_id, ''), '')
              END,
              ''
            )
          END AS "lineId",
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
          COALESCE(NULLIF(plan_evt.treatment_item_text, ''), '') AS treatment_item_text_override,
          COALESCE(NULLIF(plan_evt.treatment_plan_mode, ''), '') AS treatment_plan_mode,
          COALESCE(NULLIF(plan_evt.package_id, ''), '') AS treatment_plan_package_id,
          COALESCE(pu_current.customer_package_id, NULL) AS smooth_usage_customer_package_id,
          COALESCE(pkg_ctx.customer_package_id, NULL) AS smooth_customer_package_id,
          COALESCE(
            pkg_ctx.sessions_total,
            CASE
              WHEN LOWER(COALESCE(plan_evt.treatment_plan_mode, '')) = 'package'
                THEN plan_pkg.sessions_total
              WHEN LOWER(COALESCE(plan_evt.treatment_plan_mode, '')) = 'one_off'
                THEN 1
              ELSE NULL
            END,
            smooth_default.sessions_total,
            0
          ) AS smooth_sessions_total,
          COALESCE(
            pkg_ctx.mask_total,
            CASE
              WHEN LOWER(COALESCE(plan_evt.treatment_plan_mode, '')) = 'package'
                THEN plan_pkg.mask_total
              WHEN LOWER(COALESCE(plan_evt.treatment_plan_mode, '')) = 'one_off'
                THEN 0
              ELSE NULL
            END,
            smooth_default.mask_total,
            0
          ) AS smooth_mask_total,
          COALESCE(
            pkg_ctx.price_thb,
            CASE
              WHEN LOWER(COALESCE(plan_evt.treatment_plan_mode, '')) = 'package'
                THEN plan_pkg.price_thb
              ELSE NULL
            END,
            smooth_default.price_thb,
            0
          ) AS smooth_price_thb,
          COALESCE(pkg_usage.sessions_used, 0) AS smooth_sessions_used,
          COALESCE(pkg_usage.mask_used, 0) AS smooth_mask_used,
          '-' AS "staffName"
        FROM appointments a
        LEFT JOIN customers c ON a.customer_id = c.id
        LEFT JOIN treatments t ON a.treatment_id = t.id
        LEFT JOIN LATERAL (
          SELECT
            p.sessions_total,
            p.mask_total,
            p.price_thb
          FROM packages p
          WHERE LOWER(COALESCE(p.code, '')) LIKE 'smooth%'
            AND COALESCE(p.sessions_total, 0) = 1
          ORDER BY p.price_thb ASC NULLS LAST, p.id ASC
          LIMIT 1
        ) smooth_default ON true
        LEFT JOIN LATERAL (
          SELECT
            pu.customer_package_id,
            pu.used_mask
          FROM package_usages pu
          WHERE pu.appointment_id = a.id
          ORDER BY pu.used_at DESC NULLS LAST, pu.id DESC
          LIMIT 1
        ) pu_current ON true
        LEFT JOIN LATERAL (
          SELECT
            cp.id AS customer_package_id
          FROM customer_packages cp
          JOIN packages p ON p.id = cp.package_id
          WHERE cp.customer_id = c.id
            AND LOWER(COALESCE(cp.status, '')) = 'active'
            AND LOWER(COALESCE(p.code, '')) LIKE 'smooth%'
          ORDER BY cp.purchased_at DESC NULLS LAST, cp.id DESC
          LIMIT 1
        ) smooth_pkg ON true
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              NULLIF(ae.meta->'after'->>'treatment_item_text', ''),
              NULLIF(ae.meta->>'treatment_item_text', '')
            ) AS treatment_item_text,
            COALESCE(
              NULLIF(ae.meta->'after'->>'treatment_plan_mode', ''),
              NULLIF(ae.meta->>'treatment_plan_mode', '')
            ) AS treatment_plan_mode,
            COALESCE(
              NULLIF(ae.meta->'after'->>'package_id', ''),
              NULLIF(ae.meta->>'package_id', '')
            ) AS package_id
          FROM appointment_events ae
          WHERE ae.appointment_id = a.id
            AND (
              COALESCE(ae.meta->'after', '{}'::jsonb) ? 'treatment_item_text'
              OR ae.meta ? 'treatment_item_text'
              OR COALESCE(ae.meta->'after', '{}'::jsonb) ? 'treatment_plan_mode'
              OR ae.meta ? 'treatment_plan_mode'
              OR COALESCE(ae.meta->'after', '{}'::jsonb) ? 'package_id'
              OR ae.meta ? 'package_id'
            )
          ORDER BY ae.event_at DESC NULLS LAST, ae.id DESC
          LIMIT 1
        ) plan_evt ON true
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(
              ae.meta->'after'->>'email_or_lineid',
              ae.meta->>'email_or_lineid'
            ) AS email_or_lineid_raw,
            (
              COALESCE(ae.meta->'after', '{}'::jsonb) ? 'email_or_lineid'
              OR ae.meta ? 'email_or_lineid'
            ) AS has_email_or_lineid
          FROM appointment_events ae
          WHERE ae.appointment_id = a.id
            AND (
              COALESCE(ae.meta->'after', '{}'::jsonb) ? 'email_or_lineid'
              OR ae.meta ? 'email_or_lineid'
            )
          ORDER BY ae.event_at DESC NULLS LAST, ae.id DESC
          LIMIT 1
        ) contact_evt ON true
        LEFT JOIN packages plan_pkg ON (
          plan_evt.package_id ~* '${UUID_PATTERN}'
          AND plan_pkg.id = plan_evt.package_id::uuid
        )
        LEFT JOIN LATERAL (
          SELECT
            cp.id AS customer_package_id,
            p.code AS package_code,
            p.title AS package_title,
            p.sessions_total,
            p.mask_total,
            p.price_thb
          FROM customer_packages cp
          JOIN packages p ON p.id = cp.package_id
          WHERE cp.id = (
            CASE
              WHEN pu_current.customer_package_id IS NOT NULL
                THEN pu_current.customer_package_id
              WHEN LOWER(COALESCE(plan_evt.treatment_plan_mode, '')) <> ''
                THEN NULL
              ELSE smooth_pkg.customer_package_id
            END
          )
          LIMIT 1
        ) pkg_ctx ON true
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*)::int AS sessions_used,
            COUNT(*) FILTER (WHERE used_mask IS TRUE)::int AS mask_used
          FROM package_usages pu
          WHERE pu.customer_package_id = pkg_ctx.customer_package_id
        ) pkg_usage ON true
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
      const treatmentItemDisplay = buildTreatmentItemDisplay(row);

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
        lineId: sanitizeDisplayLineId(row.lineId),
        treatmentItem: treatmentItemDisplay || row.treatmentItem,
        treatmentItemDisplay: treatmentItemDisplay || row.treatmentItem,
      };
    });

    return res.json({ ok: true, rows: normalizedRows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

