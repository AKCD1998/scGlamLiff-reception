import { pool } from '../db.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

const DEFAULT_BRANCH_ID = process.env.DEFAULT_BRANCH_ID || 'branch-003';
const STAFF_LINE_USER_ID = '__STAFF__';
const STAFF_SOURCE = 'WEB';

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function requireText(value, fieldName) {
  const trimmed = normalizeText(value);
  if (!trimmed) {
    const err = new Error(`Missing required field: ${fieldName}`);
    err.status = 400;
    throw err;
  }
  return trimmed;
}

function normalizePhone(raw) {
  return normalizeText(raw).replace(/[^\d]/g, '');
}

function hasTimezoneOffset(value) {
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
}

function requireFutureIsoDatetime(value) {
  const raw = requireText(value, 'scheduled_at');
  if (!hasTimezoneOffset(raw)) {
    const err = new Error('scheduled_at must include timezone offset (e.g. 2026-02-05T14:00:00+07:00)');
    err.status = 400;
    throw err;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    const err = new Error('scheduled_at must be a valid ISO datetime');
    err.status = 400;
    throw err;
  }
  if (parsed.getTime() <= Date.now()) {
    const err = new Error('scheduled_at must be in the future');
    err.status = 400;
    throw err;
  }
  return raw;
}

function inferTreatmentCode(raw) {
  const text = String(raw || '').toLowerCase();
  if (text.includes('smooth')) return 'smooth';
  if (text.includes('renew')) return 'glam_renew';
  if (text.includes('glam')) return 'glam_renew';
  if (text.includes('acne')) return 'expert';
  if (text.includes('expert')) return 'expert';
  return null;
}

