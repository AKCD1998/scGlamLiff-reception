import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOrUpdateBranchDeviceRegistration,
  getBranchDeviceRegistrationMe,
  listBranchDeviceRegistrations,
  patchBranchDeviceRegistration,
} from './branchDeviceRegistrationsService.js';

const STAFF_USER = {
  id: '8c0aa381-e7f8-4a8d-9d89-1fa0a4b1e2aa',
  username: 'staff01',
  display_name: 'Staff One',
  role_name: 'staff',
};

const REGISTRATION_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_REGISTRATION_ID = '22222222-2222-4222-8222-222222222222';

function buildRegistrationRow(overrides = {}) {
  return {
    id: REGISTRATION_ID,
    line_user_id: 'U1234567890',
    branch_id: 'branch-003',
    device_label: 'Front Desk iPhone',
    liff_app_id: '1650000000-test',
    status: 'active',
    linked_at: new Date('2026-03-18T01:00:00.000Z'),
    last_seen_at: new Date('2026-03-18T01:10:00.000Z'),
    notes: 'Primary counter device',
    registered_by_staff_user_id: STAFF_USER.id,
    updated_by_staff_user_id: STAFF_USER.id,
    created_at: new Date('2026-03-18T01:00:00.000Z'),
    updated_at: new Date('2026-03-18T01:10:00.000Z'),
    ...overrides,
  };
}

function createMockBranchDeviceDb(initialRows = []) {
  const state = {
    rows: initialRows.map((row) => structuredClone(row)),
    txSnapshot: null,
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    releaseCount: 0,
    insertCount: 0,
    clockTicks: 0,
  };

  function cloneRows(rows = state.rows) {
    return rows.map((row) => structuredClone(row));
  }

  function restoreRows(snapshot) {
    state.rows = cloneRows(snapshot.rows);
    state.insertCount = snapshot.insertCount;
    state.clockTicks = snapshot.clockTicks;
  }

  function nextTimestamp() {
    const baseMs = Date.parse('2026-03-18T10:00:00.000Z');
    const value = new Date(baseMs + state.clockTicks * 60_000);
    state.clockTicks += 1;
    return value;
  }

  function findById(id) {
    return state.rows.find((row) => row.id === id) || null;
  }

  function findByLineUserId(lineUserId) {
    return state.rows.find((row) => row.line_user_id === lineUserId) || null;
  }

  const client = {
    async query(sql, params = []) {
      const queryText = String(sql || '').trim();
      const normalized = queryText.toLowerCase();

      if (normalized === 'begin') {
        state.beginCount += 1;
        state.txSnapshot = {
          rows: cloneRows(),
          insertCount: state.insertCount,
          clockTicks: state.clockTicks,
        };
        return { rowCount: null, rows: [] };
      }

      if (normalized === 'commit') {
        state.commitCount += 1;
        state.txSnapshot = null;
        return { rowCount: null, rows: [] };
      }

      if (normalized === 'rollback') {
        state.rollbackCount += 1;
        if (state.txSnapshot) {
          restoreRows(state.txSnapshot);
        }
        state.txSnapshot = null;
        return { rowCount: null, rows: [] };
      }

      if (
        normalized.includes('from branch_device_registrations') &&
        normalized.includes('where line_user_id = $1')
      ) {
        const row = findByLineUserId(String(params[0] || ''));
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [structuredClone(row)] : [],
        };
      }

      if (
        normalized.includes('from branch_device_registrations') &&
        normalized.includes('where id = $1')
      ) {
        const row = findById(String(params[0] || ''));
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [structuredClone(row)] : [],
        };
      }

      if (normalized.startsWith('insert into branch_device_registrations')) {
        state.insertCount += 1;
        const row = buildRegistrationRow({
          id:
            state.insertCount === 1
              ? REGISTRATION_ID
              : SECOND_REGISTRATION_ID,
          line_user_id: params[0],
          branch_id: params[1],
          device_label: params[2],
          liff_app_id: params[3],
          status: 'active',
          linked_at: nextTimestamp(),
          last_seen_at: nextTimestamp(),
          notes: params[4],
          registered_by_staff_user_id: params[5],
          updated_by_staff_user_id: params[5],
          created_at: nextTimestamp(),
          updated_at: nextTimestamp(),
        });
        state.rows.push(row);
        return { rowCount: 1, rows: [structuredClone(row)] };
      }

      if (
        normalized.startsWith('update branch_device_registrations') &&
        normalized.includes('set branch_id = $2')
      ) {
        const row = findById(String(params[0] || ''));
        if (!row) {
          return { rowCount: 0, rows: [] };
        }
        row.branch_id = params[1];
        row.device_label = params[2];
        row.liff_app_id = params[3];
        row.status = 'active';
        row.linked_at = nextTimestamp();
        row.last_seen_at = nextTimestamp();
        row.notes = params[4];
        row.updated_by_staff_user_id = params[5];
        row.updated_at = nextTimestamp();
        return { rowCount: 1, rows: [structuredClone(row)] };
      }

      if (
        normalized.startsWith('update branch_device_registrations') &&
        normalized.includes('set last_seen_at = now()')
      ) {
        const row = findById(String(params[0] || ''));
        if (!row) {
          return { rowCount: 0, rows: [] };
        }
        row.last_seen_at = nextTimestamp();
        return { rowCount: 1, rows: [structuredClone(row)] };
      }

      if (
        normalized.startsWith('update branch_device_registrations') &&
        normalized.includes('set status = $2')
      ) {
        const row = findById(String(params[0] || ''));
        if (!row) {
          return { rowCount: 0, rows: [] };
        }
        const previousStatus = String(row.status || '').toLowerCase();
        row.status = params[1];
        row.device_label = params[2];
        row.notes = params[3];
        if (params[1] === 'active' && previousStatus !== 'active') {
          row.linked_at = nextTimestamp();
        }
        row.updated_by_staff_user_id = params[4];
        row.updated_at = nextTimestamp();
        return { rowCount: 1, rows: [structuredClone(row)] };
      }

      if (
        normalized.includes('from branch_device_registrations') &&
        normalized.includes('order by updated_at desc')
      ) {
        let rows = cloneRows();

        if (normalized.includes('where lower(status) = any($1::text[])')) {
          const allowedStatuses = Array.isArray(params[0]) ? params[0] : [];
          rows = rows.filter((row) => allowedStatuses.includes(String(row.status).toLowerCase()));
        }

        rows.sort((left, right) => {
          const updatedDiff =
            new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
          if (updatedDiff !== 0) return updatedDiff;
          const createdDiff =
            new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
          if (createdDiff !== 0) return createdDiff;
          return String(right.id).localeCompare(String(left.id));
        });

        return { rowCount: rows.length, rows };
      }

      throw new Error(`Unhandled query in mock client: ${normalized}`);
    },
    release() {
      state.releaseCount += 1;
    },
  };

  return {
    state,
    dbPool: {
      async connect() {
        return client;
      },
    },
  };
}

