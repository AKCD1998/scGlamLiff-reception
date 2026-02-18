import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const SAMPLE_LIMIT = 25;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(scriptDir, '..', '.env') });

const STAFF_MISMATCH_SQL = `
  WITH staff_view AS (
    SELECT
      a.id,
      a.raw_sheet_uuid,
      COALESCE(
        NULLIF(svr.staff_name, ''),
        NULLIF(staff_name_evt.staff_name, ''),
        NULLIF(staff_display_evt.staff_display_name, ''),
        '-'
      ) AS queue_staff_name_legacy,
      COALESCE(
        NULLIF(staff_name_evt.staff_name, ''),
        NULLIF(staff_display_evt.staff_display_name, ''),
        ''
      ) AS ssot_staff_name
    FROM appointments a
    LEFT JOIN sheet_visits_raw svr ON svr.sheet_uuid = a.raw_sheet_uuid
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          NULLIF(ae.meta->'after'->>'staff_name', ''),
          NULLIF(ae.meta->>'staff_name', '')
        ) AS staff_name
      FROM appointment_events ae
      WHERE ae.appointment_id = a.id
        AND (
          COALESCE(ae.meta->'after', '{}'::jsonb) ? 'staff_name'
          OR ae.meta ? 'staff_name'
        )
        AND COALESCE(
          NULLIF(ae.meta->'after'->>'staff_name', ''),
          NULLIF(ae.meta->>'staff_name', '')
        ) IS NOT NULL
      ORDER BY ae.event_at DESC NULLS LAST, ae.id DESC
      LIMIT 1
    ) staff_name_evt ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          NULLIF(ae.meta->'after'->>'staff_display_name', ''),
          NULLIF(ae.meta->>'staff_display_name', '')
        ) AS staff_display_name
      FROM appointment_events ae
      WHERE ae.appointment_id = a.id
        AND (
          COALESCE(ae.meta->'after', '{}'::jsonb) ? 'staff_display_name'
          OR ae.meta ? 'staff_display_name'
        )
        AND COALESCE(
          NULLIF(ae.meta->'after'->>'staff_display_name', ''),
          NULLIF(ae.meta->>'staff_display_name', '')
        ) IS NOT NULL
      ORDER BY ae.event_at DESC NULLS LAST, ae.id DESC
      LIMIT 1
    ) staff_display_evt ON true
  )
  SELECT
    id,
    raw_sheet_uuid,
    queue_staff_name_legacy,
    ssot_staff_name
  FROM staff_view
  WHERE COALESCE(queue_staff_name_legacy, '') <> COALESCE(ssot_staff_name, '')
  ORDER BY id
  LIMIT $1
`;

const IDENTITY_MISMATCH_SQL = `
  WITH identity_view AS (
    SELECT
      a.id,
      CASE
        WHEN COALESCE(contact_evt.has_email_or_lineid, false)
          THEN COALESCE(NULLIF(contact_evt.email_or_lineid_raw, ''), '')
        ELSE COALESCE(
          NULLIF(ci_line.provider_user_id, ''),
          NULLIF(ci_email.provider_user_id, ''),
          CASE
            WHEN COALESCE(a.line_user_id, '') IN ('__STAFF__', '__BACKDATE__') THEN ''
            WHEN a.line_user_id LIKE 'phone:%' THEN ''
            WHEN a.line_user_id LIKE 'sheet:%' THEN ''
            ELSE COALESCE(NULLIF(a.line_user_id, ''), '')
          END,
          ''
        )
      END AS queue_lineid_legacy,
      COALESCE(
        NULLIF(ci_line.provider_user_id, ''),
        NULLIF(ci_email.provider_user_id, ''),
        ''
      ) AS ssot_lineid
    FROM appointments a
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          ae.meta->'after'->>'email_or_lineid',
          ae.meta->>'email_or_lineid'
        ) AS email_or_lineid_raw,
        (
          COALESCE(ae.meta->'after', '{}'::jsonb) ? 'email_or_lineid'
          OR ae.meta ? 'email_or_lineid'
        ) AS has_email_or_lineid
      FROM appointment_events ae
      WHERE ae.appointment_id = a.id
        AND (
          COALESCE(ae.meta->'after', '{}'::jsonb) ? 'email_or_lineid'
          OR ae.meta ? 'email_or_lineid'
        )
      ORDER BY ae.event_at DESC NULLS LAST, ae.id DESC
      LIMIT 1
    ) contact_evt ON true
    LEFT JOIN LATERAL (
      SELECT provider_user_id
      FROM customer_identities
      WHERE customer_id = a.customer_id
        AND provider = 'LINE'
        AND is_active = true
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) ci_line ON true
    LEFT JOIN LATERAL (
      SELECT provider_user_id
      FROM customer_identities
      WHERE customer_id = a.customer_id
        AND provider = 'EMAIL'
        AND is_active = true
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) ci_email ON true
  )
  SELECT
    id,
    queue_lineid_legacy,
    ssot_lineid
  FROM identity_view
  WHERE COALESCE(queue_lineid_legacy, '') <> COALESCE(ssot_lineid, '')
  ORDER BY id
  LIMIT $1
`;

async function run() {
  const { pool } = await import('../src/db.js');
  const client = await pool.connect();
  try {
    const staffRows = (await client.query(STAFF_MISMATCH_SQL, [SAMPLE_LIMIT])).rows || [];
    const identityRows = (await client.query(IDENTITY_MISMATCH_SQL, [SAMPLE_LIMIT])).rows || [];

    console.log('SSOT mismatch report');
    console.log(`- staff mismatches (sample <= ${SAMPLE_LIMIT}): ${staffRows.length}`);
    for (const row of staffRows) {
      console.log(
        `  staff mismatch appointment_id=${row.id} sheet_staff="${row.queue_staff_name_legacy}" ssot_staff="${row.ssot_staff_name}"`
      );
    }
    console.log(`- identity mismatches (sample <= ${SAMPLE_LIMIT}): ${identityRows.length}`);
    for (const row of identityRows) {
      console.log(
        `  identity mismatch appointment_id=${row.id} queue_legacy="${row.queue_lineid_legacy}" ssot_identity="${row.ssot_lineid}"`
      );
    }

    console.log('\nSuggested remediation workflow (manual, non-destructive):');
    console.log('1) Inspect affected appointment_ids and decide authoritative staff/contact values.');
    console.log('2) Backfill via admin PATCH endpoint so appointment_events + customer_identities stay consistent.');
    console.log('3) Re-run this script and confirm both mismatch counts are 0.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
