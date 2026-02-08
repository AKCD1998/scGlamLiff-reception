import { pool } from '../db.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BACKDATE_LINE_USER_ID = '__BACKDATE__';
const BACKDATE_SOURCE = 'ADMIN';
const ALLOWED_BACKDATE_STATUSES = new Set(['completed', 'booked']);
const ALLOWED_ADMIN_EDIT_STATUSES = new Set([
  'booked',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
]);
const ALLOWED_TREATMENT_PLAN_MODES = new Set(['', 'one_off', 'package']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINE_ID_PATTERN = /^[a-zA-Z0-9._-]{1,50}$/;

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

function normalizeThaiPhone(raw) {
  const digits = normalizePhone(raw);
  if (!digits) return '';

  if (digits.startsWith('66') && digits.length === 11) {
    return `0${digits.slice(-9)}`;
  }

  if (digits.length === 9 && digits.startsWith('02')) {
    return digits;
  }

  if (digits.length === 9 && !digits.startsWith('0')) {
    return `0${digits}`;
  }

  if (digits.length === 10 && digits.startsWith('0')) {
    return digits;
  }

  return '';
}

function normalizeAppointmentStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return '';
  if (normalized === 'canceled') return 'cancelled';
  return normalized;
}

function normalizeTreatmentPlanMode(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return '';
  if (normalized === 'oneoff') return 'one_off';
  return normalized;
}

