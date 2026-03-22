import 'dotenv/config';
import { query, pool } from '../src/db.js';

// Rollback note:
// - This repo uses forward-only migration scripts by default.
// - If this migration must be reverted before production data depends on it,
//   run manual SQL:
//     DROP TABLE IF EXISTS public.appointment_receipt_uploads;

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `
    CREATE TABLE IF NOT EXISTS public.appointment_receipt_uploads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE,
      booking_reference text,
      receipt_image_ref text NOT NULL,
      original_filename text NOT NULL,
      mime_type text NOT NULL,
      file_size_bytes bigint NOT NULL,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      ocr_status text NOT NULL DEFAULT 'pending',
      ocr_processed_at timestamptz,
      ocr_error_message text,
      CONSTRAINT appointment_receipt_uploads_target_check
        CHECK (
          appointment_id IS NOT NULL
          OR NULLIF(BTRIM(COALESCE(booking_reference, '')), '') IS NOT NULL
        ),
      CONSTRAINT appointment_receipt_uploads_receipt_image_ref_check
        CHECK (NULLIF(BTRIM(receipt_image_ref), '') IS NOT NULL),
      CONSTRAINT appointment_receipt_uploads_original_filename_check
        CHECK (NULLIF(BTRIM(original_filename), '') IS NOT NULL),
      CONSTRAINT appointment_receipt_uploads_mime_type_check
        CHECK (NULLIF(BTRIM(mime_type), '') IS NOT NULL),
      CONSTRAINT appointment_receipt_uploads_file_size_bytes_check
        CHECK (file_size_bytes >= 0),
      CONSTRAINT appointment_receipt_uploads_ocr_status_check
        CHECK (
          LOWER(ocr_status) = ANY (
            ARRAY[
              'pending'::text,
              'processing'::text,
              'processed'::text,
              'failed'::text
            ]
          )
        ),
      CONSTRAINT appointment_receipt_uploads_ocr_processed_at_check
        CHECK (ocr_processed_at IS NULL OR ocr_processed_at >= uploaded_at)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_receipt_uploads_uploaded_at_idx
    ON public.appointment_receipt_uploads (uploaded_at DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_receipt_uploads_appointment_id_uploaded_at_idx
    ON public.appointment_receipt_uploads (appointment_id, uploaded_at DESC)
    WHERE appointment_id IS NOT NULL;
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_receipt_uploads_booking_reference_uploaded_at_idx
    ON public.appointment_receipt_uploads (booking_reference, uploaded_at DESC)
    WHERE booking_reference IS NOT NULL;
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_receipt_uploads_ocr_status_uploaded_at_idx
    ON public.appointment_receipt_uploads (ocr_status, uploaded_at DESC);
  `,
];

async function run() {
  try {
    for (const sql of statements) {
      await query(sql);
    }
    console.log('appointment_receipt_uploads schema ensured.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
