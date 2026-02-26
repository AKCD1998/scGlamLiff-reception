import 'dotenv/config';
import { pool } from '../src/db.js';
import { resolveAppointmentFieldsByAppointmentId } from '../src/utils/resolveAppointmentFields.js';

const TARGET_TREATMENT_ID = 'f8c60310-abc0-4eaf-ae3a-e9e9e0e06dc0';
const DEFAULT_LOOKBACK_DAYS = 180;
const DEFAULT_LIMIT = 2000;

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const lookbackToken = argv.find((arg) => String(arg).startsWith('--days='));
  const limitToken = argv.find((arg) => String(arg).startsWith('--limit='));

  const lookbackDaysRaw = lookbackToken ? Number.parseInt(lookbackToken.split('=')[1], 10) : DEFAULT_LOOKBACK_DAYS;
  const limitRaw = limitToken ? Number.parseInt(limitToken.split('=')[1], 10) : DEFAULT_LIMIT;

  const lookbackDays = Number.isFinite(lookbackDaysRaw) && lookbackDaysRaw > 0
    ? lookbackDaysRaw
    : DEFAULT_LOOKBACK_DAYS;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 10000) : DEFAULT_LIMIT;

  return { apply, lookbackDays, limit };
}

function matchKnownTreatmentText(rawText) {
  const text = normalizeText(rawText);
  if (!text) return null;

  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  const rules = [
    {
      key: 'thai_plain',
      regex: /บำบัดผิวใส\s*ให้เรียบเนียน$/,
    },
    {
      key: 'thai_with_price',
      regex: /บำบัดผิวใส\s*ให้เรียบเนียน\s*\(\s*399\s*\)$/,
    },
    {
      key: 'smooth_399',
      regex: /^smooth\s*[\(\-]?\s*399\s*\)?$/,
    },
  ];

  for (const rule of rules) {
    if (rule.regex.test(text) || rule.regex.test(normalized)) {
      return {
        treatment_id: TARGET_TREATMENT_ID,
        confidence: 'high',
        rule: rule.key,
      };
    }
  }

  return null;
}

async function ensureAuditTable(client) {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.maintenance_audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      scope text NOT NULL,
      entity_type text NOT NULL,
      entity_id uuid,
      action text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS maintenance_audit_logs_scope_created_idx
    ON public.maintenance_audit_logs (scope, created_at DESC);
  `);
}

async function loadAppointments(client, { lookbackDays, limit }) {
  const result = await client.query(
    `
      SELECT
        a.id AS appointment_id,
        a.treatment_id,
        a.created_at,
        a.source,
        COALESCE(NULLIF(t.code, ''), '') AS treatment_code,
        COALESCE(
          NULLIF(to_jsonb(t)->>'name_en', ''),
          NULLIF(t.title_en, ''),
          NULLIF(to_jsonb(t)->>'name_th', ''),
          NULLIF(t.title_th, ''),
          NULLIF(t.code, ''),
          ''
        ) AS treatment_name
      FROM appointments a
      LEFT JOIN treatments t ON t.id = a.treatment_id
      WHERE a.created_at >= now() - ($1::text || ' days')::interval
      ORDER BY a.created_at DESC
      LIMIT $2
    `,
    [String(lookbackDays), limit]
  );
  return result.rows || [];
}

async function loadEventsForAppointments(client, appointmentIds) {
  if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) return [];
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
          OR COALESCE(ae.meta->'after', '{}'::jsonb) ? 'treatment_id'
          OR ae.meta ? 'treatment_id'
        )
      ORDER BY ae.appointment_id ASC, ae.event_at DESC NULLS LAST, ae.id DESC
    `,
    [appointmentIds]
  );
  return result.rows || [];
}

