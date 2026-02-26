import 'dotenv/config';
import { pool } from '../src/db.js';
import { formatTreatmentDisplay } from '../src/utils/formatTreatmentDisplay.js';
import { resolveTreatmentDisplay } from '../src/utils/treatmentDisplay.js';

const DEFAULT_TREATMENT_ID = 'f8c60310-abc0-4eaf-ae3a-e9e9e0e06dc0';
const SMOOTH_DISPLAY_NAME = 'Smooth';
const TARGET_METADATA = Object.freeze({
  price_thb: 399,
  sessions_included: 1,
  mask_included: 0,
});
const KNOWN_APPOINTMENT_IDS = [
  'a0a94f48-2978-4b31-86c5-550907087ffe',
  '67534e27-7e4b-4025-9391-3679ce5d2ef4',
  '8cf6f086-bb37-4577-892e-257b363eb670',
];
const REQUIRED_COLUMNS = ['name_en', 'name_th', 'price_thb', 'sessions_included', 'mask_included'];

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseArgs(argv) {
  let hasApply = false;
  let hasDryRun = false;
  let force = false;
  let treatmentId = '';

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;

    if (token === '--apply') {
      hasApply = true;
      continue;
    }
    if (token === '--dry-run') {
      hasDryRun = true;
      continue;
    }
    if (token === '--force') {
      force = true;
      continue;
    }
    if (token === '--treatment-id' && argv[i + 1]) {
      treatmentId = normalizeText(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith('--treatment-id=')) {
      treatmentId = normalizeText(token.slice('--treatment-id='.length));
      continue;
    }
  }

  if (hasApply && hasDryRun) {
    throw new Error('Use either --apply or --dry-run, not both.');
  }

  return {
    apply: hasApply,
    dryRun: !hasApply,
    force,
    treatmentId: treatmentId || '',
  };
}

function assertTargetMetadata() {
  const checks = [
    ['price_thb', TARGET_METADATA.price_thb, { min: 1, max: 100000 }],
    ['sessions_included', TARGET_METADATA.sessions_included, { min: 1, max: 100 }],
    ['mask_included', TARGET_METADATA.mask_included, { min: 0, max: 100 }],
  ];

  for (const [field, value, range] of checks) {
    if (!Number.isInteger(value)) {
      throw new Error(`Invalid target ${field}: must be integer`);
    }
    if (value < range.min || value > range.max) {
      throw new Error(`Invalid target ${field}: out of sensible range`);
    }
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalizeText(value)
  );
}

function toNullableInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function printRowsSection(title, rows) {
  console.log('');
  console.log(`=== ${title} ===`);
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('(none)');
    return;
  }
  for (const row of rows) {
    console.log(JSON.stringify(row, null, 2));
  }
}

function columnExists(columns, name) {
  return columns.some((col) => normalizeText(col.column_name) === name);
}

function buildFieldDiff(beforeRow) {
  const before = {
    price_thb: toNullableInt(beforeRow.price_thb),
    sessions_included: toNullableInt(beforeRow.sessions_included),
    mask_included: toNullableInt(beforeRow.mask_included),
  };
  const after = {
    price_thb: TARGET_METADATA.price_thb,
    sessions_included: TARGET_METADATA.sessions_included,
    mask_included: TARGET_METADATA.mask_included,
  };

  return { before, after };
}

function isLegacyOrUnset(field, value) {
  if (value === null || value === undefined) return true;
  const intValue = toNullableInt(value);
  if (intValue === null) return true;
  if (field === 'price_thb') return intValue === 0;
  if (field === 'sessions_included') return intValue === 0;
  if (field === 'mask_included') return intValue === 0;
  return false;
}

function evaluateSafety({ diff, force }) {
  const conflicting = [];
  const alreadyTarget = [];
  const requiresChange = [];

  for (const field of Object.keys(diff.after)) {
    const beforeValue = diff.before[field];
    const nextValue = diff.after[field];
    if (beforeValue === nextValue) {
      alreadyTarget.push(field);
      continue;
    }
    if (isLegacyOrUnset(field, beforeValue)) {
      requiresChange.push(field);
      continue;
    }
    conflicting.push({
      field,
      before: beforeValue,
      after: nextValue,
      reason: 'non-null/non-legacy value',
    });
  }

  if (conflicting.length > 0 && !force) {
    const err = new Error('Refusing to overwrite non-legacy metadata without --force');
    err.code = 'SAFETY_BLOCK';
    err.details = conflicting;
    throw err;
  }

  return {
    conflicting,
    alreadyTarget,
    requiresChange,
    alreadyMigrated: requiresChange.length === 0 && conflicting.length === 0,
  };
}

