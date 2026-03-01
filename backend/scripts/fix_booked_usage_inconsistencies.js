import 'dotenv/config';
import { Pool } from 'pg';

const PRE_SERVICE_STATUSES = [
  'booked',
  'rescheduled',
  'ensured',
  'confirmed',
  'check_in',
  'checked_in',
  'pending',
];

function toInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function main() {
  const shouldApply = process.argv.includes('--apply');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inconsistentResult = await client.query(
      `
        SELECT
          a.id AS appointment_id,
          LOWER(COALESCE(a.status, '')) AS status,
          COUNT(pu.id)::int AS usage_count
        FROM appointments a
        JOIN package_usages pu ON pu.appointment_id = a.id
        WHERE LOWER(COALESCE(a.status, '')) = ANY($1::text[])
        GROUP BY a.id, LOWER(COALESCE(a.status, ''))
        ORDER BY a.id
      `,
      [PRE_SERVICE_STATUSES]
    );

    const inconsistentRows = inconsistentResult.rows || [];
    const totalInconsistentAppointments = inconsistentRows.length;
    const totalUsageRows = inconsistentRows.reduce(
      (sum, row) => sum + toInt(row.usage_count),
      0
    );

    if (totalInconsistentAppointments === 0) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: shouldApply ? 'apply' : 'dry-run',
            message: 'No inconsistencies found',
            inconsistentAppointments: 0,
            usageRows: 0,
          },
          null,
          2
        )
      );
      await client.query('ROLLBACK');
      return;
    }

    if (!shouldApply) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: 'dry-run',
            inconsistentAppointments: totalInconsistentAppointments,
            usageRows: totalUsageRows,
            rows: inconsistentRows,
            hint: 'Run with --apply to delete package_usages for these pre-service appointments.',
          },
          null,
          2
        )
      );
      await client.query('ROLLBACK');
      return;
    }

    const appointmentIds = inconsistentRows.map((row) => row.appointment_id).filter(Boolean);
    const deleteResult = await client.query(
      `
        DELETE FROM package_usages
        WHERE appointment_id = ANY($1::uuid[])
      `,
      [appointmentIds]
    );

    await client.query('COMMIT');
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'apply',
          inconsistentAppointments: totalInconsistentAppointments,
          deletedUsageRows: Number(deleteResult.rowCount) || 0,
          appointmentIds,
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();

