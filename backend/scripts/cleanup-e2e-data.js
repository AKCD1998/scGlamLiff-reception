import 'dotenv/config';
import { pool } from '../src/db.js';

const E2E_NAME_REGEX_SQL = '^(e2e_|e2e_workflow_|verify-)';
const SAMPLE_LIMIT = 10;

function isTrue(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function toArray(setLike) {
  return Array.from(setLike || []);
}

function toSample(values) {
  return values.slice(0, SAMPLE_LIMIT);
}

async function tableExists(client, tableName) {
  const result = await client.query('SELECT to_regclass($1) AS rel', [`public.${tableName}`]);
  return Boolean(result.rows[0]?.rel);
}

async function getTableColumns(client, tableName) {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => String(row.column_name || '')));
}

async function collectSchemaInfo(client, tableNames) {
  const schema = {};
  for (const tableName of tableNames) {
    const exists = await tableExists(client, tableName);
    const columns = exists ? await getTableColumns(client, tableName) : new Set();
    schema[tableName] = { exists, columns };
  }
  return schema;
}

function hasColumn(schema, tableName, columnName) {
  return Boolean(schema?.[tableName]?.exists && schema?.[tableName]?.columns?.has(columnName));
}

async function countByIds(client, tableName, idColumn, ids) {
  if (!ids.length) return 0;
  const result = await client.query(
    `SELECT COUNT(*)::int AS count FROM ${tableName} WHERE ${idColumn}::text = ANY($1::text[])`,
    [ids]
  );
  return Number(result.rows[0]?.count || 0);
}

async function deleteByIds(client, tableName, idColumn, ids) {
  if (!ids.length) return 0;
  const result = await client.query(
    `DELETE FROM ${tableName} WHERE ${idColumn}::text = ANY($1::text[])`,
    [ids]
  );
  return Number(result.rowCount || 0);
}

async function updateLineUsersDetachCustomers(client, ids) {
  if (!ids.length) return 0;
  const result = await client.query(
    `
      UPDATE line_users
      SET customer_id = NULL
      WHERE customer_id::text = ANY($1::text[])
    `,
    [ids]
  );
  return Number(result.rowCount || 0);
}

function printSample(label, ids) {
  if (!ids.length) return;
  console.log(`${label}: ${ids.length} matched`);
  console.log(`  sample IDs: ${toSample(ids).join(', ')}`);
}

