import 'dotenv/config';
import { query, pool } from '../src/db.js';

const statements = [
  `
    ALTER TABLE public.appointment_events
      DROP CONSTRAINT IF EXISTS appointment_events_event_type_check;
  `,
  `
    ALTER TABLE public.appointment_events
      ADD CONSTRAINT appointment_events_event_type_check
      CHECK (
        event_type = ANY (
          ARRAY[
            'created'::text,
            'rescheduled'::text,
            'cancelled'::text,
            'walkin_block'::text,
            'walkin_release'::text,
            'redeemed'::text,
            'late'::text,
            'no_show'::text,
            'system_error'::text,
            'ADMIN_APPOINTMENT_UPDATE'::text,
            'ADMIN_BACKDATE_CREATE'::text
          ]
        )
      );
  `,
  `
    ALTER TABLE public.appointment_events
      DROP CONSTRAINT IF EXISTS appointment_events_actor_check;
  `,
  `
    ALTER TABLE public.appointment_events
      ADD CONSTRAINT appointment_events_actor_check
      CHECK (
        actor = ANY (
          ARRAY[
            'customer'::text,
            'staff'::text,
            'system'::text
          ]
        )
      );
  `,
];

async function run() {
  try {
    for (const sql of statements) {
      await query(sql);
    }
    console.log('appointment_events constraints updated.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
