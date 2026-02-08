import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';

function fail(message) {
  throw new Error(message);
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  });

  let server = null;
  let appointmentId = '';

  try {
    const adminResult = await pool.query(
      `
        SELECT u.id
        FROM staff_users u
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.is_active = true
          AND LOWER(COALESCE(r.name, '')) IN ('admin', 'owner')
        ORDER BY u.created_at ASC
        LIMIT 1
      `
    );
    if (adminResult.rowCount === 0) fail('No active admin/owner user found');
    const adminUserId = adminResult.rows[0].id;

    const seedResult = await pool.query(
      `
        SELECT
          c.id AS customer_id,
          t.id AS treatment_id,
          lu.line_user_id AS line_user_id
        FROM customers c
        CROSS JOIN LATERAL (
          SELECT id
          FROM treatments
          ORDER BY created_at ASC NULLS LAST, id ASC
          LIMIT 1
        ) t
        CROSS JOIN LATERAL (
          SELECT line_user_id
          FROM line_users
          ORDER BY created_at ASC NULLS LAST, id ASC
          LIMIT 1
        ) lu
        ORDER BY c.created_at ASC NULLS LAST, c.id ASC
        LIMIT 1
      `
    );
    if (seedResult.rowCount === 0) {
      fail('Need at least one customer, one treatment, and one line_user to run verification');
    }

    const customerId = seedResult.rows[0].customer_id;
    const treatmentId = seedResult.rows[0].treatment_id;
    const lineUserId = seedResult.rows[0].line_user_id;

    const inserted = await pool.query(
      `
        INSERT INTO appointments (
          line_user_id,
          treatment_id,
          branch_id,
          scheduled_at,
          status,
          customer_id,
          source
        )
        VALUES ($1, $2, $3, now() + interval '2 hour', 'booked', $4, $5)
        RETURNING id
      `,
      [lineUserId, treatmentId, 'mk1', customerId, 'VERIFY']
    );
    appointmentId = inserted.rows[0]?.id;
    if (!appointmentId) fail('Failed to insert verification appointment');

    const token = jwt.sign({ sub: adminUserId }, process.env.JWT_SECRET, { expiresIn: '10m' });

    const app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' ? address.port : 5050;

    const payload = {
      reason: 'verify admin patch actor check',
      treatment_item_text: `verify-one-off-${Date.now()}`,
      treatment_plan_mode: 'one_off',
      package_id: '',
    };

    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/appointments/${appointmentId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `token=${token}`,
        },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json().catch(() => ({}));
    if (response.status !== 200 || !data?.ok) {
      fail(`PATCH failed: status=${response.status} body=${JSON.stringify(data)}`);
    }

    const eventResult = await pool.query(
      `
        SELECT id, event_type, actor, note, meta
        FROM appointment_events
        WHERE appointment_id = $1
          AND event_type = 'ADMIN_APPOINTMENT_UPDATE'
        ORDER BY event_at DESC NULLS LAST, id DESC
        LIMIT 1
      `,
      [appointmentId]
    );

    if (eventResult.rowCount === 0) fail('No ADMIN_APPOINTMENT_UPDATE event inserted');
    const eventRow = eventResult.rows[0];
    if (eventRow.actor !== 'staff') fail(`Expected actor=staff but got actor=${eventRow.actor}`);

    const meta = eventRow.meta || {};
    const adminFromMeta = String(meta.admin_user_id || '');
    if (adminFromMeta !== String(adminUserId)) {
      fail(`Expected meta.admin_user_id=${adminUserId} but got ${adminFromMeta || '(empty)'}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          appointment_id: appointmentId,
          event_id: eventRow.id,
          event_type: eventRow.event_type,
          actor: eventRow.actor,
        },
        null,
        2
      )
    );
  } finally {
    if (appointmentId) {
      await pool.query('DELETE FROM appointments WHERE id = $1', [appointmentId]).catch(() => {});
    }
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
