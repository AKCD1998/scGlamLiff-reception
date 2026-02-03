import 'dotenv/config';
import { query, pool } from '../src/db.js';

const statements = [
  `CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
  `
    CREATE TABLE IF NOT EXISTS roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text UNIQUE NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS staff_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text UNIQUE NOT NULL,
      display_name text NOT NULL,
      password_hash text NOT NULL,
      role_id uuid REFERENCES roles(id),
      is_active boolean NOT NULL DEFAULT true,
      failed_login_count integer NOT NULL DEFAULT 0,
      last_login_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `,
  `CREATE INDEX IF NOT EXISTS staff_users_role_id_idx ON staff_users(role_id);`,
];

async function run() {
  try {
    for (const sql of statements) {
      await query(sql);
    }
    console.log('Auth tables ready.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
