import 'dotenv/config';
import { query, pool } from '../src/db.js';

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `
    ALTER TABLE public.sheet_visits_raw
      ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
      ADD COLUMN IF NOT EXISTS deleted_by_staff_id uuid,
      ADD COLUMN IF NOT EXISTS delete_note text;
  `,
  `
    CREATE TABLE IF NOT EXISTS public.sheet_visits_deletions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sheet_uuid uuid NOT NULL,
      deleted_at timestamptz NOT NULL DEFAULT now(),
      staff_id uuid NOT NULL,
      reason text,
      meta jsonb
    );
  `,
  `CREATE INDEX IF NOT EXISTS sheet_visits_deletions_sheet_uuid_idx ON public.sheet_visits_deletions(sheet_uuid);`,
  `
    ALTER TABLE public.staffs
      ADD COLUMN IF NOT EXISTS pin_hash text,
      ADD COLUMN IF NOT EXISTS pin_fingerprint text;
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS staffs_pin_fingerprint_ux ON public.staffs (pin_fingerprint) WHERE pin_fingerprint IS NOT NULL;`,
];

async function run() {
  try {
    for (const sql of statements) {
      await query(sql);
    }
    console.log('Soft-delete schema updated.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
