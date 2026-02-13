import 'dotenv/config';
import { createApp } from './src/app.js';
import { query } from './src/db.js';

const app = createApp();
const PORT = Number(process.env.PORT) || 5050;
const REQUIRED_TABLES = [
  'appointments',
  'customers',
  'treatments',
  'sheet_visits_raw',
  'customer_identities',
  'appointment_events',
];

function readDatabaseInfo(connectionString) {
  try {
    const parsed = new URL(connectionString || '');
    const database = String(parsed.pathname || '').replace(/^\//, '') || '(unknown)';
    return { host: parsed.hostname || '(unknown)', database };
  } catch {
    return null;
  }
}

async function logSchemaHealth() {
  try {
    const result = await query(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
      `
    );
    const available = new Set((result.rows || []).map((row) => String(row.table_name || '')));
    const missing = REQUIRED_TABLES.filter((name) => !available.has(name));

    if (missing.length > 0) {
      console.warn(`[startup] missing public tables: ${missing.join(', ')}`);
    } else {
      console.log('[startup] required public tables look present');
    }
  } catch (error) {
    console.warn('[startup] schema health check failed');
    console.warn(error?.message || error);
  }
}

app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
  const databaseInfo = readDatabaseInfo(process.env.DATABASE_URL);
  if (databaseInfo) {
    console.log(`[startup] DATABASE host=${databaseInfo.host} db=${databaseInfo.database}`);
  } else {
    console.log('[startup] DATABASE host/db unavailable');
  }
  void logSchemaHealth();
});
