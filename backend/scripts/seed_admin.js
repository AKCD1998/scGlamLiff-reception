import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { query, pool } from '../src/db.js';

async function ensureAdminRole() {
  const { rows } = await query('SELECT id FROM roles WHERE name = $1', ['admin']);

  if (rows.length > 0) {
    return rows[0].id;
  }

  const insert = await query('INSERT INTO roles (name) VALUES ($1) RETURNING id', ['admin']);
  return insert.rows[0].id;
}

async function ensureAdminUser(roleId) {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_DISPLAY_NAME || 'Admin';

  if (!username || !password) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD are required');
  }

  const { rows } = await query('SELECT id FROM staff_users WHERE username = $1', [username]);

  if (rows.length > 0) {
    console.log('Admin user already exists.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await query(
    `
      INSERT INTO staff_users (username, display_name, password_hash, role_id)
      VALUES ($1, $2, $3, $4)
    `,
    [username, displayName, passwordHash, roleId]
  );

  console.log('Admin user created.');
}

async function run() {
  try {
    const roleId = await ensureAdminRole();
    await ensureAdminUser(roleId);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
