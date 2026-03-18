import 'dotenv/config';
import { query, pool } from '../src/db.js';

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `
    CREATE TABLE IF NOT EXISTS public.branch_device_registrations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      line_user_id text NOT NULL,
      branch_id text NOT NULL,
      device_label text,
      liff_app_id text,
      status text NOT NULL DEFAULT 'active',
      linked_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz,
      notes text,
      registered_by_staff_user_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
      updated_by_staff_user_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT branch_device_registrations_status_check
        CHECK (LOWER(status) = ANY (ARRAY['active'::text, 'inactive'::text]))
    );
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS branch_device_registrations_line_user_id_uidx
    ON public.branch_device_registrations (line_user_id);
  `,
  `
    CREATE INDEX IF NOT EXISTS branch_device_registrations_branch_id_idx
    ON public.branch_device_registrations (branch_id);
  `,
  `
    CREATE INDEX IF NOT EXISTS branch_device_registrations_status_idx
    ON public.branch_device_registrations (status);
  `,
  `
    CREATE INDEX IF NOT EXISTS branch_device_registrations_updated_at_idx
    ON public.branch_device_registrations (updated_at DESC);
  `,
];

async function run() {
  try {
    for (const sql of statements) {
      await query(sql);
    }
    console.log('branch_device_registrations schema ensured.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
