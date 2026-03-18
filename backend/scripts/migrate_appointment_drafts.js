import 'dotenv/config';
import { query, pool } from '../src/db.js';

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `
    CREATE TABLE IF NOT EXISTS public.appointment_drafts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      status text NOT NULL DEFAULT 'draft',
      customer_full_name text,
      phone text,
      branch_id text,
      treatment_id uuid REFERENCES public.treatments(id),
      treatment_item_text text,
      package_id uuid REFERENCES public.packages(id),
      staff_name text,
      scheduled_at timestamptz,
      receipt_evidence jsonb,
      source text NOT NULL DEFAULT 'promo_receipt_draft',
      flow_metadata jsonb,
      created_by_staff_user_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
      updated_by_staff_user_id uuid REFERENCES public.staff_users(id) ON DELETE SET NULL,
      submitted_appointment_id uuid REFERENCES public.appointments(id),
      submitted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT appointment_drafts_status_check
        CHECK (LOWER(status) = ANY (ARRAY['draft'::text, 'submitted'::text, 'cancelled'::text])),
      CONSTRAINT appointment_drafts_receipt_evidence_object_check
        CHECK (receipt_evidence IS NULL OR jsonb_typeof(receipt_evidence) = 'object'),
      CONSTRAINT appointment_drafts_flow_metadata_object_check
        CHECK (flow_metadata IS NULL OR jsonb_typeof(flow_metadata) = 'object'),
      CONSTRAINT appointment_drafts_submission_state_check
        CHECK (
          (
            LOWER(status) = 'submitted'
            AND submitted_appointment_id IS NOT NULL
            AND submitted_at IS NOT NULL
          )
          OR (
            LOWER(status) <> 'submitted'
            AND submitted_appointment_id IS NULL
            AND submitted_at IS NULL
          )
        )
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_drafts_status_created_at_idx
    ON public.appointment_drafts (status, created_at DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_drafts_phone_idx
    ON public.appointment_drafts (phone);
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS appointment_drafts_submitted_appointment_id_uidx
    ON public.appointment_drafts (submitted_appointment_id)
    WHERE submitted_appointment_id IS NOT NULL;
  `,
];

async function run() {
  try {
    for (const sql of statements) {
      await query(sql);
    }
    console.log('appointment_drafts schema ensured.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
