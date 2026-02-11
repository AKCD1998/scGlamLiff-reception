import bcrypt from 'bcryptjs';
import { query } from '../db.js';

const ALLOWED_ROLES = new Set(['staff', 'admin', 'owner']);

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeRoleName(value) {
  const role = normalizeText(value || 'staff').toLowerCase();
  return role || 'staff';
}

export async function createAdminStaffUser(req, res) {
  try {
    const username = normalizeText(req.body?.username);
    const password = String(req.body?.password ?? '');
    const displayNameInput = normalizeText(req.body?.display_name);
    const roleName = normalizeRoleName(req.body?.role_name);
    const isActiveInput = req.body?.is_active;

    if (!username) {
      return res.status(400).json({ ok: false, error: 'username is required' });
    }

    if (!password) {
      return res.status(400).json({ ok: false, error: 'password is required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'password must be at least 6 characters' });
    }

    if (!ALLOWED_ROLES.has(roleName)) {
      return res.status(400).json({ ok: false, error: 'role_name must be staff, admin, or owner' });
    }

    let isActive = true;
    if (isActiveInput !== undefined) {
      if (typeof isActiveInput !== 'boolean') {
        return res.status(400).json({ ok: false, error: 'is_active must be a boolean' });
      }
      isActive = isActiveInput;
    }

    const existing = await query(
      `
        SELECT id
        FROM staff_users
        WHERE username = $1
        LIMIT 1
      `,
      [username]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ ok: false, error: 'Username already exists' });
    }

    const roleResult = await query(
      `
        INSERT INTO roles (name)
        VALUES ($1)
        ON CONFLICT (name)
        DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      `,
      [roleName]
    );
    const roleId = roleResult.rows[0]?.id || null;
    if (!roleId) {
      return res.status(500).json({ ok: false, error: 'Unable to resolve role_id' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const displayName = displayNameInput || username;

    const inserted = await query(
      `
        INSERT INTO staff_users (username, display_name, password_hash, role_id, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, username, display_name, is_active, created_at, updated_at
      `,
      [username, displayName, passwordHash, roleId, isActive]
    );

    const user = inserted.rows[0];
    return res.status(201).json({
      ok: true,
      data: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role_name: roleName,
        is_active: user.is_active,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Username already exists' });
    }
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