function parseEmailOrLineIdentity(raw) {
  const text = normalizeText(raw);
  if (!text) {
    return { provider: '', value: '' };
  }

  if (text.includes('@')) {
    if (!EMAIL_PATTERN.test(text)) {
      const err = new Error('Invalid email_or_lineid');
      err.status = 400;
      throw err;
    }
    return { provider: 'EMAIL', value: text };
  }

  if (!LINE_ID_PATTERN.test(text)) {
    const err = new Error('Invalid email_or_lineid');
    err.status = 400;
    throw err;
  }

  return { provider: 'LINE', value: text };
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

function requireIsoDatetime(value) {
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

function hasOwnField(objectValue, fieldName) {
  return Object.prototype.hasOwnProperty.call(objectValue || {}, fieldName);
}

function ensureEditableFields(body = {}) {
  const immutableKeys = ['id', 'appointment_id', 'customer_id'];
  for (const key of immutableKeys) {
    if (hasOwnField(body, key)) {
      const err = new Error(`${key} is immutable and cannot be edited`);
      err.status = 400;
      throw err;
    }
  }
}

async function ensureStaffRow(client, user) {
  const userId = user?.id;
  if (!userId) {
    const err = new Error('Missing user id');
    err.status = 401;
    throw err;
  }

  const displayName = normalizeText(user?.display_name) || normalizeText(user?.username) || `staff-${userId}`;

  const upsert = await client.query(
    `
      INSERT INTO staffs (id, display_name, is_active, created_at)
      VALUES ($1, $2, true, now())
      ON CONFLICT (id)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        is_active = true
      RETURNING id
    `,
    [userId, displayName]
  );

  return upsert.rows[0]?.id || null;
}

async function getActiveIdentityValue(client, customerId, provider) {
  const result = await client.query(
    `
      SELECT provider_user_id
      FROM customer_identities
      WHERE customer_id = $1
        AND provider = $2
        AND is_active = true
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [customerId, provider]
  );

  return normalizeText(result.rows[0]?.provider_user_id);
}

async function setIdentityProviderValue(client, { customerId, provider, nextValue }) {
  const currentResult = await client.query(
    `
      SELECT id, provider_user_id, is_active
      FROM customer_identities
      WHERE customer_id = $1
        AND provider = $2
      ORDER BY created_at DESC, id DESC
      FOR UPDATE
    `,
    [customerId, provider]
  );

  const beforeValue = normalizeText(
    currentResult.rows.find((row) => row.is_active)?.provider_user_id
  );
  const normalizedNext = normalizeText(nextValue);

  if (!normalizedNext) {
    await client.query(
      `
        UPDATE customer_identities
        SET is_active = false
        WHERE customer_id = $1
          AND provider = $2
          AND is_active = true
      `,
      [customerId, provider]
    );
    return { beforeValue, afterValue: '', changed: Boolean(beforeValue) };
  }

  const ownerResult = await client.query(
    `
      SELECT id, customer_id, is_active
      FROM customer_identities
      WHERE provider = $1
        AND provider_user_id = $2
      LIMIT 1
      FOR UPDATE
    `,
    [provider, normalizedNext]
  );

  const ownerRow = ownerResult.rows[0] || null;
  if (ownerRow && String(ownerRow.customer_id) !== String(customerId)) {
    const err = new Error(`${provider} identity already belongs to another customer`);
    err.status = 409;
    throw err;
  }

  const keepIdentityId = ownerRow?.id || null;

  if (keepIdentityId) {
    await client.query(
      `
        UPDATE customer_identities
        SET is_active = false
        WHERE customer_id = $1
          AND provider = $2
          AND is_active = true
          AND id <> $3
      `,
      [customerId, provider, keepIdentityId]
    );
    await client.query(
      `
        UPDATE customer_identities
        SET is_active = true
        WHERE id = $1
      `,
      [keepIdentityId]
    );
  } else {
    await client.query(
      `
        UPDATE customer_identities
        SET is_active = false
        WHERE customer_id = $1
          AND provider = $2
          AND is_active = true
      `,
      [customerId, provider]
    );

    await client.query(
      `
        INSERT INTO customer_identities
          (id, customer_id, provider, provider_user_id, is_active, created_at)
        VALUES
          (gen_random_uuid(), $1, $2, $3, true, now())
      `,
      [customerId, provider, normalizedNext]
    );
  }

  return {
    beforeValue,
    afterValue: normalizedNext,
    changed: beforeValue !== normalizedNext,
  };
}

async function setEmailOrLineIdentity(client, { customerId, rawValue }) {
  const beforeLine = await getActiveIdentityValue(client, customerId, 'LINE');
  const beforeEmail = await getActiveIdentityValue(client, customerId, 'EMAIL');
  const beforeValue = beforeLine || beforeEmail;

  const parsed = parseEmailOrLineIdentity(rawValue);
  if (!parsed.value) {
    await setIdentityProviderValue(client, {
      customerId,
      provider: 'LINE',
      nextValue: '',
    });
    await setIdentityProviderValue(client, {
      customerId,
      provider: 'EMAIL',
      nextValue: '',
    });
    return { beforeValue, afterValue: '', changed: Boolean(beforeValue) };
  }

  if (parsed.provider === 'LINE') {
    await setIdentityProviderValue(client, {
      customerId,
      provider: 'EMAIL',
      nextValue: '',
    });
    const lineResult = await setIdentityProviderValue(client, {
      customerId,
      provider: 'LINE',
      nextValue: parsed.value,
    });
    return {
      beforeValue,
      afterValue: lineResult.afterValue,
      changed: beforeValue !== lineResult.afterValue,
    };
  }

  await setIdentityProviderValue(client, {
    customerId,
    provider: 'LINE',
    nextValue: '',
  });
  const emailResult = await setIdentityProviderValue(client, {
    customerId,
    provider: 'EMAIL',
    nextValue: parsed.value,
  });
  return {
    beforeValue,
    afterValue: emailResult.afterValue,
    changed: beforeValue !== emailResult.afterValue,
  };
}

async function getAppointmentDetailsById(client, appointmentId, { forUpdate = false } = {}) {
  const lockClause = forUpdate ? 'FOR UPDATE OF a' : '';
  const result = await client.query(
    `
      SELECT
        a.id,
        a.scheduled_at,
        a.branch_id,
        a.treatment_id,
        a.status,
        a.raw_sheet_uuid,
        a.customer_id,
        COALESCE(c.full_name, '') AS customer_full_name,
        COALESCE(t.code, '') AS treatment_code,
        COALESCE(NULLIF(t.title_th, ''), NULLIF(t.title_en, ''), '') AS treatment_title,
        COALESCE(ci_phone.provider_user_id, '') AS phone,
        COALESCE(ci_line.provider_user_id, '') AS line_id,
        COALESCE(ci_email.provider_user_id, '') AS email,
        COALESCE(
          NULLIF(ci_line.provider_user_id, ''),
          NULLIF(ci_email.provider_user_id, ''),
          ''
        ) AS email_or_lineid
      FROM appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN treatments t ON t.id = a.treatment_id
      LEFT JOIN LATERAL (
        SELECT provider_user_id
        FROM customer_identities
        WHERE customer_id = a.customer_id
          AND provider = 'PHONE'
          AND is_active = true
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) ci_phone ON true
      LEFT JOIN LATERAL (
        SELECT provider_user_id
        FROM customer_identities
        WHERE customer_id = a.customer_id
          AND provider = 'LINE'
          AND is_active = true
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) ci_line ON true
      LEFT JOIN LATERAL (
        SELECT provider_user_id
        FROM customer_identities
        WHERE customer_id = a.customer_id
          AND provider = 'EMAIL'
          AND is_active = true
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      ) ci_email ON true
      WHERE a.id = $1
      LIMIT 1
      ${lockClause}
    `,
    [appointmentId]
  );

  return result.rows[0] || null;
}

async function getAppointmentTreatmentPlan(client, appointmentId) {
  const result = await client.query(
    `
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
      WHERE ae.appointment_id = $1
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
    `,
    [appointmentId]
  );

  const row = result.rows[0] || {};
  const normalizedMode = normalizeTreatmentPlanMode(row.treatment_plan_mode);
  const normalizedPackageId = normalizeText(row.package_id);
  const normalizedText = normalizeText(row.treatment_item_text);

  return {
    treatment_item_text: normalizedText,
    treatment_plan_mode: ALLOWED_TREATMENT_PLAN_MODES.has(normalizedMode) ? normalizedMode : '',
    package_id: UUID_PATTERN.test(normalizedPackageId) ? normalizedPackageId : '',
  };
}

async function listActivePackagesForCustomer(client, customerId) {
  const result = await client.query(
    `
      SELECT
        cp.id AS customer_package_id,
        cp.status,
        cp.purchased_at,
        p.code AS package_code,
        p.title AS package_title,
        p.sessions_total,
        p.mask_total,
        p.price_thb,
        COALESCE(u.sessions_used, 0) AS sessions_used,
        COALESCE(u.mask_used, 0) AS mask_used
      FROM customer_packages cp
      JOIN packages p ON p.id = cp.package_id
      LEFT JOIN (
        SELECT
          customer_package_id,
          COUNT(*)::int AS sessions_used,
          COUNT(*) FILTER (WHERE used_mask IS TRUE)::int AS mask_used
        FROM package_usages
        GROUP BY customer_package_id
      ) u ON u.customer_package_id = cp.id
      WHERE cp.customer_id = $1
        AND LOWER(COALESCE(cp.status, '')) = 'active'
      ORDER BY cp.purchased_at DESC NULLS LAST, cp.id DESC
    `,
    [customerId]
  );

  return result.rows.map((row) => {
    const sessionsTotal = Number(row.sessions_total) || 0;
    const maskTotal = Number(row.mask_total) || 0;
    const sessionsUsed = Number(row.sessions_used) || 0;
    const maskUsed = Number(row.mask_used) || 0;
    return {
      customer_package_id: row.customer_package_id,
      status: row.status || 'active',
      purchased_at: row.purchased_at,
      package_code: row.package_code,
      package_title: row.package_title,
      sessions_total: sessionsTotal,
      sessions_used: sessionsUsed,
      sessions_remaining: Math.max(sessionsTotal - sessionsUsed, 0),
      mask_total: maskTotal,
      mask_used: maskUsed,
      mask_remaining: Math.max(maskTotal - maskUsed, 0),
      price_thb: row.price_thb,
    };
  });
}

async function createPackageUsageByAdmin(
  client,
  { appointmentId, customerId, customerPackageId, usedMask, actor, adminUser }
) {
  if (!UUID_PATTERN.test(customerPackageId || '')) {
    const err = new Error('Invalid customer_package_id');
    err.status = 400;
    throw err;
  }

  const existingUsage = await client.query(
    `
      SELECT id
      FROM package_usages
      WHERE appointment_id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [appointmentId]
  );
  if (existingUsage.rowCount > 0) {
    const err = new Error('Usage already exists for this appointment');
    err.status = 409;
    throw err;
  }

  const pkgResult = await client.query(
    `
      SELECT
        cp.id AS customer_package_id,
        cp.customer_id,
        cp.status AS customer_package_status,
        p.code AS package_code,
        p.title AS package_title,
        p.sessions_total,
        p.mask_total
      FROM customer_packages cp
      JOIN packages p ON p.id = cp.package_id
      WHERE cp.id = $1
      LIMIT 1
      FOR UPDATE OF cp
    `,
    [customerPackageId]
  );

  if (pkgResult.rowCount === 0) {
    const err = new Error('Customer package not found');
    err.status = 404;
    throw err;
  }

  const pkg = pkgResult.rows[0];
  if (String(pkg.customer_id) !== String(customerId)) {
    const err = new Error('Package does not belong to this customer');
    err.status = 422;
    throw err;
  }
  if (String(pkg.customer_package_status || '').toLowerCase() !== 'active') {
    const err = new Error('Package is not active');
    err.status = 409;
    throw err;
  }

  const usageCounts = await client.query(
    `
      SELECT
        COUNT(*)::int AS sessions_used,
        COUNT(*) FILTER (WHERE used_mask IS TRUE)::int AS mask_used,
        COALESCE(MAX(session_no), 0)::int AS last_session_no
      FROM package_usages
      WHERE customer_package_id = $1
    `,
    [customerPackageId]
  );

  const sessionsTotal = Number(pkg.sessions_total) || 0;
  const maskTotal = Number(pkg.mask_total) || 0;
  const sessionsUsed = Number(usageCounts.rows[0]?.sessions_used) || 0;
  const maskUsed = Number(usageCounts.rows[0]?.mask_used) || 0;
  const lastSessionNo = Number(usageCounts.rows[0]?.last_session_no) || 0;

  if (sessionsTotal - sessionsUsed <= 0) {
    const err = new Error('No remaining sessions for this package');
    err.status = 409;
    throw err;
  }

  if (usedMask) {
    if (maskTotal <= 0) {
      const err = new Error('This package has no mask allowance');
      err.status = 409;
      throw err;
    }
    if (maskTotal - maskUsed <= 0) {
      const err = new Error('No remaining masks for this package');
      err.status = 409;
      throw err;
    }
  }

  const staffId = await ensureStaffRow(client, adminUser);
  const nextSessionNo = lastSessionNo + 1;

  const insertedUsage = await client.query(
    `
      INSERT INTO package_usages
        (id, customer_package_id, appointment_id, session_no, used_mask, used_at, staff_id, note)
      VALUES
        (gen_random_uuid(), $1, $2, $3, $4, now(), $5, $6)
      RETURNING id
    `,
    [customerPackageId, appointmentId, nextSessionNo, Boolean(usedMask), staffId, 'admin edit deduction']
  );

  await client.query(
    `
      INSERT INTO appointment_events (id, appointment_id, event_type, event_at, actor, note, meta)
      VALUES (gen_random_uuid(), $1, 'redeemed', now(), $2, NULL, $3::jsonb)
    `,
    [
      appointmentId,
      actor,
      JSON.stringify({
        source: 'admin_edit',
        actor,
        customer_package_id: customerPackageId,
        package_code: pkg.package_code,
        package_title: pkg.package_title,
        session_no: nextSessionNo,
        used_mask: Boolean(usedMask),
        usage_id: insertedUsage.rows[0]?.id || null,
      }),
    ]
  );

  return {
    customer_package_id: customerPackageId,
    package_code: pkg.package_code,
    package_title: pkg.package_title,
    session_no: nextSessionNo,
    used_mask: Boolean(usedMask),
  };
}

export async function getAdminAppointmentById(req, res) {
  const appointmentId = normalizeText(req.params?.appointmentId);
  if (!UUID_PATTERN.test(appointmentId)) {
    return res.status(400).json({ ok: false, error: 'Invalid appointmentId' });
  }

  const client = await pool.connect();
  try {
    const appointment = await getAppointmentDetailsById(client, appointmentId);
    if (!appointment) {
      return res.status(404).json({ ok: false, error: 'Appointment not found' });
    }

    const treatmentPlan = await getAppointmentTreatmentPlan(client, appointmentId);

    const activePackages = appointment.customer_id
      ? await listActivePackagesForCustomer(client, appointment.customer_id)
      : [];

    return res.json({
      ok: true,
      appointment: {
        id: appointment.id,
        scheduled_at: appointment.scheduled_at,
        branch_id: appointment.branch_id,
        treatment_id: appointment.treatment_id,
        status: appointment.status,
        raw_sheet_uuid: appointment.raw_sheet_uuid,
        customer_id: appointment.customer_id,
        customer_full_name: appointment.customer_full_name,
        treatment_code: appointment.treatment_code,
        treatment_title: appointment.treatment_title,
        phone: appointment.phone,
        line_id: appointment.line_id,
        email: appointment.email,
        email_or_lineid: appointment.email_or_lineid,
        treatment_item_text: treatmentPlan.treatment_item_text || appointment.treatment_title,
        treatment_plan_mode: treatmentPlan.treatment_plan_mode,
        package_id: treatmentPlan.package_id,
      },
      active_packages: activePackages,
    });
  } catch (error) {
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

export async function patchAdminAppointment(req, res) {
  const appointmentId = normalizeText(req.params?.appointmentId);
  if (!UUID_PATTERN.test(appointmentId)) {
    return res.status(400).json({ ok: false, error: 'Invalid appointmentId' });
  }

  let reason = '';
  try {
    ensureEditableFields(req.body || {});
    reason = requireText(req.body?.reason, 'reason');
    if (reason.length < 5) {
      const err = new Error('reason must be at least 5 characters');
      err.status = 400;
      throw err;
    }
  } catch (error) {
    return res
      .status(error?.status || 400)
      .json({ ok: false, error: error.message || 'Invalid request payload' });
  }

  const actor = normalizeText(req.user?.id) || safeActor(req.user);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const beforeRecord = await getAppointmentDetailsById(client, appointmentId, { forUpdate: true });
    if (!beforeRecord) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Appointment not found' });
    }
    if (!beforeRecord.customer_id) {
      await client.query('ROLLBACK');
      return res.status(422).json({ ok: false, error: 'Appointment missing customer_id' });
    }
    const beforePlan = await getAppointmentTreatmentPlan(client, appointmentId);

    const before = {};
    const after = {};
    const appointmentUpdateFields = {};

    if (hasOwnField(req.body, 'scheduled_at')) {
      const nextScheduledAt = requireIsoDatetime(req.body?.scheduled_at);
      if (normalizeText(beforeRecord.scheduled_at) !== normalizeText(nextScheduledAt)) {
        appointmentUpdateFields.scheduled_at = nextScheduledAt;
        before.scheduled_at = beforeRecord.scheduled_at;
        after.scheduled_at = nextScheduledAt;
      }
    }

    if (hasOwnField(req.body, 'branch_id')) {
      const nextBranchId = requireText(req.body?.branch_id, 'branch_id');
      if (normalizeText(beforeRecord.branch_id) !== nextBranchId) {
        appointmentUpdateFields.branch_id = nextBranchId;
        before.branch_id = beforeRecord.branch_id;
        after.branch_id = nextBranchId;
      }
    }

    if (hasOwnField(req.body, 'treatment_id')) {
      const nextTreatmentId = requireText(req.body?.treatment_id, 'treatment_id');
      if (!UUID_PATTERN.test(nextTreatmentId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Invalid treatment_id' });
      }

      const treatmentExists = await client.query(
        'SELECT id FROM treatments WHERE id = $1 LIMIT 1',
        [nextTreatmentId]
      );
      if (treatmentExists.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Treatment not found' });
      }

      if (normalizeText(beforeRecord.treatment_id) !== nextTreatmentId) {
        appointmentUpdateFields.treatment_id = nextTreatmentId;
        before.treatment_id = beforeRecord.treatment_id;
        after.treatment_id = nextTreatmentId;
      }
    }

    const planFieldProvided =
      hasOwnField(req.body, 'treatment_item_text') ||
      hasOwnField(req.body, 'treatment_plan_mode') ||
      hasOwnField(req.body, 'package_id');

    if (planFieldProvided) {
      let nextTreatmentItemText = beforePlan.treatment_item_text;
      let nextTreatmentPlanMode = beforePlan.treatment_plan_mode;
      let nextPackageId = beforePlan.package_id;

      if (hasOwnField(req.body, 'treatment_item_text')) {
        nextTreatmentItemText = requireText(req.body?.treatment_item_text, 'treatment_item_text');
      }

      if (hasOwnField(req.body, 'treatment_plan_mode')) {
        nextTreatmentPlanMode = normalizeTreatmentPlanMode(req.body?.treatment_plan_mode);
        if (!ALLOWED_TREATMENT_PLAN_MODES.has(nextTreatmentPlanMode)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            ok: false,
            error: 'treatment_plan_mode must be one of one_off|package (or empty)',
          });
        }
      }

      if (hasOwnField(req.body, 'package_id')) {
        nextPackageId = normalizeText(req.body?.package_id);
      }

      if (nextPackageId && !UUID_PATTERN.test(nextPackageId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Invalid package_id' });
      }

      if (nextPackageId && !nextTreatmentPlanMode) {
        nextTreatmentPlanMode = 'package';
      }

      if (nextTreatmentPlanMode === 'one_off') {
        nextPackageId = '';
      }

      if (nextTreatmentPlanMode === 'package' && !nextPackageId) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'package_id is required when treatment_plan_mode=package',
        });
      }

      if (nextPackageId) {
        const packageExists = await client.query('SELECT id FROM packages WHERE id = $1 LIMIT 1', [
          nextPackageId,
        ]);
        if (packageExists.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: 'Package not found' });
        }
      }

      if (beforePlan.treatment_item_text !== nextTreatmentItemText) {
        before.treatment_item_text = beforePlan.treatment_item_text || null;
        after.treatment_item_text = nextTreatmentItemText || null;
      }

      if (beforePlan.treatment_plan_mode !== nextTreatmentPlanMode) {
        before.treatment_plan_mode = beforePlan.treatment_plan_mode || null;
        after.treatment_plan_mode = nextTreatmentPlanMode || null;
      }

      if (beforePlan.package_id !== nextPackageId) {
        before.package_id = beforePlan.package_id || null;
        after.package_id = nextPackageId || null;
      }
    }

    if (hasOwnField(req.body, 'status')) {
      const nextStatus = normalizeAppointmentStatus(req.body?.status);
      if (!ALLOWED_ADMIN_EDIT_STATUSES.has(nextStatus)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'status must be one of booked|completed|cancelled|no_show|rescheduled',
        });
      }

      const currentStatus = normalizeAppointmentStatus(beforeRecord.status);
      const confirmCancelledToCompleted = Boolean(req.body?.confirm_cancelled_to_completed);
      if (
        (currentStatus === 'cancelled' || currentStatus === 'canceled') &&
        nextStatus === 'completed' &&
        !confirmCancelledToCompleted
      ) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          ok: false,
          error: 'Transition cancelled -> completed requires confirm_cancelled_to_completed=true',
        });
      }

      if (currentStatus !== nextStatus) {
        appointmentUpdateFields.status = nextStatus;
        before.status = beforeRecord.status;
        after.status = nextStatus;
      }
    }

    if (hasOwnField(req.body, 'raw_sheet_uuid')) {
      const nextRawSheetUuid = normalizeText(req.body?.raw_sheet_uuid);
      const normalizedRawSheet = nextRawSheetUuid || null;
      if (normalizedRawSheet && !UUID_PATTERN.test(normalizedRawSheet)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Invalid raw_sheet_uuid' });
      }

      const currentRawSheet = normalizeText(beforeRecord.raw_sheet_uuid) || null;
      if (currentRawSheet !== normalizedRawSheet) {
        const danger1 = Boolean(req.body?.confirm_raw_sheet_uuid_change);
        const danger2 = Boolean(req.body?.confirm_raw_sheet_uuid_change_ack);
        if (!danger1 || !danger2) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            ok: false,
            error:
              'raw_sheet_uuid change requires confirm_raw_sheet_uuid_change=true and confirm_raw_sheet_uuid_change_ack=true',
          });
        }

        appointmentUpdateFields.raw_sheet_uuid = normalizedRawSheet;
        before.raw_sheet_uuid = beforeRecord.raw_sheet_uuid || null;
        after.raw_sheet_uuid = normalizedRawSheet;
      }
    }

    if (hasOwnField(req.body, 'customer_full_name')) {
      const nextCustomerName = requireText(req.body?.customer_full_name, 'customer_full_name');
      if (normalizeText(beforeRecord.customer_full_name) !== nextCustomerName) {
        await client.query(
          `
            UPDATE customers
            SET full_name = $2
            WHERE id = $1
          `,
          [beforeRecord.customer_id, nextCustomerName]
        );
        before.customer_full_name = beforeRecord.customer_full_name;
        after.customer_full_name = nextCustomerName;
      }
    }

    if (hasOwnField(req.body, 'phone')) {
      const normalizedPhone = normalizeThaiPhone(req.body?.phone);
      if (!normalizedPhone) {
        await client.query('ROLLBACK');
        return res.status(400).json({ ok: false, error: 'Invalid phone' });
      }
      const phoneSync = await setIdentityProviderValue(client, {
        customerId: beforeRecord.customer_id,
        provider: 'PHONE',
        nextValue: normalizedPhone,
      });
      if (phoneSync.changed) {
        before.phone = phoneSync.beforeValue;
        after.phone = phoneSync.afterValue;
      }
    }

    if (hasOwnField(req.body, 'email_or_lineid')) {
      const emailOrLineSync = await setEmailOrLineIdentity(client, {
        customerId: beforeRecord.customer_id,
        rawValue: req.body?.email_or_lineid,
      });
      if (emailOrLineSync.changed) {
        before.email_or_lineid = emailOrLineSync.beforeValue;
        after.email_or_lineid = emailOrLineSync.afterValue;
      }
    }

    if (Object.keys(appointmentUpdateFields).length > 0) {
      const setParts = [];
      const values = [];

      for (const [field, value] of Object.entries(appointmentUpdateFields)) {
        values.push(value);
        setParts.push(`${field} = $${values.length}`);
      }

      values.push(appointmentId);
      await client.query(
        `
          UPDATE appointments
          SET ${setParts.join(', ')},
              updated_at = now()
          WHERE id = $${values.length}
        `,
        values
      );
    }

    const targetStatus = normalizeAppointmentStatus(
      appointmentUpdateFields.status !== undefined
        ? appointmentUpdateFields.status
        : beforeRecord.status
    );
    const createPackageUsage = Boolean(req.body?.create_package_usage);
    let deductionResult = null;

    if (createPackageUsage) {
      if (targetStatus !== 'completed') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          ok: false,
          error: 'create_package_usage can be used only when appointment status is completed',
        });
      }
      const customerPackageId = normalizeText(req.body?.customer_package_id);
      deductionResult = await createPackageUsageByAdmin(client, {
        appointmentId,
        customerId: beforeRecord.customer_id,
        customerPackageId,
        usedMask: Boolean(req.body?.used_mask),
        actor,
        adminUser: req.user,
      });
      before.package_usage = null;
      after.package_usage = deductionResult;
    }

    const changedFields = Object.keys(after);
    if (changedFields.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'No changes detected' });
    }

    await client.query(
      `
        INSERT INTO appointment_events (id, appointment_id, event_type, event_at, actor, note, meta)
        VALUES (gen_random_uuid(), $1, 'ADMIN_APPOINTMENT_UPDATE', now(), $2, $3, $4::jsonb)
      `,
      [
        appointmentId,
        actor,
        reason,
        JSON.stringify({
          reason,
          changed_fields: changedFields,
          before,
          after,
          admin_user_id: req.user?.id || null,
          admin_username: normalizeText(req.user?.username) || null,
          admin_display_name: normalizeText(req.user?.display_name) || null,
          created_package_usage: Boolean(deductionResult),
        }),
      ]
    );

    const updatedRecord = await getAppointmentDetailsById(client, appointmentId);
    await client.query('COMMIT');

    return res.json({
      ok: true,
      appointment_id: appointmentId,
      changed_fields: changedFields,
      before,
      after,
      appointment: updatedRecord,
      package_usage: deductionResult,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error?.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
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
