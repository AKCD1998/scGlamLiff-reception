import { query } from '../db.js';

export async function listCustomers(req, res) {
  try {
    const { rows } = await query(
      `
        SELECT
          id,
          full_name,
          created_at
        FROM customers
        WHERE lower(trim(full_name)) NOT IN ('test user', 'unknown')
        ORDER BY created_at DESC
        LIMIT 200
      `
    );

    return res.json({ ok: true, rows });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}