function inferSmoothPackageHint(raw) {
  const text = normalizeText(raw).toLowerCase();
  if (!text || !text.includes('smooth')) return null;

  const sessionMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
  const sessionsTotal = sessionMatch ? Number(sessionMatch[2]) : 1;
  if (!Number.isFinite(sessionsTotal) || sessionsTotal <= 0) return null;

  const priceCandidates = [...text.matchAll(/\b(\d{3,4})\b/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 100);
  const price = priceCandidates.length > 0 ? priceCandidates[0] : null;

  let maskTotal = 0;
  const maskProgressMatch = text.match(/(\d+)\s*\/\s*(\d+)\s*mask/);
  if (maskProgressMatch) {
    const total = Number(maskProgressMatch[2]);
    if (Number.isFinite(total) && total >= 0) {
      maskTotal = total;
    }
  } else {
    const maskMatch = text.match(/\b(\d+)\s*mask\b/);
    if (maskMatch) {
      const total = Number(maskMatch[1]);
      if (Number.isFinite(total) && total >= 0) {
        maskTotal = total;
      }
    }
  }

  return { sessionsTotal, price, maskTotal };
}

async function resolvePackageIdForStaffBooking(client, { explicitPackageId, treatmentItemText }) {
  const packageId = normalizeText(explicitPackageId);
  if (packageId) {
    const pkg = await client.query('SELECT id FROM packages WHERE id = $1 LIMIT 1', [packageId]);
    if (pkg.rowCount === 0) {
      const err = new Error('Package not found');
      err.status = 400;
      throw err;
    }
    return packageId;
  }

  const hint = inferSmoothPackageHint(treatmentItemText);
  if (!hint) return null;

  const { sessionsTotal, price, maskTotal } = hint;

  if (price) {
    const packageCode = `SMOOTH_C${sessionsTotal}_${price}_M${maskTotal}`;
    const byCode = await client.query(
      'SELECT id FROM packages WHERE UPPER(COALESCE(code, \'\')) = UPPER($1) LIMIT 1',
      [packageCode]
    );
    if (byCode.rowCount > 0) return byCode.rows[0].id;
  }

  const params = [sessionsTotal];
  const whereParts = [
    "LOWER(COALESCE(code, '')) LIKE 'smooth%'",
    'COALESCE(sessions_total, 0) = $1',
  ];

  if (price) {
    params.push(price);
    whereParts.push(`COALESCE(price_thb, 0) = $${params.length}`);
  }

  if (sessionsTotal > 1) {
    params.push(maskTotal);
    whereParts.push(`COALESCE(mask_total, 0) = $${params.length}`);
  }

  const fallback = await client.query(
    `
      SELECT id
      FROM packages
      WHERE ${whereParts.join(' AND ')}
      ORDER BY price_thb ASC NULLS LAST, id ASC
      LIMIT 1
    `,
    params
  );

  return fallback.rowCount > 0 ? fallback.rows[0].id : null;
}

async function ensureActiveCustomerPackage(client, { customerId, packageId, note }) {
  if (!customerId || !packageId) return null;

  const existing = await client.query(
    `
      SELECT id
      FROM customer_packages
      WHERE customer_id = $1
        AND package_id = $2
        AND LOWER(COALESCE(status, '')) = 'active'
      ORDER BY purchased_at DESC NULLS LAST, id DESC
      LIMIT 1
    `,
    [customerId, packageId]
  );

  if (existing.rowCount > 0) return existing.rows[0].id;

  const inserted = await client.query(
    `
      INSERT INTO customer_packages (customer_id, package_id, status, purchased_at, note)
      VALUES ($1, $2, 'active', now(), $3)
      RETURNING id
    `,
    [customerId, packageId, note || 'auto:staff']
  );

  return inserted.rows[0]?.id || null;
}

async function ensureStaffLineUserRow(client) {
  const result = await client.query(
    `
      INSERT INTO line_users (line_user_id, display_name, customer_id)
      VALUES ($1, $2, NULL)
      ON CONFLICT (line_user_id)
      DO UPDATE SET
        display_name = COALESCE(line_users.display_name, EXCLUDED.display_name)
      RETURNING line_user_id
    `,
    [STAFF_LINE_USER_ID, 'staff-booking']
  );

  return normalizeText(result.rows[0]?.line_user_id) || STAFF_LINE_USER_ID;
}

async function resolveOrCreateCustomerByPhone(client, { phoneDigits, fullName }) {
  const identity = await client.query(
    `
      SELECT customer_id
      FROM customer_identities
      WHERE provider = 'PHONE'
        AND provider_user_id = $1
        AND is_active = true
      LIMIT 1
    `,
    [phoneDigits]
  );

  if (identity.rowCount > 0) {
    const customerId = identity.rows[0].customer_id;
    if (fullName) {
      await client.query(
        `
          UPDATE customers
          SET full_name = $2
          WHERE id = $1
            AND COALESCE(full_name, '') <> $2
        `,
        [customerId, fullName]
      );
    }
    return customerId;
  }

  const createdCustomer = await client.query(
    'INSERT INTO customers (id, full_name, created_at) VALUES (gen_random_uuid(), $1, now()) RETURNING id',
    [fullName || '-']
  );
  const newCustomerId = createdCustomer.rows[0]?.id;

  try {
    await client.query(
      `
        INSERT INTO customer_identities
          (id, customer_id, provider, provider_user_id, is_active, created_at)
        VALUES
          (gen_random_uuid(), $1, 'PHONE', $2, true, now())
      `,
      [newCustomerId, phoneDigits]
    );
    return newCustomerId;
  } catch (error) {
    if (error?.code !== '23505') {
      throw error;
    }

    const existing = await client.query(
      `
        SELECT customer_id
        FROM customer_identities
        WHERE provider = 'PHONE'
          AND provider_user_id = $1
          AND is_active = true
        LIMIT 1
      `,
      [phoneDigits]
    );

    const existingCustomerId = existing.rows[0]?.customer_id || null;
    await client.query('DELETE FROM customers WHERE id = $1', [newCustomerId]);
    return existingCustomerId;
  }
}

export async function createStaffAppointment(req, res) {
  let scheduledAtRaw;
  let branchId;
  let treatmentId;
  let packageId;
  let customerFullName;
  let phoneDigits;
  let emailOrLineid;
  let staffName;
  let treatmentItemText;

  try {
    // Accept both:
    // - { scheduled_at, phone, ... } (new)
    // - { visit_date, visit_time_text, phone_raw, ... } (legacy Bookingpage payload)
    const scheduledAtInput = normalizeText(req.body?.scheduled_at);
    const visitDate = normalizeText(req.body?.visit_date);
    const visitTime = normalizeText(req.body?.visit_time_text);

    if (scheduledAtInput) {
      scheduledAtRaw = requireFutureIsoDatetime(scheduledAtInput);
    } else {
      const vDate = requireText(visitDate, 'visit_date');
      const vTime = requireText(visitTime, 'visit_time_text');
      if (!DATE_PATTERN.test(vDate)) {
        const err = new Error('Invalid visit_date format. Use YYYY-MM-DD');
        err.status = 400;
        throw err;
      }
      if (!TIME_PATTERN.test(vTime)) {
        const err = new Error('Invalid visit_time_text format. Use HH:MM');
        err.status = 400;
        throw err;
      }
      scheduledAtRaw = requireFutureIsoDatetime(`${vDate}T${vTime}:00+07:00`);
    }

    branchId = normalizeText(req.body?.branch_id) || DEFAULT_BRANCH_ID;
    if (!branchId) {
      const err = new Error('Missing required field: branch_id');
      err.status = 400;
      throw err;
    }

    customerFullName = requireText(req.body?.customer_full_name, 'customer_full_name');

    const phoneRaw = normalizeText(req.body?.phone) || normalizeText(req.body?.phone_raw);
    phoneDigits = normalizePhone(requireText(phoneRaw, 'phone'));
    if (phoneDigits.length < 9) {
      const err = new Error('Invalid phone');
      err.status = 400;
      throw err;
    }

    emailOrLineid = normalizeText(req.body?.email_or_lineid);
    staffName = normalizeText(req.body?.staff_name);
    treatmentItemText = normalizeText(req.body?.treatment_item_text);
    packageId = normalizeText(req.body?.package_id);
    if (packageId && !UUID_PATTERN.test(packageId)) {
      const err = new Error('Invalid package_id');
      err.status = 400;
      throw err;
    }

    const treatmentIdRaw = normalizeText(req.body?.treatment_id);
    if (treatmentIdRaw) {
      if (!UUID_PATTERN.test(treatmentIdRaw)) {
        const err = new Error('Invalid treatment_id');
        err.status = 400;
        throw err;
      }
      treatmentId = treatmentIdRaw;
    } else if (treatmentItemText) {
      const inferred = inferTreatmentCode(treatmentItemText);
      if (!inferred) {
        const err = new Error('Unable to infer treatment_id from treatment_item_text');
        err.status = 422;
        throw err;
      }
      treatmentId = inferred; // resolve later by code
    } else {
      const err = new Error('Missing required field: treatment_id');
      err.status = 400;
      throw err;
    }
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    console.error(error);
    return res.status(400).json({ ok: false, error: 'Invalid request payload' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let resolvedTreatmentId = null;
    if (UUID_PATTERN.test(treatmentId)) {
      const exists = await client.query('SELECT id FROM treatments WHERE id = $1 LIMIT 1', [treatmentId]);
      if (exists.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Treatment not found' });
      }
      resolvedTreatmentId = treatmentId;
    } else {
      const byCode = await client.query('SELECT id FROM treatments WHERE code = $1 LIMIT 1', [treatmentId]);
      if (byCode.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(422).json({ ok: false, error: 'Treatment not found' });
      }
      resolvedTreatmentId = byCode.rows[0].id;
    }

    const collision = await client.query(
      `
        SELECT id
        FROM appointments
        WHERE branch_id = $1
          AND scheduled_at = $2
          AND LOWER(COALESCE(status, '')) IN ('booked', 'rescheduled')
        LIMIT 1
      `,
      [branchId, scheduledAtRaw]
    );
    if (collision.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Time slot is already booked' });
    }

    const customerId = await resolveOrCreateCustomerByPhone(client, {
      phoneDigits,
      fullName: customerFullName,
    });

    if (!customerId) {
      await client.query('ROLLBACK');
      return res.status(422).json({ ok: false, error: 'Unable to resolve customer' });
    }

    const staffLineUserId = await ensureStaffLineUserRow(client);
    const resolvedPackageId = await resolvePackageIdForStaffBooking(client, {
      explicitPackageId: packageId,
      treatmentItemText,
    });

    const inserted = await client.query(
      `
        INSERT INTO appointments (
          line_user_id,
          treatment_id,
          branch_id,
          scheduled_at,
          status,
          customer_id,
          source
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'booked',
          $5,
          $6
        )
        RETURNING id
      `,
      [staffLineUserId, resolvedTreatmentId, branchId, scheduledAtRaw, customerId, STAFF_SOURCE]
    );

    const appointmentId = inserted.rows[0]?.id;
    const customerPackageId = await ensureActiveCustomerPackage(client, {
      customerId,
      packageId: resolvedPackageId,
      note: appointmentId ? `auto:staff:${appointmentId}` : 'auto:staff',
    });

    await client.query(
      `
        INSERT INTO appointment_events (id, appointment_id, event_type, event_at, actor, note, meta)
        VALUES (gen_random_uuid(), $1, 'created', now(), 'staff', NULL, $2::jsonb)
      `,
      [
        appointmentId,
        JSON.stringify({
          source: 'staff_create',
          scheduled_at: scheduledAtRaw,
          branch_id: branchId,
          treatment_id: resolvedTreatmentId,
          customer_id: customerId,
          customer_full_name: customerFullName,
          phone: phoneDigits,
          email_or_lineid: emailOrLineid || null,
          staff_name: staffName || null,
          treatment_item_text: treatmentItemText || null,
          package_id: resolvedPackageId || null,
          customer_package_id: customerPackageId || null,
          staff_user_id: req.user?.id || null,
          staff_username: normalizeText(req.user?.username) || null,
          staff_display_name: normalizeText(req.user?.display_name) || null,
        }),
      ]
    );

    await client.query('COMMIT');
    return res.json({
      ok: true,
      appointment_id: appointmentId,
      customer_id: customerId,
      customer_package_id: customerPackageId || null,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error?.code === '23503' && error?.constraint === 'appointments_line_user_id_fkey') {
      return res.status(422).json({
        ok: false,
        error: 'Unable to resolve system line_user_id for staff booking',
        code: error.code,
        constraint: error.constraint,
      });
    }
    console.error(error);
    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    return res.status(500).json({
      ok: false,
      error: isProd ? 'Server error' : error?.message || 'Server error',
      code: isProd ? undefined : error?.code || null,
    });
  } finally {
    client.release();
  }
}