test('createOrUpdateBranchDeviceRegistration inserts a verified branch device row', async () => {
  const mock = createMockBranchDeviceDb();

  const result = await createOrUpdateBranchDeviceRegistration({
    body: {
      branch_id: 'branch-003',
      device_label: 'Front Desk iPhone',
      id_token: 'verified-id-token',
      liff_app_id: '1650000000-test',
      notes: 'Primary counter device',
    },
    user: STAFF_USER,
    dbPool: mock.dbPool,
    verifyLineIdentityFn: async () => ({
      line_user_id: 'U1234567890',
      display_name: 'Front Desk Phone',
      verification_source: 'id_token',
      liff_app_id: '1650000000-test',
    }),
  });

  assert.equal(result.action, 'created');
  assert.equal(result.registration.line_user_id, 'U1234567890');
  assert.equal(result.registration.branch_id, 'branch-003');
  assert.equal(result.registration.status, 'active');
  assert.equal(result.registration.registered_by_staff_user_id, STAFF_USER.id);
  assert.equal(result.line_identity.verification_source, 'id_token');
  assert.equal(mock.state.rows.length, 1);
  assert.equal(mock.state.commitCount, 1);
});

test('re-registering the same line_user_id updates the existing row instead of creating a duplicate', async () => {
  const mock = createMockBranchDeviceDb([
    buildRegistrationRow({
      branch_id: 'branch-003',
      device_label: 'Old Label',
      status: 'inactive',
      updated_at: new Date('2026-03-18T01:01:00.000Z'),
    }),
  ]);

  const result = await createOrUpdateBranchDeviceRegistration({
    body: {
      branch_id: 'mk1',
      device_label: 'Updated Device',
      access_token: 'verified-access-token',
      notes: 'Moved to new branch',
    },
    user: STAFF_USER,
    dbPool: mock.dbPool,
    verifyLineIdentityFn: async () => ({
      line_user_id: 'U1234567890',
      display_name: 'Front Desk Phone',
      verification_source: 'access_token',
    }),
  });

  assert.equal(result.action, 'updated');
  assert.equal(result.registration.id, REGISTRATION_ID);
  assert.equal(result.registration.branch_id, 'mk1');
  assert.equal(result.registration.device_label, 'Updated Device');
  assert.equal(result.registration.status, 'active');
  assert.equal(result.registration.notes, 'Moved to new branch');
  assert.equal(mock.state.rows.length, 1);
});