async function fetchColumns(client) {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'treatments'
      ORDER BY ordinal_position
    `
  );
  return result.rows || [];
}

async function findSmoothRows(client) {
  const result = await client.query(
    `
      SELECT
        t.id,
        t.code,
        COALESCE(NULLIF(to_jsonb(t)->>'name_th', ''), NULLIF(t.title_th, '')) AS name_th,
        COALESCE(NULLIF(to_jsonb(t)->>'name_en', ''), NULLIF(t.title_en, '')) AS name_en,
        CASE
          WHEN COALESCE(to_jsonb(t)->>'price_thb', '') ~ '^-?[0-9]+$'
            THEN (to_jsonb(t)->>'price_thb')::int
          ELSE NULL
        END AS price_thb,
        CASE
          WHEN COALESCE(to_jsonb(t)->>'sessions_included', '') ~ '^-?[0-9]+$'
            THEN (to_jsonb(t)->>'sessions_included')::int
          ELSE NULL
        END AS sessions_included,
        CASE
          WHEN COALESCE(to_jsonb(t)->>'mask_included', '') ~ '^-?[0-9]+$'
            THEN (to_jsonb(t)->>'mask_included')::int
          ELSE NULL
        END AS mask_included
      FROM treatments t
      WHERE t.id = $1
         OR LOWER(COALESCE(NULLIF(to_jsonb(t)->>'name_en', ''), NULLIF(t.title_en, ''), '')) LIKE '%smooth%'
         OR COALESCE(NULLIF(to_jsonb(t)->>'name_th', ''), NULLIF(t.title_th, ''), '') LIKE '%บำบัดผิวใส%'
      ORDER BY t.id ASC
    `,
    [DEFAULT_TREATMENT_ID]
  );
  return result.rows || [];
}

async function fetchTreatmentById(client, treatmentId) {
  const result = await client.query(
    `
      SELECT
        t.id,
        t.code,
        COALESCE(NULLIF(to_jsonb(t)->>'name_th', ''), NULLIF(t.title_th, '')) AS name_th,
        COALESCE(NULLIF(to_jsonb(t)->>'name_en', ''), NULLIF(t.title_en, '')) AS name_en,
        CASE
          WHEN COALESCE(to_jsonb(t)->>'price_thb', '') ~ '^-?[0-9]+$'
            THEN (to_jsonb(t)->>'price_thb')::int
          ELSE NULL
        END AS price_thb,
        CASE
          WHEN COALESCE(to_jsonb(t)->>'sessions_included', '') ~ '^-?[0-9]+$'
            THEN (to_jsonb(t)->>'sessions_included')::int
          ELSE NULL
        END AS sessions_included,
        CASE
          WHEN COALESCE(to_jsonb(t)->>'mask_included', '') ~ '^-?[0-9]+$'
            THEN (to_jsonb(t)->>'mask_included')::int
          ELSE NULL
        END AS mask_included
      FROM treatments t
      WHERE t.id = $1
      LIMIT 1
    `,
    [treatmentId]
  );
  return result.rows[0] || null;
}

function pickTargetRow({ smoothRows, treatmentId, force }) {
  if (treatmentId) {
    return {
      mode: 'explicit',
      treatmentId,
    };
  }

  if (smoothRows.length === 0) {
    const err = new Error('No Smooth treatment rows found.');
    err.code = 'TARGET_NOT_FOUND';
    throw err;
  }

  if (smoothRows.length > 1) {
    const err = new Error(
      'Multiple Smooth-like treatment rows found. Use --treatment-id=<uuid> explicitly.'
    );
    err.code = 'AMBIGUOUS_TARGET';
    err.details = smoothRows.map((row) => ({
      id: row.id,
      code: row.code,
      name_en: row.name_en,
      name_th: row.name_th,
    }));
    throw err;
  }

  const onlyRow = smoothRows[0];
  const onlyId = normalizeText(onlyRow.id);
  if (onlyId !== DEFAULT_TREATMENT_ID && !force) {
    const err = new Error(
      `Auto-target is locked to ${DEFAULT_TREATMENT_ID}. Found ${onlyId}. Use --treatment-id or --force.`
    );
    err.code = 'UNEXPECTED_AUTO_TARGET';
    err.details = onlyRow;
    throw err;
  }

  return {
    mode: 'auto',
    treatmentId: onlyId,
  };
}

async function ensureAuditLogsTable(client) {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.audit_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id uuid,
      before_json jsonb,
      after_json jsonb,
      meta_json jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS audit_logs_action_created_at_idx
    ON public.audit_logs (action, created_at DESC);
  `);
}

