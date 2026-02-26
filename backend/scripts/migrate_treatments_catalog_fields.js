import 'dotenv/config';
import { pool } from '../src/db.js';

const SMOOTH_TREATMENT_ID = 'f8c60310-abc0-4eaf-ae3a-e9e9e0e06dc0';
const SMOOTH_NAME_EN = 'Smooth';
const SMOOTH_NAME_TH = 'บำบัดผิวใส ให้เรียบเนียน';

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE public.treatments
      ADD COLUMN IF NOT EXISTS name_th text;
    `);
    await client.query(`
      ALTER TABLE public.treatments
      ADD COLUMN IF NOT EXISTS name_en text;
    `);
    await client.query(`
      ALTER TABLE public.treatments
      ADD COLUMN IF NOT EXISTS price_thb integer;
    `);
    await client.query(`
      ALTER TABLE public.treatments
      ADD COLUMN IF NOT EXISTS sessions_included integer;
    `);
    await client.query(`
      ALTER TABLE public.treatments
      ADD COLUMN IF NOT EXISTS mask_included integer;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'treatments_price_thb_non_negative'
        ) THEN
          ALTER TABLE public.treatments
          ADD CONSTRAINT treatments_price_thb_non_negative
          CHECK (price_thb IS NULL OR price_thb >= 0);
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'treatments_sessions_included_non_negative'
        ) THEN
          ALTER TABLE public.treatments
          ADD CONSTRAINT treatments_sessions_included_non_negative
          CHECK (sessions_included IS NULL OR sessions_included >= 0);
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'treatments_mask_included_non_negative'
        ) THEN
          ALTER TABLE public.treatments
          ADD CONSTRAINT treatments_mask_included_non_negative
          CHECK (mask_included IS NULL OR mask_included >= 0);
        END IF;
      END $$;
    `);

    // Keep title_* and name_* aligned. title_* remains for backward compatibility.
    await client.query(`
      UPDATE public.treatments
      SET
        name_en = COALESCE(NULLIF(name_en, ''), NULLIF(title_en, '')),
        name_th = COALESCE(NULLIF(name_th, ''), NULLIF(title_th, '')),
        title_en = COALESCE(NULLIF(title_en, ''), NULLIF(name_en, '')),
        title_th = COALESCE(NULLIF(title_th, ''), NULLIF(name_th, ''));
    `);

    await client.query(
      `
        UPDATE public.treatments
        SET
          name_en = $2,
          name_th = $3,
          title_en = COALESCE(NULLIF(title_en, ''), $2),
          title_th = COALESCE(NULLIF(title_th, ''), $3),
          price_thb = COALESCE(price_thb, 399),
          sessions_included = COALESCE(sessions_included, 1),
          mask_included = COALESCE(mask_included, 0)
        WHERE id = $1
      `,
      [SMOOTH_TREATMENT_ID, SMOOTH_NAME_EN, SMOOTH_NAME_TH]
    );

    await client.query('COMMIT');

    const verify = await client.query(
      `
        SELECT
          id,
          code,
          name_en,
          name_th,
          title_en,
          title_th,
          price_thb,
          sessions_included,
          mask_included
        FROM public.treatments
        WHERE id = $1
        LIMIT 1
      `,
      [SMOOTH_TREATMENT_ID]
    );
    console.log('[migrate_treatments_catalog_fields] completed');
    if (verify.rowCount > 0) {
      console.log(JSON.stringify(verify.rows[0]));
    } else {
      console.log('[migrate_treatments_catalog_fields] target smooth treatment row not found');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[migrate_treatments_catalog_fields] failed', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