test('getBranchDeviceRegistrationMe returns active registration details and touches last_seen_at', async () => {
  const mock = createMockBranchDeviceDb([
    buildRegistrationRow({
      last_seen_at: new Date('2026-03-18T01:05:00.000Z'),
    }),
  ]);

  const beforeLastSeen = new Date(mock.state.rows[0].last_seen_at).getTime();
  const result = await getBranchDeviceRegistrationMe({
    headers: {
      'x-line-id-token': 'verified-id-token',
    },
    dbPool: mock.dbPool,
    verifyLineIdentityFn: async () => ({
      line_user_id: 'U1234567890',
      display_name: 'Front Desk Phone',
      verification_source: 'id_token',
    }),
  });

  assert.equal(result.registered, true);
  assert.equal(result.active, true);
  assert.equal(result.branch_id, 'branch-003');
  assert.equal(result.device_label, 'Front Desk iPhone');
  assert.equal(result.line_identity.line_user_id, 'U1234567890');
  assert.equal(new Date(result.registration.last_seen_at).getTime() > beforeLastSeen, true);
});

test('getBranchDeviceRegistrationMe returns inactive registration state without treating it as active', async () => {
  const mock = createMockBranchDeviceDb([
    buildRegistrationRow({
      status: 'inactive',
      line_user_id: 'UINACTIVE001',
    }),
  ]);

  const result = await getBranchDeviceRegistrationMe({
    headers: {
      'x-line-id-token': 'verified-id-token',
    },
    dbPool: mock.dbPool,
    verifyLineIdentityFn: async () => ({
      line_user_id: 'UINACTIVE001',
      display_name: 'Inactive Device',
      verification_source: 'id_token',
    }),
  });

  assert.equal(result.registered, true);
  assert.equal(result.active, false);
  assert.equal(result.registration.status, 'inactive');
});

test('patchBranchDeviceRegistration updates status, device_label, and notes', async () => {
  const mock = createMockBranchDeviceDb([
    buildRegistrationRow({
      status: 'active',
      device_label: 'Before Label',
      notes: 'Before note',
    }),
  ]);

  const result = await patchBranchDeviceRegistration({
    registrationId: REGISTRATION_ID,
    body: {
      status: 'inactive',
      device_label: 'After Label',
      notes: 'After note',
    },
    user: STAFF_USER,
    dbPool: mock.dbPool,
  });

  assert.equal(result.status, 'inactive');
  assert.equal(result.device_label, 'After Label');
  assert.equal(result.notes, 'After note');
  assert.equal(result.updated_by_staff_user_id, STAFF_USER.id);
  assert.equal(mock.state.commitCount, 1);
});

test('listBranchDeviceRegistrations returns rows in updated_at-desc order and supports status filter', async () => {
  const mock = createMockBranchDeviceDb([
    buildRegistrationRow({
      id: REGISTRATION_ID,
      line_user_id: 'U111',
      status: 'active',
      updated_at: new Date('2026-03-18T01:01:00.000Z'),
      created_at: new Date('2026-03-18T01:00:00.000Z'),
    }),
    buildRegistrationRow({
      id: SECOND_REGISTRATION_ID,
      line_user_id: 'U222',
      status: 'inactive',
      updated_at: new Date('2026-03-18T02:01:00.000Z'),
      created_at: new Date('2026-03-18T02:00:00.000Z'),
    }),
  ]);

  const allRows = await listBranchDeviceRegistrations({
    dbPool: mock.dbPool,
  });
  assert.deepEqual(
    allRows.rows.map((row) => row.id),
    [SECOND_REGISTRATION_ID, REGISTRATION_ID]
  );

  const activeOnly = await listBranchDeviceRegistrations({
    status: 'active',
    dbPool: mock.dbPool,
  });
  assert.deepEqual(activeOnly.meta.applied_status_filter, ['active']);
  assert.deepEqual(
    activeOnly.rows.map((row) => row.line_user_id),
    ['U111']
  );
});
