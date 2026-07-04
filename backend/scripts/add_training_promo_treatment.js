import 'dotenv/config';
import { pool } from '../src/db.js';
import { formatTreatmentDisplay } from '../src/utils/formatTreatmentDisplay.js';

const NEW_TREATMENT = Object.freeze({
  code: 'training_promo_facial',
  title_th: 'โครงการอบรมสร้างเสริมความรู้ความเข้าใจในระบบการจัดการด้านยา',
  title_en: 'โครงการอบรมสร้างเสริมความรู้ความเข้าใจในระบบการจัดการด้านยา',
  name_th: 'โครงการอบรมสร้างเสริมความรู้ความเข้าใจในระบบการจัดการด้านยา',
  name_en: '',
  price_thb: 0,
  sessions_included: 1,
  mask_included: 0,
});

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
  };
}

async function fetchColumns(client) {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'treatments'
    `
  );
  return (result.rows || []).map((row) => row.column_name);
}

async function run() {
  const { apply } = parseArgs(process.argv.slice(2));
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');

    const existing = await client.query(
      `SELECT id, code FROM treatments WHERE code = $1`,
      [NEW_TREATMENT.code]
    );
    if (existing.rows.length > 0) {
      console.log(`[add_training_promo_treatment] already exists: id=${existing.rows[0].id}`);
      return;
    }

    const columns = await fetchColumns(client);
    const hasNameEn = columns.includes('name_en');
    const hasNameTh = columns.includes('name_th');
    const hasCategory = columns.includes('category');
    const hasUpdatedAt = columns.includes('updated_at');

    const insertColumns = ['code', 'title_th', 'title_en', 'price_thb', 'sessions_included', 'mask_included', 'is_active', 'created_at'];
    const values = [NEW_TREATMENT.code, NEW_TREATMENT.title_th, NEW_TREATMENT.title_en, NEW_TREATMENT.price_thb, NEW_TREATMENT.sessions_included, NEW_TREATMENT.mask_included, true];
    if (hasNameEn) {
      insertColumns.splice(3, 0, 'name_en');
      values.splice(3, 0, NEW_TREATMENT.name_en);
    }
    if (hasNameTh) {
      insertColumns.splice(hasNameEn ? 4 : 3, 0, 'name_th');
      values.splice(hasNameEn ? 4 : 3, 0, NEW_TREATMENT.name_th);
    }
    if (hasCategory) {
      insertColumns.push('category');
      values.push('promo');
    }
    if (hasUpdatedAt) {
      insertColumns.push('updated_at');
    }

    const placeholders = values.map((_, i) => `$${i + 1}`);
    if (hasUpdatedAt) placeholders.push('now()');
    placeholders[insertColumns.indexOf('created_at')] = 'now()';

    const projectedDisplay = formatTreatmentDisplay({
      name_en: NEW_TREATMENT.name_en,
      name_th: NEW_TREATMENT.name_th,
      treatment_code: NEW_TREATMENT.code,
      price_thb: NEW_TREATMENT.price_thb,
      sessions_included: NEW_TREATMENT.sessions_included,
      mask_included: NEW_TREATMENT.mask_included,
    });

    console.log('[add_training_promo_treatment] Plan:');
    console.log(`  code: ${NEW_TREATMENT.code}`);
    console.log(`  title_th: ${NEW_TREATMENT.title_th}`);
    console.log(`  price_thb: ${NEW_TREATMENT.price_thb}`);
    console.log(`  sessions_included: ${NEW_TREATMENT.sessions_included}`);
    console.log(`  mask_included: ${NEW_TREATMENT.mask_included}`);
    console.log(`  projected dropdown label: ${projectedDisplay}`);

    if (!apply) {
      console.log('');
      console.log('[add_training_promo_treatment] DRY RUN ONLY (no writes executed). Re-run with --apply to insert.');
      return;
    }

    const sql = `
      INSERT INTO public.treatments (${insertColumns.join(', ')})
      VALUES (${placeholders.join(', ')})
      RETURNING id, code, title_th, price_thb, sessions_included, mask_included, is_active
    `;
    const result = await client.query(sql, values);
    console.log('');
    console.log('[add_training_promo_treatment] Inserted:');
    console.log(JSON.stringify(result.rows[0], null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[add_training_promo_treatment] FAILED', error?.message || error);
  process.exitCode = 1;
});
