import { pool } from '../db.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DEFAULT_BRANCH_ID = process.env.DEFAULT_BRANCH_ID || 'branch-003';

function isAdmin(user) {
  const role = String(user?.role_name || '').toLowerCase();
  return role === 'admin' || role === 'owner';
}

function normalizePhone(raw) {
  if (!raw) return '';
  return String(raw).replace(/[^\d]/g, '').trim();
}

function normalizeText(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

function safeDisplayName(user) {
  return String(user?.display_name || user?.username || '').trim() || null;
}

function parseVisitTimeToHHMM(raw) {
  if (!raw) return null;
  const text = String(raw).trim().toLowerCase();
  const match = text.match(/(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

async function ensureStaffRow(client, user) {
  const userId = user?.id;
  const displayName = user?.display_name || user?.username || '';
  if (!userId) {
    throw new Error('Missing user id');
  }

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
    [userId, displayName || `staff-${userId}`]
  );
  return upsert.rows[0].id;
}

async function ensureLineUserRow(client, { lineUserId, displayName, customerId }) {
  if (!lineUserId) {
    const err = new Error('Missing line_user_id');
    err.status = 422;
    throw err;
  }

  const result = await client.query(
    `
      INSERT INTO line_users (line_user_id, display_name, customer_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (line_user_id)
      DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, line_users.display_name),
        customer_id = COALESCE(line_users.customer_id, EXCLUDED.customer_id)
      RETURNING line_user_id
    `,
    [lineUserId, displayName || null, customerId || null]
  );

  return result.rows[0].line_user_id;
}

async function resolveAppointment(client, idOrSheetUuid, options = {}) {
  const value = String(idOrSheetUuid || '').trim();
  if (!UUID_PATTERN.test(value)) {
    const err = new Error('Invalid appointment id');
    err.status = 400;
    throw err;
  }

  const lockClause = options.forUpdate ? ' FOR UPDATE' : '';

  const byId = await client.query(
    `SELECT * FROM appointments WHERE id = $1 LIMIT 1${lockClause}`,
    [value]
  );
  if (byId.rowCount > 0) return byId.rows[0];

  const bySheet = await client.query(
    `SELECT * FROM appointments WHERE raw_sheet_uuid = $1 LIMIT 1${lockClause}`,
    [value]
  );
  if (bySheet.rowCount > 0) return bySheet.rows[0];

  return null;
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

  // Course strings look like: "1/3 smooth 999 1 mask", "1/10 smooth 2999 1/3 mask",
  // and one-off display can be "1/1 Smooth (399) | Mask 0/0".
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

async function resolvePackageIdFromTreatmentItem(client, treatmentItemText) {
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

  // Fallback lookup by dimensions. This keeps one-off (1/1) selectable even when
  // treatment_item_text does not carry explicit package code.
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
        AND LOWER(status) = 'active'
      ORDER BY purchased_at DESC
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
    [customerId, packageId, note || 'auto:sync']
  );

  return inserted.rows[0]?.id || null;
}

async function resolveDefaultSmoothOneOffPackageId(client) {
  const result = await client.query(
    `
      SELECT id
      FROM packages
      WHERE LOWER(COALESCE(code, '')) LIKE 'smooth%'
        AND COALESCE(sessions_total, 0) = 1
      ORDER BY price_thb ASC NULLS LAST, id ASC
      LIMIT 1
    `
  );

  return result.rowCount > 0 ? result.rows[0].id : null;
}

async function getAppointmentTreatmentPlanFromEvents(client, appointmentId) {
  const result = await client.query(
    `
      SELECT
        COALESCE(
          NULLIF(ae.meta->'after'->>'treatment_item_text', ''),
          NULLIF(ae.meta->>'treatment_item_text', '')
        ) AS treatment_item_text,
        COALESCE(
          NULLIF(ae.meta->'after'->>'package_id', ''),
          NULLIF(ae.meta->>'package_id', '')
        ) AS package_id
      FROM appointment_events ae
      WHERE ae.appointment_id = $1
        AND (
          COALESCE(ae.meta->'after', '{}'::jsonb) ? 'treatment_item_text'
          OR ae.meta ? 'treatment_item_text'
          OR COALESCE(ae.meta->'after', '{}'::jsonb) ? 'package_id'
          OR ae.meta ? 'package_id'
        )
      ORDER BY ae.event_at DESC NULLS LAST, ae.id DESC
      LIMIT 1
    `,
    [appointmentId]
  );

  const row = result.rows[0] || {};
  return {
    treatmentItemText: normalizeText(row.treatment_item_text),
    packageId: normalizeText(row.package_id),
  };
}

async function ensureCustomerPackageFromTreatmentItem(client, { customerId, treatmentItemText, sheetUuid }) {
  if (!customerId) return null;
  const packageId = await resolvePackageIdFromTreatmentItem(client, treatmentItemText);
  if (!packageId) return null;
  return ensureActiveCustomerPackage(client, {
    customerId,
    packageId,
    note: sheetUuid ? `auto:sheet:${sheetUuid}` : 'auto:sheet',
  });
}

export async function ensureAppointmentFromSheet(req, res) {
  const sheetUuid = String(req.params?.sheetUuid || '').trim();
  if (!UUID_PATTERN.test(sheetUuid)) {
    return res.status(400).json({ ok: false, error: 'Invalid sheet UUID' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sheetResult = await client.query(
      `
        SELECT
          sheet_uuid,
          TO_CHAR(visit_date, 'YYYY-MM-DD') AS visit_date,
          visit_time_text,
          customer_full_name,
          phone_raw,
          email_or_lineid,
          treatment_item_text,
          staff_name
        FROM sheet_visits_raw
        WHERE sheet_uuid = $1
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [sheetUuid]
    );

    if (sheetResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Booking row not found' });
    }

    const sheet = sheetResult.rows[0];

    const phone = normalizePhone(sheet.phone_raw);
    const lineUserId = phone ? `phone:${phone}` : `sheet:${sheetUuid}`;

    const existingAppointment = await client.query(
      'SELECT * FROM appointments WHERE raw_sheet_uuid = $1 LIMIT 1',
      [sheetUuid]
    );

    let appointment = existingAppointment.rowCount > 0 ? existingAppointment.rows[0] : null;
    let customerId = appointment?.customer_id || null;

    if (!customerId && phone) {
      const identity = await client.query(
        `
          SELECT customer_id
          FROM customer_identities
          WHERE provider = 'PHONE'
            AND provider_user_id = $1
          LIMIT 1
        `,
        [phone]
      );
      if (identity.rowCount > 0) {
        customerId = identity.rows[0].customer_id;
      }
    }

    if (!customerId) {
      const createdCustomer = await client.query(
        'INSERT INTO customers (id, full_name, created_at) VALUES (gen_random_uuid(), $1, now()) RETURNING id',
        [sheet.customer_full_name || '-']
      );
      const newCustomerId = createdCustomer.rows[0].id;

      if (phone) {
        try {
          await client.query(
            `
              INSERT INTO customer_identities
                (id, customer_id, provider, provider_user_id, is_active, created_at)
              VALUES
                (gen_random_uuid(), $1, 'PHONE', $2, true, now())
            `,
            [newCustomerId, phone]
          );
          customerId = newCustomerId;
        } catch (error) {
          if (error?.code === '23505') {
            const existing = await client.query(
              `
                SELECT customer_id
                FROM customer_identities
                WHERE provider = 'PHONE'
                  AND provider_user_id = $1
                LIMIT 1
              `,
              [phone]
            );
            customerId = existing.rows[0]?.customer_id || null;
            // Clean up the newly created customer row if identity already exists elsewhere.
            await client.query('DELETE FROM customers WHERE id = $1', [newCustomerId]);
          } else {
            throw error;
          }
        }
      } else {
        customerId = newCustomerId;
      }
    }

    if (!customerId) {
      await client.query('ROLLBACK');
      return res.status(422).json({ ok: false, error: 'Unable to resolve customer' });
    }

    await ensureLineUserRow(client, {
      lineUserId,
      displayName: sheet.customer_full_name || safeDisplayName(req.user),
      customerId,
    });

    if (appointment && !appointment.customer_id && customerId) {
      const updated = await client.query(
        `
          UPDATE appointments
          SET customer_id = $2,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [appointment.id, customerId]
      );
      if (updated.rowCount > 0) {
        appointment = updated.rows[0];
      }
    }

    // Auto-create a customer package for course-style sheet entries so staff can deduct usage.
    await ensureCustomerPackageFromTreatmentItem(client, {
      customerId,
      treatmentItemText: sheet.treatment_item_text,
      sheetUuid,
    });

    if (appointment) {
      await client.query('COMMIT');
      return res.json({ ok: true, appointment });
    }

    const timeHHMM = parseVisitTimeToHHMM(sheet.visit_time_text);
    if (!sheet.visit_date || !timeHHMM) {
      await client.query('ROLLBACK');
      return res.status(422).json({ ok: false, error: 'Invalid visit date/time' });
    }

    const treatmentCode = inferTreatmentCode(sheet.treatment_item_text);
    if (!treatmentCode) {
      await client.query('ROLLBACK');
      return res.status(422).json({ ok: false, error: 'Unable to infer treatment' });
    }

    const treatmentResult = await client.query(
      'SELECT id FROM treatments WHERE code = $1 LIMIT 1',
      [treatmentCode]
    );
    if (treatmentResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({ ok: false, error: 'Treatment not found' });
    }

    const treatmentId = treatmentResult.rows[0].id;
    const scheduledAt = `${sheet.visit_date}T${timeHHMM}:00+07:00`;

    const insertResult = await client.query(
      `
        INSERT INTO appointments (
          customer_id,
          line_user_id,
          treatment_id,
          branch_id,
          scheduled_at,
          status,
          source,
          raw_sheet_uuid
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'booked',
          'SHEET',
          $6
        )
        RETURNING *
      `,
      [customerId, lineUserId, treatmentId, DEFAULT_BRANCH_ID, scheduledAt, sheetUuid]
    );

    appointment = insertResult.rows[0];

    await client.query(
      `
        INSERT INTO appointment_events (id, appointment_id, event_type, event_at, actor, note, meta)
        VALUES (gen_random_uuid(), $1, 'created', now(), 'staff', NULL, $2::jsonb)
      `,
      [
        appointment.id,
        JSON.stringify({
          source: 'sheet',
          raw_sheet_uuid: sheetUuid,
          staff_user_id: req.user?.id || null,
          staff_display_name: safeDisplayName(req.user),
        }),
      ]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, appointment });
  } catch (error) {
    await client.query('ROLLBACK');
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

export async function syncAppointmentCourse(req, res) {
  const appointmentId = normalizeText(req.params?.id);
  if (!UUID_PATTERN.test(appointmentId)) {
    return res.status(400).json({ ok: false, error: 'Invalid appointment id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const appointmentResult = await client.query(
      `
        SELECT
          a.id,
          a.customer_id,
          COALESCE(NULLIF(t.code, ''), '') AS treatment_code
        FROM appointments a
        LEFT JOIN treatments t ON t.id = a.treatment_id
        WHERE a.id = $1
        LIMIT 1
        FOR UPDATE OF a
      `,
      [appointmentId]
    );

    if (appointmentResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Appointment not found' });
    }

    const appointment = appointmentResult.rows[0];
    const customerId = normalizeText(appointment.customer_id);
    if (!customerId) {
      await client.query('ROLLBACK');
      return res.status(422).json({ ok: false, error: 'Appointment has no customer' });
    }

    const plan = await getAppointmentTreatmentPlanFromEvents(client, appointmentId);

    let packageId = '';
    if (UUID_PATTERN.test(plan.packageId)) {
      const packageExists = await client.query('SELECT id FROM packages WHERE id = $1 LIMIT 1', [
        plan.packageId,
      ]);
      if (packageExists.rowCount > 0) {
        packageId = plan.packageId;
      }
    }

    if (!packageId && plan.treatmentItemText) {
      packageId = (await resolvePackageIdFromTreatmentItem(client, plan.treatmentItemText)) || '';
    }

    if (!packageId && String(appointment.treatment_code || '').toLowerCase() === 'smooth') {
      packageId = (await resolveDefaultSmoothOneOffPackageId(client)) || '';
    }

    if (!packageId) {
      await client.query('COMMIT');
      return res.json({ ok: true, synced: false, reason: 'No package mapping found' });
    }

    const customerPackageId = await ensureActiveCustomerPackage(client, {
      customerId,
      packageId,
      note: `auto:sync:${appointmentId}`,
    });

    await client.query('COMMIT');
    return res.json({
      ok: true,
      synced: Boolean(customerPackageId),
      package_id: packageId,
      customer_package_id: customerPackageId || null,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Server error' });
  } finally {
    client.release();
  }
}

export async function completeAppointment(req, res) {
  const appointmentId = String(req.params?.id || '').trim();
  const customerPackageId =
    typeof req.body?.customer_package_id === 'string' ? req.body.customer_package_id.trim() : '';
  const usedMask = Boolean(req.body?.used_mask);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const staffId = await ensureStaffRow(client, req.user);

    const appointment = await resolveAppointment(client, appointmentId, { forUpdate: true });
    if (!appointment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Appointment not found' });
    }

    const currentStatus = String(appointment.status || '').toLowerCase();
    if (!['booked', 'rescheduled'].includes(currentStatus)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: `Cannot complete appointment in status: ${currentStatus}` });
    }

    if (!appointment.customer_id) {
      await client.query('ROLLBACK');
      return res.status(422).json({ ok: false, error: 'Appointment missing customer_id' });
    }

    const existingUsage = await client.query(
      'SELECT id, customer_package_id, session_no, used_mask FROM package_usages WHERE appointment_id = $1 LIMIT 1',
      [appointment.id]
    );
    if (existingUsage.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Service usage already recorded for this appointment' });
    }

    if (!customerPackageId) {
      if (usedMask) {
        await client.query('ROLLBACK');
        return res.status(422).json({ ok: false, error: 'Cannot use mask without selecting a package' });
      }

      await client.query(
        `
          UPDATE appointments
          SET status = 'completed',
              updated_at = now()
          WHERE id = $1
        `,
        [appointment.id]
      );

      await client.query(
        `
          INSERT INTO appointment_events (id, appointment_id, event_type, event_at, actor, note, meta)
          VALUES (gen_random_uuid(), $1, 'redeemed', now(), 'staff', NULL, $2::jsonb)
        `,
        [
          appointment.id,
          JSON.stringify({
            kind: 'one_off',
            staff_id: staffId,
            staff_user_id: req.user?.id || null,
            staff_display_name: safeDisplayName(req.user),
            treatment_id: appointment.treatment_id || null,
            raw_sheet_uuid: appointment.raw_sheet_uuid || null,
          }),
        ]
      );

      await client.query('COMMIT');
      return res.json({
        ok: true,
        data: {
          appointment_id: appointment.id,
          status: 'completed',
          usage: null,
        },
      });
    }

    if (!UUID_PATTERN.test(customerPackageId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Invalid customer_package_id' });
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
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Customer package not found' });
    }

    const pkg = pkgResult.rows[0];

    if (String(pkg.customer_id) !== String(appointment.customer_id)) {
      await client.query('ROLLBACK');
      return res.status(422).json({ ok: false, error: 'Package does not belong to this customer' });
    }

    if (String(pkg.customer_package_status || '').toLowerCase() !== 'active') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Package is not active' });
    }

    const totals = {
      sessions_total: Number(pkg.sessions_total) || 0,
      mask_total: Number(pkg.mask_total) || 0,
    };

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

    const counts = usageCounts.rows[0] || { sessions_used: 0, mask_used: 0, last_session_no: 0 };
    const sessionsRemaining = Math.max(totals.sessions_total - Number(counts.sessions_used || 0), 0);
    const maskRemaining = Math.max(totals.mask_total - Number(counts.mask_used || 0), 0);

    if (sessionsRemaining <= 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'No remaining sessions for this package' });
    }

    if (usedMask) {
      if (totals.mask_total <= 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'This package has no mask allowance' });
      }
      if (maskRemaining <= 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ ok: false, error: 'No remaining masks for this package' });
      }
    }

    const nextSessionNo = Number(counts.last_session_no || 0) + 1;

    const usageInsert = await client.query(
      `
        INSERT INTO package_usages
          (id, customer_package_id, appointment_id, session_no, used_mask, used_at, staff_id, note)
        VALUES
          (gen_random_uuid(), $1, $2, $3, $4, now(), $5, NULL)
        RETURNING id
      `,
      [customerPackageId, appointment.id, nextSessionNo, usedMask, staffId]
    );

    await client.query(
      `
        UPDATE appointments
        SET status = 'completed',
            updated_at = now()
        WHERE id = $1
      `,
      [appointment.id]
    );

    await client.query(
      `
        INSERT INTO appointment_events (id, appointment_id, event_type, event_at, actor, note, meta)
        VALUES (gen_random_uuid(), $1, 'redeemed', now(), 'staff', NULL, $2::jsonb)
      `,
      [
        appointment.id,
        JSON.stringify({
          staff_id: staffId,
          staff_user_id: req.user?.id || null,
          staff_display_name: safeDisplayName(req.user),
          customer_package_id: customerPackageId,
          package_code: pkg.package_code,
          session_no: nextSessionNo,
          used_mask: usedMask,
          usage_id: usageInsert.rows[0]?.id || null,
        }),
      ]
    );

    await client.query('COMMIT');
    return res.json({
      ok: true,
      data: {
        appointment_id: appointment.id,
        status: 'completed',
        usage: {
          customer_package_id: customerPackageId,
          package_code: pkg.package_code,
          session_no: nextSessionNo,
          used_mask: usedMask,
        },
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
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

async function setAppointmentStatus({ req, res, nextStatus, eventType }) {
  const appointmentId = String(req.params?.id || '').trim();
  const noteRaw = typeof req.body?.note === 'string'
    ? req.body.note.trim()
    : typeof req.body?.reason === 'string'
      ? req.body.reason.trim()
      : '';
  const note = noteRaw || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const appointment = await resolveAppointment(client, appointmentId, { forUpdate: true });
    if (!appointment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Appointment not found' });
    }

    const currentStatus = String(appointment.status || '').toLowerCase();
    if (!['booked', 'rescheduled'].includes(currentStatus)) {
      await client.query('ROLLBACK');
      return res
        .status(409)
        .json({ ok: false, error: `Cannot change status from: ${currentStatus}` });
    }

    await client.query(
      `
        UPDATE appointments
        SET status = $2,
            updated_at = now()
        WHERE id = $1
      `,
      [appointment.id, nextStatus]
    );

    await client.query(
      `
        INSERT INTO appointment_events (id, appointment_id, event_type, event_at, actor, note, meta)
        VALUES (gen_random_uuid(), $1, $2, now(), 'staff', $3, $4::jsonb)
      `,
      [
        appointment.id,
        eventType,
        note,
        JSON.stringify({
          previous_status: currentStatus,
          next_status: nextStatus,
          staff_user_id: req.user?.id || null,
          staff_display_name: safeDisplayName(req.user),
          note,
        }),
      ]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, data: { appointment_id: appointment.id, status: nextStatus } });
  } catch (error) {
    await client.query('ROLLBACK');
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

export async function cancelAppointment(req, res) {
  return setAppointmentStatus({
    req,
    res,
    nextStatus: 'cancelled',
    eventType: 'cancelled',
  });
}

export async function noShowAppointment(req, res) {
  return setAppointmentStatus({
    req,
    res,
    nextStatus: 'no_show',
    eventType: 'no_show',
  });
}

export async function revertAppointment(req, res) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  const appointmentId = String(req.params?.id || '').trim();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const appointment = await resolveAppointment(client, appointmentId, { forUpdate: true });
    if (!appointment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Appointment not found' });
    }

    const currentStatus = String(appointment.status || '').toLowerCase();
    if (currentStatus !== 'completed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, error: 'Only completed appointments can be reverted' });
    }

    const usageResult = await client.query(
      `
        SELECT id, customer_package_id, session_no, used_mask
        FROM package_usages
        WHERE appointment_id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [appointment.id]
    );

    if (usageResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Usage record not found for this appointment' });
    }

    const usage = usageResult.rows[0];

    await client.query('DELETE FROM package_usages WHERE id = $1', [usage.id]);

    await client.query(
      `
        UPDATE appointments
        SET status = 'booked',
            updated_at = now()
        WHERE id = $1
      `,
      [appointment.id]
    );

    await client.query(
      `
        INSERT INTO appointment_events (id, appointment_id, event_type, event_at, actor, note, meta)
        VALUES (gen_random_uuid(), $1, 'redeemed', now(), 'staff', 'revert usage', $2::jsonb)
      `,
      [
        appointment.id,
        JSON.stringify({
          action: 'revert',
          staff_user_id: req.user?.id || null,
          staff_display_name: safeDisplayName(req.user),
          reverted_usage_id: usage.id,
          customer_package_id: usage.customer_package_id,
          session_no: usage.session_no,
          used_mask: usage.used_mask,
        }),
      ]
    );

    await client.query('COMMIT');
    return res.json({ ok: true, data: { appointment_id: appointment.id, status: 'booked' } });
  } catch (error) {
    await client.query('ROLLBACK');
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
