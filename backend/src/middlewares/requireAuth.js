import jwt from 'jsonwebtoken';
import { query } from '../db.js';

export default async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const { rows } = await query(
      `
        SELECT u.id, u.username, u.display_name, r.name AS role_name
        FROM staff_users u
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1 AND u.is_active = true
      `,
      [payload.sub]
    );

    if (rows.length === 0) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    req.user = rows[0];
    return next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
}
