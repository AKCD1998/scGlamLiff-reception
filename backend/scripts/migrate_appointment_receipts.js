import 'dotenv/config';
import { query, pool } from '../src/db.js';

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `
    CREATE TABLE IF NOT EXISTS public.appointment_receipts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id uuid NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
      receipt_image_ref text,
      receipt_number text,
      receipt_line text,
      receipt_identifier text,
      total_amount_thb numeric(12, 2),
      ocr_status text,
      ocr_raw_text text,
      ocr_metadata jsonb,
      verification_source text,
      verification_metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT appointment_receipts_total_amount_thb_check
        CHECK (total_amount_thb IS NULL OR total_amount_thb >= 0),
      CONSTRAINT appointment_receipts_ocr_metadata_object_check
        CHECK (ocr_metadata IS NULL OR jsonb_typeof(ocr_metadata) = 'object'),
      CONSTRAINT appointment_receipts_verification_metadata_object_check
        CHECK (
          verification_metadata IS NULL
          OR jsonb_typeof(verification_metadata) = 'object'
        )
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_receipts_created_at_idx
    ON public.appointment_receipts (created_at DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_receipts_verification_source_idx
    ON public.appointment_receipts (verification_source);
  `,
];

async function run() {
  try {
    for (const sql of statements) {
      await query(sql);
    }
    console.log('appointment_receipts schema ensured.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
