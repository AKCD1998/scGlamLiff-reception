import 'dotenv/config';
import { pool } from '../src/db.js';
import { resolveAppointmentFields } from '../src/utils/resolveAppointmentFields.js';
import { resolvePackageIdForBooking } from '../src/utils/resolvePackageIdForBooking.js';

const TARGET_APPOINTMENT_IDS = [
  '216cb944-5d28-4945-b4a8-56c90b42cc89',
  'a0a94f48-2978-4b31-86c5-550907087ffe',
  '67534e27-7e4b-4025-9391-3679ce5d2ef4',
  '8cf6f086-bb37-4577-892e-257b363eb670',
  'c533384d-b8a1-4c4b-ac8a-d74c0d86f887',
  '88b896df-6949-46cd-bbcf-8c82cd887839',
];

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseMeta(rawMeta) {
  if (!rawMeta) return {};
  if (typeof rawMeta === 'object' && !Array.isArray(rawMeta)) return rawMeta;
  if (typeof rawMeta === 'string') {
    try {
      const parsed = JSON.parse(rawMeta);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function readField(meta, key) {
  const after = meta?.after && typeof meta.after === 'object' ? meta.after : null;
  if (after && hasOwn(after, key)) return after[key];
  if (hasOwn(meta, key)) return meta[key];
  return undefined;
}

function latestSingleRowSnapshot(events) {
  const event = Array.isArray(events) && events.length > 0 ? events[0] : null;
  const meta = parseMeta(event?.meta);
  return {
    package_id: normalizeText(readField(meta, 'package_id')),
    treatment_plan_mode: normalizeText(readField(meta, 'treatment_plan_mode')),
    treatment_item_text: normalizeText(readField(meta, 'treatment_item_text')),
    event_id: normalizeText(event?.id),
    event_type: normalizeText(event?.event_type),
    event_at: event?.event_at || null,
  };
}

async function loadAppointments(client, ids) {
  const result = await client.query(
    `
      SELECT
        a.id AS appointment_id,
        a.customer_id,
        a.treatment_id,
        a.source,
        a.status,
        a.created_at,
        COALESCE(NULLIF(t.code, ''), '') AS treatment_code,
        COALESCE(NULLIF(t.title_th, ''), NULLIF(t.title_en, ''), NULLIF(t.code, ''), '') AS treatment_name
      FROM appointments a
      LEFT JOIN treatments t ON t.id = a.treatment_id
      WHERE a.id = ANY($1::uuid[])
      ORDER BY a.created_at ASC
    `,
    [ids]
  );

  const byId = new Map();
  for (const row of result.rows || []) {
    byId.set(normalizeText(row.appointment_id), row);
  }
  return byId;
}

async function loadFieldEvents(client, ids) {
  const result = await client.query(
    `
      SELECT
        ae.appointment_id,
        ae.id,
        ae.event_type,
        ae.event_at,
        ae.meta
      FROM appointment_events ae
      WHERE ae.appointment_id = ANY($1::uuid[])
        AND (
          COALESCE(ae.meta->'after', '{}'::jsonb) ? 'treatment_item_text'
          OR ae.meta ? 'treatment_item_text'
          OR COALESCE(ae.meta->'after', '{}'::jsonb) ? 'treatment_plan_mode'
          OR ae.meta ? 'treatment_plan_mode'
          OR COALESCE(ae.meta->'after', '{}'::jsonb) ? 'package_id'
          OR ae.meta ? 'package_id'
          OR COALESCE(ae.meta->'after', '{}'::jsonb) ? 'unlink_package'
          OR ae.meta ? 'unlink_package'
          OR COALESCE(ae.meta->'after', '{}'::jsonb) ? 'package_unlinked'
          OR ae.meta ? 'package_unlinked'
        )
      ORDER BY ae.appointment_id ASC, ae.event_at DESC NULLS LAST, ae.id DESC
    `,
    [ids]
  );

  const grouped = new Map();
  for (const row of result.rows || []) {
    const appointmentId = normalizeText(row.appointment_id);
    if (!appointmentId) continue;
    if (!grouped.has(appointmentId)) grouped.set(appointmentId, []);
    grouped.get(appointmentId).push(row);
  }
  return grouped;
}

async function main() {
  const applyMode = process.argv.includes('--apply');
  const dryRun = !applyMode;
  const ids = TARGET_APPOINTMENT_IDS;

  console.log(`[backfill_missing_package_meta] mode=${dryRun ? 'dry-run' : 'apply'}`);
  console.log(`[backfill_missing_package_meta] appointment_ids=${ids.join(', ')}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const appointmentById = await loadAppointments(client, ids);
    const eventsByAppointmentId = await loadFieldEvents(client, ids);

    const reportRows = [];
    let appliedCount = 0;

    for (const appointmentId of ids) {
      const appointment = appointmentById.get(appointmentId);
      if (!appointment) {
        reportRows.push({
          appointment_id: appointmentId,
          status: 'MISSING_APPOINTMENT',
          action: 'skip',
          reason: 'appointment not found',
        });
        continue;
      }

      const events = eventsByAppointmentId.get(appointmentId) || [];
      const latestSnapshot = latestSingleRowSnapshot(events);
      const resolved = resolveAppointmentFields(events);

      const fallbackText =
        normalizeText(resolved.treatment_item_text) ||
        normalizeText(latestSnapshot.treatment_item_text) ||
        normalizeText(appointment.treatment_name);

      let targetPackageId = normalizeText(resolved.package_id);
      let packageSource = targetPackageId ? 'resolver' : 'none';
      if (!targetPackageId && fallbackText) {
        targetPackageId =
          (await resolvePackageIdForBooking(client, {
            explicitPackageId: '',
            treatmentItemText: fallbackText,
          })) || '';
        if (targetPackageId) {
          packageSource = 'legacy_text_inference';
        }
      }

      const targetPlanMode =
        normalizeText(resolved.treatment_plan_mode) || (targetPackageId ? 'package' : '');
      const targetTreatmentText =
        normalizeText(resolved.treatment_item_text) || normalizeText(latestSnapshot.treatment_item_text);

      const packageNeedsBackfill = !normalizeText(latestSnapshot.package_id) && Boolean(targetPackageId);
      const modeNeedsBackfill =
        !normalizeText(latestSnapshot.treatment_plan_mode) &&
        normalizeText(targetPlanMode) === 'package' &&
        packageNeedsBackfill;
      const textNeedsBackfill =
        !normalizeText(latestSnapshot.treatment_item_text) && Boolean(targetTreatmentText);

      const before = {};
      const after = {};
      if (packageNeedsBackfill) {
        before.package_id = latestSnapshot.package_id || null;
        after.package_id = targetPackageId;
      }
      if (modeNeedsBackfill) {
        before.treatment_plan_mode = latestSnapshot.treatment_plan_mode || null;
        after.treatment_plan_mode = targetPlanMode;
      }
      if (textNeedsBackfill) {
        before.treatment_item_text = latestSnapshot.treatment_item_text || null;
        after.treatment_item_text = targetTreatmentText;
      }

      const changedFields = Object.keys(after);
      const shouldApply = changedFields.length > 0;

      reportRows.push({
        appointment_id: appointmentId,
        source: appointment.source,
        status: appointment.status,
        latest_single_snapshot: latestSnapshot,
        resolved_per_field: resolved,
        target: {
          package_id: targetPackageId || null,
          treatment_plan_mode: targetPlanMode || null,
          treatment_item_text: targetTreatmentText || null,
          package_source: packageSource,
        },
        changed_fields: changedFields,
        action: shouldApply ? (dryRun ? 'would_append_event' : 'append_event') : 'skip',
      });

      if (!shouldApply || dryRun) continue;

      const eventMeta = {
        source: 'script_backfill_missing_package_meta',
        reason: 'backfill missing package metadata',
        changed_fields: changedFields,
        before,
        after,
        actor: 'system',
        unlink_package: false,
        script: 'backend/scripts/backfill_missing_package_meta.js',
      };

      await client.query(
        `
          INSERT INTO appointment_events (id, appointment_id, event_type, event_at, actor, note, meta)
          VALUES (
            gen_random_uuid(),
            $1,
            'ADMIN_APPOINTMENT_UPDATE',
            now(),
            'system',
            $2,
            $3::jsonb
          )
        `,
        [appointmentId, 'script backfill missing package meta', JSON.stringify(eventMeta)]
      );
      appliedCount += 1;
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    for (const row of reportRows) {
      console.log(JSON.stringify(row));
    }
    console.log(
      `[backfill_missing_package_meta] ${dryRun ? 'DRY_RUN_COMPLETE' : 'APPLY_COMPLETE'} events_written=${appliedCount}`
    );
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[backfill_missing_package_meta] FAILED', error?.message || error);
    process.exit(1);
  } finally {
    client.release();
  }
}

main();
