const dotenv = require("dotenv");
dotenv.config();

const bcrypt = require("bcryptjs");
const { query, pool } = require("../db");

async function ensureRole(roleName) {
  const { rows } = await query(
    "SELECT id FROM roles WHERE name = $1",
    [roleName]
  );

  if (rows.length > 0) {
    return rows[0].id;
  }

  const insert = await query(
    "INSERT INTO roles (name) VALUES ($1) RETURNING id",
    [roleName]
  );

  return insert.rows[0].id;
}

async function ensureUser(roleId, roleName) {
  const username = process.env.SEED_USERNAME;
  const password = process.env.SEED_PASSWORD;
  const displayName = process.env.SEED_DISPLAY_NAME || username;

  if (!username || !password) {
    throw new Error("SEED_USERNAME and SEED_PASSWORD are required");
  }

  const { rows } = await query(
    "SELECT id FROM staff_users WHERE username = $1",
    [username]
  );

  if (rows.length > 0) {
    console.log("exists");
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

  console.log(`created ${username} with role ${roleName}`);
}

async function run() {
  try {
    const roleName = process.env.SEED_ROLE || "staff";
    const roleId = await ensureRole(roleName);
    await ensureUser(roleId, roleName);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
