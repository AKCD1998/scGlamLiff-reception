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
  appointmentAddon = null,
  invariantUsageCountOverride = null,
} = {}) {
  const state = {
    appointment: {
      id: APPOINTMENT_ID,
      status: initialStatus,
      updated_at: '2026-03-01T00:00:00.000Z',
      selected_toppings: appointmentAddon ? [appointmentAddon.topping_code] : [],
      addons_total_thb: appointmentAddon ? Number(appointmentAddon.amount_thb) || 0 : 0,
    },
    usageRows: usageRows.map((row) => ({ ...row })),
    appointmentAddon: appointmentAddon ? { ...appointmentAddon } : null,
    txSnapshot: null,
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    releaseCount: 0,
  };

  const cloneState = () => ({
    appointment: { ...state.appointment },
    usageRows: state.usageRows.map((row) => ({ ...row })),
    appointmentAddon: state.appointmentAddon ? { ...state.appointmentAddon } : null,
  });

  const restoreState = (snapshot) => {
    state.appointment = { ...snapshot.appointment };
    state.usageRows = snapshot.usageRows.map((row) => ({ ...row }));
    state.appointmentAddon = snapshot.appointmentAddon ? { ...snapshot.appointmentAddon } : null;
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

      if (
        queryText.includes('from appointment_addons') &&
        queryText.includes('limit 1')
      ) {
        const id = String(params[0] || '');
        if (id !== state.appointment.id || !state.appointmentAddon) {
          return { rowCount: 0, rows: [] };
        }
        return {
          rowCount: 1,
          rows: [
            {
              ...state.appointmentAddon,
              appointment_id: state.appointment.id,
              title_th: state.appointmentAddon.title_th || '',
              title_en: state.appointmentAddon.title_en || '',
              category: state.appointmentAddon.category || '',
            },
          ],
        };
      }

      if (queryText.startsWith('delete from appointment_addons')) {
        const id = String(params[0] || '');
        if (id !== state.appointment.id || !state.appointmentAddon) {
          return { rowCount: 0, rows: [] };
        }
        state.appointmentAddon = null;
        return { rowCount: 1, rows: [] };
      }

      if (
        queryText.startsWith('update appointments') &&
        queryText.includes('selected_toppings')
      ) {
        const appointmentId = String(params[0] || '');
        if (appointmentId !== state.appointment.id) {
          return { rowCount: 0, rows: [] };
        }
        state.appointment.selected_toppings = [];
        state.appointment.addons_total_thb = 0;
        state.appointment.updated_at = '2026-03-01T00:05:00.000Z';
        return { rowCount: 1, rows: [] };
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

test('patching completed -> booked also clears appointment addon selection', async () => {
  const mock = createMockDb({
    initialStatus: 'completed',
    usageRows: [buildUsageRow(1)],
    appointmentAddon: {
      id: 'addon-1',
      topping_code: 'FACIAL_MASK_FREE_HAND_200',
      addon_kind: 'paid_topping',
      amount_thb: 200,
      package_mask_deducted: false,
    },
  });

  const result = await adminPatchAppointmentStatus({
    appointmentId: APPOINTMENT_ID,
    patch: { status: 'booked' },
    actorUserId: 'admin-user-addon',
    dbPool: mock.dbPool,
  });

  assert.equal(result.revertedAddonCount, 1);
  assert.equal(mock.state.appointmentAddon, null);
  assert.deepEqual(mock.state.appointment.selected_toppings, []);
  assert.equal(mock.state.appointment.addons_total_thb, 0);
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
