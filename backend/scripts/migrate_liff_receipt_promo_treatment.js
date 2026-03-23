import 'dotenv/config';
import { query, pool } from '../src/db.js';
import {
  LIFF_RECEIPT_PROMO_DURATION_MIN,
  LIFF_RECEIPT_PROMO_TREATMENT_CODE,
  LIFF_RECEIPT_PROMO_TREATMENT_TITLE_EN,
  LIFF_RECEIPT_PROMO_TREATMENT_TITLE_TH,
} from '../src/config/liffReceiptPromoCampaign.js';

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `
    INSERT INTO public.treatments (
      id,
      code,
      title_th,
      title_en,
      duration_min,
      is_active,
      created_at
    )
    VALUES (
      gen_random_uuid(),
      $1,
      $2,
      $3,
      $4,
      true,
      now()
    )
    ON CONFLICT (code)
    DO UPDATE SET
      title_th = EXCLUDED.title_th,
      title_en = EXCLUDED.title_en,
      duration_min = EXCLUDED.duration_min,
      is_active = true
  `,
];

async function run() {
  try {
    await query(statements[0]);
    await query(statements[1], [
      LIFF_RECEIPT_PROMO_TREATMENT_CODE,
      LIFF_RECEIPT_PROMO_TREATMENT_TITLE_TH,
      LIFF_RECEIPT_PROMO_TREATMENT_TITLE_EN,
      LIFF_RECEIPT_PROMO_DURATION_MIN,
    ]);
    console.log('LIFF receipt promo treatment ensured.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
