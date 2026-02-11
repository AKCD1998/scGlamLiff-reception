import 'dotenv/config';
import { query, pool } from '../src/db.js';

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `
    CREATE TABLE IF NOT EXISTS public.appointment_override_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
      actor_user_id uuid,
      actor_name text,
      created_at timestamptz NOT NULL DEFAULT now(),
      violations_json jsonb NOT NULL,
      override_reason text NOT NULL,
      request_payload_snapshot jsonb
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_override_logs_appointment_id_idx
    ON public.appointment_override_logs (appointment_id);
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_override_logs_created_at_idx
    ON public.appointment_override_logs (created_at DESC);
  `,
];

async function run() {
  try {
    for (const sql of statements) {
      await query(sql);
    }
    console.log('appointment_override_logs schema ensured.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();

