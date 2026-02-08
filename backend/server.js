import 'dotenv/config';
import { createApp } from './src/app.js';

const app = createApp();
const PORT = Number(process.env.PORT) || 5050;

function readDatabaseInfo(connectionString) {
  try {
    const parsed = new URL(connectionString || '');
    const database = String(parsed.pathname || '').replace(/^\//, '') || '(unknown)';
    return { host: parsed.hostname || '(unknown)', database };
  } catch {
    return null;
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
});