async function run() {
  const cleanupConfirmed = isTrue(process.env.CLEANUP_E2E_CONFIRM);
  const dryRun = !cleanupConfirmed;

  const targetTables = [
    'customers',
    'appointments',
    'appointment_events',
    'appointment_override_logs',
    'package_usages',
    'customer_packages',
    'customer_identities',
    'line_users',
    'sheet_visits_raw',
  ];

  const client = await pool.connect();
  try {
    const schema = await collectSchemaInfo(client, targetTables);
    const customerIds = new Set();
    const appointmentIds = new Set();
    const customerPackageIds = new Set();
    const sheetUuids = new Set();

    if (hasColumn(schema, 'customers', 'id') && hasColumn(schema, 'customers', 'full_name')) {
      const result = await client.query(
        `
          SELECT id::text AS id
          FROM customers
          WHERE COALESCE(full_name, '') ~* $1
        `,
        [E2E_NAME_REGEX_SQL]
      );
      for (const row of result.rows) {
        customerIds.add(String(row.id || ''));
      }
    }

    if (
      hasColumn(schema, 'sheet_visits_raw', 'sheet_uuid') &&
      hasColumn(schema, 'sheet_visits_raw', 'customer_full_name')
    ) {
      const hasDeletedAt = hasColumn(schema, 'sheet_visits_raw', 'deleted_at');
      const result = await client.query(
        `
          SELECT sheet_uuid::text AS sheet_uuid
          FROM sheet_visits_raw
          WHERE COALESCE(customer_full_name, '') ~* $1
          ${hasDeletedAt ? 'AND deleted_at IS NULL' : ''}
        `,
        [E2E_NAME_REGEX_SQL]
      );
      for (const row of result.rows) {
        sheetUuids.add(String(row.sheet_uuid || ''));
      }
    }

    if (hasColumn(schema, 'appointments', 'id')) {
      if (hasColumn(schema, 'appointments', 'customer_id') && customerIds.size > 0) {
        const result = await client.query(
          `
            SELECT id::text AS id
            FROM appointments
            WHERE customer_id::text = ANY($1::text[])
          `,
          [toArray(customerIds)]
        );
        for (const row of result.rows) {
          appointmentIds.add(String(row.id || ''));
        }
      }

      if (hasColumn(schema, 'appointments', 'raw_sheet_uuid') && sheetUuids.size > 0) {
        const result = await client.query(
          `
            SELECT id::text AS id
            FROM appointments
            WHERE raw_sheet_uuid::text = ANY($1::text[])
          `,
          [toArray(sheetUuids)]
        );
        for (const row of result.rows) {
          appointmentIds.add(String(row.id || ''));
        }
      }

      const appointmentNameColumns = ['customer_name', 'customer_full_name'];
      for (const columnName of appointmentNameColumns) {
        if (!hasColumn(schema, 'appointments', columnName)) continue;
        const result = await client.query(
          `
            SELECT id::text AS id
            FROM appointments
            WHERE COALESCE(${columnName}, '') ~* $1
          `,
          [E2E_NAME_REGEX_SQL]
        );
        for (const row of result.rows) {
          appointmentIds.add(String(row.id || ''));
        }
      }
    }

    if (hasColumn(schema, 'customer_packages', 'id') && hasColumn(schema, 'customer_packages', 'customer_id')) {
      if (customerIds.size > 0) {
        const result = await client.query(
          `
            SELECT id::text AS id
            FROM customer_packages
            WHERE customer_id::text = ANY($1::text[])
          `,
          [toArray(customerIds)]
        );
        for (const row of result.rows) {
          customerPackageIds.add(String(row.id || ''));
        }
      }
    }

    const customerIdList = toArray(customerIds).filter(Boolean);
    const appointmentIdList = toArray(appointmentIds).filter(Boolean);
    const customerPackageIdList = toArray(customerPackageIds).filter(Boolean);
    const sheetUuidList = toArray(sheetUuids).filter(Boolean);

    const deletePlan = [];

    if (schema.package_usages.exists && hasColumn(schema, 'package_usages', 'appointment_id')) {
      deletePlan.push({
        label: 'package_usages (by appointment_id)',
        table: 'package_usages',
        column: 'appointment_id',
        ids: appointmentIdList,
      });
    }

    if (schema.package_usages.exists && hasColumn(schema, 'package_usages', 'customer_package_id')) {
      deletePlan.push({
        label: 'package_usages (by customer_package_id)',
        table: 'package_usages',
        column: 'customer_package_id',
        ids: customerPackageIdList,
      });
    }

    if (schema.appointment_events.exists && hasColumn(schema, 'appointment_events', 'appointment_id')) {
      deletePlan.push({
        label: 'appointment_events',
        table: 'appointment_events',
        column: 'appointment_id',
        ids: appointmentIdList,
      });
    }

    if (
      schema.appointment_override_logs.exists &&
      hasColumn(schema, 'appointment_override_logs', 'appointment_id')
    ) {
      deletePlan.push({
        label: 'appointment_override_logs',
        table: 'appointment_override_logs',
        column: 'appointment_id',
        ids: appointmentIdList,
      });
    }

    if (schema.appointments.exists && hasColumn(schema, 'appointments', 'id')) {
      deletePlan.push({
        label: 'appointments',
        table: 'appointments',
        column: 'id',
        ids: appointmentIdList,
      });
    }

    if (schema.customer_packages.exists && hasColumn(schema, 'customer_packages', 'id')) {
      deletePlan.push({
        label: 'customer_packages',
        table: 'customer_packages',
        column: 'id',
        ids: customerPackageIdList,
      });
    }

    if (schema.customer_identities.exists && hasColumn(schema, 'customer_identities', 'customer_id')) {
      deletePlan.push({
        label: 'customer_identities',
        table: 'customer_identities',
        column: 'customer_id',
        ids: customerIdList,
      });
    }

    if (schema.customers.exists && hasColumn(schema, 'customers', 'id')) {
      deletePlan.push({
        label: 'customers',
        table: 'customers',
        column: 'id',
        ids: customerIdList,
      });
    }

    if (schema.sheet_visits_raw.exists && hasColumn(schema, 'sheet_visits_raw', 'sheet_uuid')) {
      deletePlan.push({
        label: 'sheet_visits_raw',
        table: 'sheet_visits_raw',
        column: 'sheet_uuid',
        ids: sheetUuidList,
      });
    }

    console.log('E2E cleanup selector (strict allowlist): /^e2e_|^e2e_workflow_|^verify-/i');
    printSample('Matched customers', customerIdList);
    printSample('Matched appointments', appointmentIdList);
    printSample('Matched customer_packages', customerPackageIdList);
    printSample('Matched sheet rows', sheetUuidList);
    console.log('');
    console.log('Planned impact by table:');
    for (const item of deletePlan) {
      const count = await countByIds(client, item.table, item.column, item.ids);
      console.log(`- ${item.label}: ${count}`);
    }

    if (schema.line_users.exists && hasColumn(schema, 'line_users', 'customer_id')) {
      const detachedCount = await countByIds(client, 'line_users', 'customer_id', customerIdList);
      console.log(`- line_users (customer_id detach): ${detachedCount}`);
    }

    if (dryRun) {
      console.log('');
      console.log('DRY RUN only. No rows were modified.');
      console.log('Set CLEANUP_E2E_CONFIRM=true to execute deletion for matched IDs only.');
      return;
    }

    await client.query('BEGIN');
    const deleteStats = [];
    if (schema.line_users.exists && hasColumn(schema, 'line_users', 'customer_id')) {
      const detached = await updateLineUsersDetachCustomers(client, customerIdList);
      deleteStats.push({ label: 'line_users (customer_id detach)', deleted: detached });
    }

    for (const item of deletePlan) {
      const deleted = await deleteByIds(client, item.table, item.column, item.ids);
      deleteStats.push({ label: item.label, deleted });
    }

    await client.query('COMMIT');

    console.log('');
    console.log('Cleanup executed (CLEANUP_E2E_CONFIRM=true):');
    for (const item of deleteStats) {
      console.log(`- ${item.label}: ${item.deleted}`);
    }
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // no-op
    }
    console.error('cleanup-e2e-data failed:', error?.message || 'unknown error');
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
