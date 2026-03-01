import test from 'node:test';
import assert from 'node:assert/strict';
import { adminPatchAppointmentStatus } from './adminAppointmentStatusService.js';

const APPOINTMENT_ID = '8e16cec0-f0e4-442e-a9e6-b3ddace3c9c3';

function buildUsageRow(index = 1) {
  return {
    id: `usage-${index}`,
    customer_package_id: `pkg-${index}`,
    session_no: index,
    used_mask: index % 2 === 0,
  };
}

function createMockDb({
  initialStatus = 'booked',
  usageRows = [],
  invariantUsageCountOverride = null,
} = {}) {
  const state = {
    appointment: {
      id: APPOINTMENT_ID,
      status: initialStatus,
      updated_at: '2026-03-01T00:00:00.000Z',
    },
    usageRows: usageRows.map((row) => ({ ...row })),
    txSnapshot: null,
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    releaseCount: 0,
  };

  const cloneState = () => ({
    appointment: { ...state.appointment },
    usageRows: state.usageRows.map((row) => ({ ...row })),
  });

  const restoreState = (snapshot) => {
    state.appointment = { ...snapshot.appointment };
    state.usageRows = snapshot.usageRows.map((row) => ({ ...row }));
  };

  const client = {
    async query(sql, params = []) {
      const queryText = String(sql || '').trim().toLowerCase();

      if (queryText === 'begin') {
        state.beginCount += 1;
        state.txSnapshot = cloneState();
        return { rowCount: null, rows: [] };
      }

      if (queryText === 'commit') {
        state.commitCount += 1;
        state.txSnapshot = null;
        return { rowCount: null, rows: [] };
      }

      if (queryText === 'rollback') {
        state.rollbackCount += 1;
        if (state.txSnapshot) {
          restoreState(state.txSnapshot);
        }
        state.txSnapshot = null;
        return { rowCount: null, rows: [] };
      }

      if (
        queryText.includes('from appointments') &&
        queryText.includes('for update')
      ) {
        const id = String(params[0] || '');
        if (id !== state.appointment.id) {
          return { rowCount: 0, rows: [] };
        }
        return {
          rowCount: 1,
          rows: [{ id: state.appointment.id, status: state.appointment.status }],
        };
      }

      if (
        queryText.includes('from package_usages') &&
        queryText.includes('for update')
      ) {
        const id = String(params[0] || '');
        if (id !== state.appointment.id) {
          return { rowCount: 0, rows: [] };
        }
        return {
          rowCount: state.usageRows.length,
          rows: state.usageRows.map((row) => ({ ...row })),
        };
      }

      if (queryText.startsWith('delete from package_usages')) {
        const id = String(params[0] || '');
        if (id !== state.appointment.id) {
          return { rowCount: 0, rows: [] };
        }
        const deletedCount = state.usageRows.length;
        state.usageRows = [];
        return { rowCount: deletedCount, rows: [] };
      }

      if (queryText.startsWith('update appointments')) {
        const appointmentId = String(params[0] || '');
        const nextStatus = String(params[1] || '').trim().toLowerCase();
        if (appointmentId !== state.appointment.id) {
          return { rowCount: 0, rows: [] };
        }
        state.appointment.status = nextStatus;
        state.appointment.updated_at = '2026-03-01T00:10:00.000Z';
        return {
          rowCount: 1,
          rows: [
            {
              id: state.appointment.id,
              status: state.appointment.status,
              updated_at: state.appointment.updated_at,
            },
          ],
        };
      }

      if (queryText.includes('count(*)::int as usage_count')) {
        const usageCount =
          invariantUsageCountOverride === null
            ? state.usageRows.length
            : Number(invariantUsageCountOverride);
        return { rowCount: 1, rows: [{ usage_count: usageCount }] };
      }

      if (
        queryText.includes('from appointments') &&
        queryText.includes('limit 1')
      ) {
        const id = String(params[0] || '');
        if (id !== state.appointment.id) {
          return { rowCount: 0, rows: [] };
        }
        return {
          rowCount: 1,
          rows: [
            {
              id: state.appointment.id,
              status: state.appointment.status,
              updated_at: state.appointment.updated_at,
            },
          ],
        };
      }

      throw new Error(`Unhandled query in mock client: ${queryText}`);
    },
    release() {
      state.releaseCount += 1;
    },
  };

  const dbPool = {
    async connect() {
      return client;
    },
  };

  return { state, dbPool };
}

test('deletes lingering usage rows when admin patches status to booked (booked -> booked)', async () => {
  const mock = createMockDb({
    initialStatus: 'booked',
    usageRows: [buildUsageRow(1)],
  });

  const result = await adminPatchAppointmentStatus({
    appointmentId: APPOINTMENT_ID,
    patch: { status: 'booked' },
    actorUserId: 'admin-user-1',
    dbPool: mock.dbPool,
  });

  assert.equal(result.appointment.status, 'booked');
  assert.equal(result.revertedUsageCount, 1);
  assert.equal(result.usageCountBefore, 1);
  assert.equal(result.usageCountAfter, 0);
  assert.equal(mock.state.usageRows.length, 0);
  assert.equal(mock.state.beginCount, 1);
  assert.equal(mock.state.commitCount, 1);
  assert.equal(mock.state.rollbackCount, 0);
});

test('patching completed -> booked deletes usage rows and updates status atomically', async () => {
  const mock = createMockDb({
    initialStatus: 'completed',
    usageRows: [buildUsageRow(1)],
  });

  const result = await adminPatchAppointmentStatus({
    appointmentId: APPOINTMENT_ID,
    patch: { status: 'booked' },
    actorUserId: 'admin-user-2',
    dbPool: mock.dbPool,
  });

  assert.equal(result.beforeStatus, 'completed');
  assert.equal(result.afterStatus, 'booked');
  assert.equal(result.revertedUsageCount, 1);
  assert.equal(mock.state.appointment.status, 'booked');
  assert.equal(mock.state.usageRows.length, 0);
  assert.equal(mock.state.beginCount, 1);
  assert.equal(mock.state.commitCount, 1);
});

test('rolls back status/usage changes when post-update invariant fails', async () => {
  const mock = createMockDb({
    initialStatus: 'completed',
    usageRows: [buildUsageRow(1)],
    invariantUsageCountOverride: 1,
  });

  await assert.rejects(
    () =>
      adminPatchAppointmentStatus({
        appointmentId: APPOINTMENT_ID,
        patch: { status: 'booked' },
        actorUserId: 'admin-user-3',
        dbPool: mock.dbPool,
      }),
    (error) =>
      String(error?.message || '').includes('Invariant violation') &&
      Number(error?.status) === 409
  );

  // Mock rollback restores in-memory state, proving atomic behavior in the service flow.
  assert.equal(mock.state.appointment.status, 'completed');
  assert.equal(mock.state.usageRows.length, 1);
  assert.equal(mock.state.beginCount, 1);
  assert.equal(mock.state.commitCount, 0);
  assert.equal(mock.state.rollbackCount, 1);
});

test('returns warning when status is non-booked and no usage rows exist', async () => {
  const mock = createMockDb({
    initialStatus: 'booked',
    usageRows: [],
  });

  const result = await adminPatchAppointmentStatus({
    appointmentId: APPOINTMENT_ID,
    patch: { status: 'completed' },
    actorUserId: 'admin-user-4',
    dbPool: mock.dbPool,
  });

  assert.equal(result.afterStatus, 'completed');
  assert.equal(result.revertedUsageCount, 0);
  assert.ok(Array.isArray(result.warnings));
  assert.equal(result.warnings.length > 0, true);
});