async function main() {
  const { apply, lookbackDays, limit } = parseArgs(process.argv.slice(2));
  const mode = apply ? 'apply' : 'dry-run';

  console.log(`[backfill_treatment_id_from_text] mode=${mode}`);
  console.log(`[backfill_treatment_id_from_text] lookback_days=${lookbackDays} limit=${limit}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const appointments = await loadAppointments(client, { lookbackDays, limit });
    const appointmentIds = appointments
      .map((row) => normalizeText(row.appointment_id))
      .filter(Boolean);
    const eventRows = await loadEventsForAppointments(client, appointmentIds);
    const resolvedFieldsByAppointmentId = resolveAppointmentFieldsByAppointmentId(eventRows);

    const reportRows = [];
    const candidateRows = [];

    for (const row of appointments) {
      const appointmentId = normalizeText(row.appointment_id);
      const resolvedFields = resolvedFieldsByAppointmentId.get(appointmentId) || {};
      const treatmentItemText = normalizeText(resolvedFields.treatment_item_text);
      const inferred = matchKnownTreatmentText(treatmentItemText);
      const currentTreatmentId = normalizeText(row.treatment_id);
      const currentCode = normalizeText(row.treatment_code).toLowerCase();

      if (!inferred) {
        reportRows.push({
          appointment_id: appointmentId,
          action: 'skip',
          reason: 'text_not_matched',
          treatment_item_text: treatmentItemText || null,
          current_treatment_id: currentTreatmentId || null,
          current_treatment_code: currentCode || null,
        });
        continue;
      }

      if (currentTreatmentId === TARGET_TREATMENT_ID) {
        reportRows.push({
          appointment_id: appointmentId,
          action: 'skip',
          reason: 'already_mapped',
          rule: inferred.rule,
          treatment_item_text: treatmentItemText || null,
          current_treatment_id: currentTreatmentId,
          current_treatment_code: currentCode || null,
        });
        continue;
      }

      if (currentCode && currentCode !== 'smooth') {
        reportRows.push({
          appointment_id: appointmentId,
          action: 'skip',
          reason: 'ambiguous_current_treatment',
          rule: inferred.rule,
          treatment_item_text: treatmentItemText || null,
          current_treatment_id: currentTreatmentId || null,
          current_treatment_code: currentCode,
        });
        continue;
      }

      candidateRows.push({
        appointment_id: appointmentId,
        before_treatment_id: currentTreatmentId || null,
        after_treatment_id: TARGET_TREATMENT_ID,
        treatment_item_text: treatmentItemText || null,
        matched_rule: inferred.rule,
        confidence: inferred.confidence,
      });
      reportRows.push({
        appointment_id: appointmentId,
        action: apply ? 'update' : 'would_update',
        reason: 'matched',
        before_treatment_id: currentTreatmentId || null,
        after_treatment_id: TARGET_TREATMENT_ID,
        treatment_item_text: treatmentItemText || null,
        matched_rule: inferred.rule,
      });
    }

    let appliedCount = 0;
    if (apply && candidateRows.length > 0) {
      await ensureAuditTable(client);

      for (const candidate of candidateRows) {
        await client.query(
          `
            UPDATE appointments
            SET treatment_id = $2,
                updated_at = now()
            WHERE id = $1
          `,
          [candidate.appointment_id, candidate.after_treatment_id]
        );

        const eventMeta = {
          source: 'script_backfill_treatment_id_from_text',
          reason: 'matched confident legacy treatment text',
          matched_rule: candidate.matched_rule,
          confidence: candidate.confidence,
          before: {
            treatment_id: candidate.before_treatment_id,
          },
          after: {
            treatment_id: candidate.after_treatment_id,
          },
          treatment_item_text: candidate.treatment_item_text,
          script: 'backend/scripts/backfill_treatment_id_from_text.js',
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
          [candidate.appointment_id, 'script backfill treatment_id from text', JSON.stringify(eventMeta)]
        );

        await client.query(
          `
            INSERT INTO maintenance_audit_logs (scope, entity_type, entity_id, action, details)
            VALUES ($1, $2, $3, $4, $5::jsonb)
          `,
          [
            'treatment_naming',
            'appointment',
            candidate.appointment_id,
            'UPDATE_TREATMENT_ID_FROM_TEXT',
            JSON.stringify(eventMeta),
          ]
        );

        appliedCount += 1;
      }
    }

    if (apply) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }

    for (const row of reportRows) {
      console.log(JSON.stringify(row));
    }
    console.log(
      `[backfill_treatment_id_from_text] scanned=${appointments.length} candidates=${candidateRows.length} applied=${appliedCount}`
    );
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[backfill_treatment_id_from_text] FAILED', error?.message || error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
