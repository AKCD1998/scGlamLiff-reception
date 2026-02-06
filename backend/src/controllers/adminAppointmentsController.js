import { pool } from '../db.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BACKDATE_LINE_USER_ID = '__BACKDATE__';
const BACKDATE_SOURCE = 'ADMIN';
const ALLOWED_BACKDATE_STATUSES = new Set(['completed', 'booked']);

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

function safeActor(user) {
  return (
    normalizeText(user?.display_name) ||
    normalizeText(user?.username) ||
    normalizeText(user?.id) ||
    'admin'
  );
}

function hasTimezoneOffset(value) {
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
}

function requireIsoDatetimeInPast(value) {
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
  if (parsed.getTime() >= Date.now()) {
    const err = new Error('scheduled_at must be in the past');
    err.status = 400;
    throw err;
  }
  return raw;
}

function parseOptionalNonNegativeInt(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    const err = new Error(`${fieldName} must be a non-negative integer`);
    err.status = 400;
    throw err;
  }
  return parsed;
}

function parseSelectedToppings(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    const err = new Error('selected_toppings must be an array of topping codes');
    err.status = 400;
    throw err;
  }
  const codes = value
    .map((item) => normalizeText(item))
    .filter(Boolean);
  for (const code of codes) {
    if (code.length > 64) {
      const err = new Error('selected_toppings contains an invalid code');
      err.status = 400;
      throw err;
    }
  }
  return codes;
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

export async function adminBackdateAppointment(req, res) {
  let scheduledAtRaw;
  let branchId;
  let treatmentId;
  let customerFullName;
  let staffName;
  let treatmentItemText;
  let reason;
  let phoneDigits;
  let emailOrLineid;
  let rawSheetUuid;
  let status;
  let selectedToppings;
  let addonsTotal;

  try {
    scheduledAtRaw = requireIsoDatetimeInPast(req.body?.scheduled_at);
    branchId = requireText(req.body?.branch_id, 'branch_id');
    treatmentId = requireText(req.body?.treatment_id, 'treatment_id');
    customerFullName = requireText(req.body?.customer_full_name, 'customer_full_name');
    staffName = requireText(req.body?.staff_name, 'staff_name');
    treatmentItemText = requireText(req.body?.treatment_item_text, 'treatment_item_text');
    reason = requireText(req.body?.reason, 'reason');

    if (reason.length < 5) {
      const err = new Error('reason must be at least 5 characters');
      err.status = 400;
      throw err;
    }

    if (!UUID_PATTERN.test(treatmentId)) {
      const err = new Error('Invalid treatment_id');
      err.status = 400;
      throw err;
    }

    phoneDigits = normalizePhone(requireText(req.body?.phone, 'phone'));
    if (phoneDigits.length < 9) {
      const err = new Error('Invalid phone');
      err.status = 400;
      throw err;
    }

    emailOrLineid = normalizeText(req.body?.email_or_lineid);
    rawSheetUuid = normalizeText(req.body?.raw_sheet_uuid);
    if (rawSheetUuid && !UUID_PATTERN.test(rawSheetUuid)) {
      const err = new Error('Invalid raw_sheet_uuid');
      err.status = 400;
      throw err;
    }

    const statusRaw = normalizeText(req.body?.status).toLowerCase();
    status = ALLOWED_BACKDATE_STATUSES.has(statusRaw) ? statusRaw : 'completed';

    selectedToppings = parseSelectedToppings(req.body?.selected_toppings);
    addonsTotal =
      parseOptionalNonNegativeInt(req.body?.addons_total_thb, 'addons_total_thb') ?? 0;
  } catch (error) {
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    console.error(error);
    return res.status(400).json({ ok: false, error: 'Invalid request payload' });
  }

  const actor = safeActor(req.user);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const treatmentExists = await client.query('SELECT id FROM treatments WHERE id = $1 LIMIT 1', [
      treatmentId,
    ]);
    if (treatmentExists.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Treatment not found' });
    }

    const customerId = await resolveOrCreateCustomerByPhone(client, {
      phoneDigits,
      fullName: customerFullName,
    });

    if (!customerId) {
      await client.query('ROLLBACK');
      return res.status(422).json({ ok: false, error: 'Unable to resolve customer' });
    }

    const insertedAppointment = await client.query(
      `
        INSERT INTO appointments (
          line_user_id,
          treatment_id,
          branch_id,
          scheduled_at,
          status,
          selected_toppings,
          addons_total_thb,
          reschedule_count,
          max_reschedule,
          cancellation_policy,
          customer_id,
          source,
          raw_sheet_uuid
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6::jsonb,
          $7,
          0,
          1,
          NULL,
          $8,
          $9,
          $10
        )
        RETURNING id
      `,
      [
        BACKDATE_LINE_USER_ID,
        treatmentId,
        branchId,
        scheduledAtRaw,
        status,
        JSON.stringify(selectedToppings),
        addonsTotal,
        customerId,
        BACKDATE_SOURCE,
        rawSheetUuid || null,
      ]
    );

    const appointmentId = insertedAppointment.rows[0]?.id;

    await client.query(
      `
        INSERT INTO appointment_events (id, appointment_id, event_type, event_at, actor, note, meta)
        VALUES (gen_random_uuid(), $1, $2, now(), $3, $4, $5::jsonb)
      `,
      [
        appointmentId,
        'ADMIN_BACKDATE_CREATE',
        actor,
        reason,
        JSON.stringify({
          scheduled_at: scheduledAtRaw,
          branch_id: branchId,
          treatment_id: treatmentId,
          status,
          customer_full_name: customerFullName,
          phone: phoneDigits,
          email_or_lineid: emailOrLineid || null,
          staff_name: staffName,
          treatment_item_text: treatmentItemText,
          raw_sheet_uuid: rawSheetUuid || null,
          selected_toppings: selectedToppings,
          addons_total_thb: addonsTotal,
          staff_user_id: req.user?.id || null,
          staff_username: normalizeText(req.user?.username) || null,
          staff_display_name: normalizeText(req.user?.display_name) || null,
        }),
      ]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, appointment_id: appointmentId, customer_id: customerId });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    if (error?.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Duplicate record' });
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