async function ensureMissingColumns(client, missingColumns) {
  for (const col of missingColumns) {
    if (col === 'name_en' || col === 'name_th') {
      await client.query(`ALTER TABLE public.treatments ADD COLUMN IF NOT EXISTS ${col} text;`);
      continue;
    }
    if (col === 'price_thb' || col === 'sessions_included' || col === 'mask_included') {
      await client.query(`ALTER TABLE public.treatments ADD COLUMN IF NOT EXISTS ${col} integer;`);
    }
  }
}

async function applyUpdate(client, { targetRow, diff, hasUpdatedAt, missingColumns, force }) {
  await client.query('BEGIN');
  try {
    if (missingColumns.length > 0) {
      await ensureMissingColumns(client, missingColumns);
    }

    await ensureAuditLogsTable(client);

    const setParts = [
      'price_thb = $2',
      'sessions_included = $3',
      'mask_included = $4',
    ];
    if (hasUpdatedAt) {
      setParts.push('updated_at = now()');
    }

    const updateResult = await client.query(
      `
        UPDATE public.treatments
        SET ${setParts.join(', ')}
        WHERE id = $1
      `,
      [targetRow.id, diff.after.price_thb, diff.after.sessions_included, diff.after.mask_included]
    );
    if (updateResult.rowCount !== 1) {
      throw new Error(`Unexpected updated rows: ${updateResult.rowCount}`);
    }

    await client.query(
      `
        INSERT INTO public.audit_logs (action, entity_type, entity_id, before_json, after_json, meta_json)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
      `,
      [
        'CATALOG_MIGRATE_TREATMENT_FIELDS',
        'treatment',
        targetRow.id,
        JSON.stringify(diff.before),
        JSON.stringify(diff.after),
        JSON.stringify({
          script: 'backend/scripts/migrate_treatments_catalog_fields.js',
          force: Boolean(force),
          dry_run: false,
        }),
      ]
    );

    await client.query('COMMIT');
    return updateResult.rowCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function printAppointmentDisplaySnapshot(client, treatmentId) {
  const result = await client.query(
    `
      SELECT
        a.id AS appointment_id,
        a.treatment_id,
        t.code AS treatment_code,
        COALESCE(NULLIF(to_jsonb(t)->>'name_en', ''), NULLIF(t.title_en, '')) AS treatment_name_en,
        COALESCE(NULLIF(to_jsonb(t)->>'name_th', ''), NULLIF(t.title_th, '')) AS treatment_name_th,
        CASE
          WHEN COALESCE(to_jsonb(t)->>'price_thb', '') ~ '^-?[0-9]+$'
            THEN (to_jsonb(t)->>'price_thb')::int
          ELSE NULL
        END AS treatment_price,
        CASE
          WHEN COALESCE(to_jsonb(t)->>'sessions_included', '') ~ '^-?[0-9]+$'
            THEN (to_jsonb(t)->>'sessions_included')::int
          ELSE NULL
        END AS treatment_sessions,
        CASE
          WHEN COALESCE(to_jsonb(t)->>'mask_included', '') ~ '^-?[0-9]+$'
            THEN (to_jsonb(t)->>'mask_included')::int
          ELSE NULL
        END AS treatment_mask
      FROM appointments a
      LEFT JOIN treatments t ON t.id = a.treatment_id
      WHERE a.id = ANY($1::uuid[])
        AND a.treatment_id = $2
      ORDER BY a.id
    `,
    [KNOWN_APPOINTMENT_IDS, treatmentId]
  );

  const rows = (result.rows || []).map((row) => {
    const resolved = resolveTreatmentDisplay({
      treatmentId: row.treatment_id,
      treatmentNameEn: row.treatment_name_en,
      treatmentNameTh: row.treatment_name_th,
      treatmentCode: row.treatment_code,
      treatmentSessions: row.treatment_sessions,
      treatmentMask: row.treatment_mask,
      treatmentPrice: row.treatment_price,
      legacyText: '',
    });
    return {
      appointment_id: row.appointment_id,
      treatment_id: row.treatment_id,
      treatment_display: resolved.treatment_display,
    };
  });

  printRowsSection('Optional Appointment Display Snapshot', rows);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  assertTargetMetadata();

  if (args.treatmentId && !isUuid(args.treatmentId)) {
    throw new Error('Invalid --treatment-id value (must be UUID).');
  }

  const client = await pool.connect();
  try {
    await client.query('SELECT 1');

    console.log(
      `[migrate_treatments_catalog_fields] mode=${args.dryRun ? 'dry-run' : 'apply'} force=${args.force}`
    );

    const columns = await fetchColumns(client);
    const missingColumns = REQUIRED_COLUMNS.filter((col) => !columnExists(columns, col));
    const hasUpdatedAt = columnExists(columns, 'updated_at');

    const smoothRows = await findSmoothRows(client);
    printRowsSection('Matched Smooth Treatments', smoothRows);

    const targetSelection = pickTargetRow({
      smoothRows,
      treatmentId: args.treatmentId,
      force: args.force,
    });
    const targetRow = await fetchTreatmentById(client, targetSelection.treatmentId);
    if (!targetRow) {
      throw new Error(`Target treatment not found: ${targetSelection.treatmentId}`);
    }

    const diff = buildFieldDiff(targetRow);
    const safety = evaluateSafety({ diff, force: args.force });

    console.log('');
    console.log('=== Plan ===');
    console.log(`target_selection: ${targetSelection.mode}`);
    console.log(`treatment_id: ${targetRow.id}`);
    console.log(`code: ${normalizeText(targetRow.code) || '(empty)'}`);
    console.log(`name_en: ${normalizeText(targetRow.name_en) || '(empty)'}`);
    console.log(`name_th: ${normalizeText(targetRow.name_th) || '(empty)'}`);
    console.log(`missing_columns: ${missingColumns.length > 0 ? missingColumns.join(', ') : '(none)'}`);
    console.log(`updated_at_column: ${hasUpdatedAt ? 'present' : 'absent (skip updated_at)'}`);
    for (const field of Object.keys(diff.after)) {
      const beforeValue = diff.before[field];
      const afterValue = diff.after[field];
      console.log(`- ${field}: ${beforeValue === null ? 'NULL' : beforeValue} -> ${afterValue}`);
    }
    if (safety.conflicting.length > 0) {
      console.log(`conflicts: ${JSON.stringify(safety.conflicting)}`);
    }

    if (safety.alreadyMigrated && missingColumns.length === 0) {
      console.log('');
      console.log('[migrate_treatments_catalog_fields] already migrated (no write required)');
      const display = formatTreatmentDisplay({
        name_en: normalizeText(targetRow.name_en) || SMOOTH_DISPLAY_NAME,
        name_th: normalizeText(targetRow.name_th),
        treatment_code: normalizeText(targetRow.code),
        price_thb: diff.after.price_thb,
        sessions_included: diff.after.sessions_included,
        mask_included: diff.after.mask_included,
      });
      console.log(`[formatter-smoke] ${display}`);
      await printAppointmentDisplaySnapshot(client, targetRow.id);
      return;
    }

    if (args.dryRun) {
      console.log('');
      console.log('[migrate_treatments_catalog_fields] DRY RUN ONLY (no writes executed)');
      const projectedDisplay = formatTreatmentDisplay({
        name_en: normalizeText(targetRow.name_en) || SMOOTH_DISPLAY_NAME,
        name_th: normalizeText(targetRow.name_th),
        treatment_code: normalizeText(targetRow.code),
        price_thb: diff.after.price_thb,
        sessions_included: diff.after.sessions_included,
        mask_included: diff.after.mask_included,
      });
      console.log(`[formatter-smoke projected] ${projectedDisplay}`);
      await printAppointmentDisplaySnapshot(client, targetRow.id);
      return;
    }

    const affected = await applyUpdate(client, {
      targetRow,
      diff,
      hasUpdatedAt,
      missingColumns,
      force: args.force,
    });

    const afterRow = await fetchTreatmentById(client, targetRow.id);
    printRowsSection('Applied', [
      {
        treatment_id: targetRow.id,
        rows_affected: affected,
      },
    ]);
    printRowsSection('After Row', [afterRow]);

    const display = formatTreatmentDisplay({
      name_en: normalizeText(afterRow?.name_en) || SMOOTH_DISPLAY_NAME,
      name_th: normalizeText(afterRow?.name_th),
      treatment_code: normalizeText(afterRow?.code),
      price_thb: toNullableInt(afterRow?.price_thb),
      sessions_included: toNullableInt(afterRow?.sessions_included),
      mask_included: toNullableInt(afterRow?.mask_included),
    });
    console.log(`[formatter-smoke] ${display}`);
    await printAppointmentDisplaySnapshot(client, targetRow.id);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[migrate_treatments_catalog_fields] FAILED', error?.message || error);
  if (error?.details) {
    console.error(JSON.stringify(error.details, null, 2));
  }
  process.exitCode = 1;
});
