import 'dotenv/config';
import { query, pool } from '../src/db.js';

async function run() {
  try {
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_appointments_raw_sheet_uuid
      ON public.appointments(raw_sheet_uuid)
      WHERE raw_sheet_uuid IS NOT NULL;
    `);
    console.log('Unique index ensured: appointments(raw_sheet_uuid) WHERE raw_sheet_uuid IS NOT NULL');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();

