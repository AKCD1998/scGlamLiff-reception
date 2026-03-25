import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAppointmentDraft,
  listAppointmentDrafts,
  patchAppointmentDraft,
  resetAppointmentDraftsSchemaEnsureCacheForTests,
  submitAppointmentDraft,
} from './appointmentDraftsService.js';

const STAFF_USER = {
  id: '8c0aa381-e7f8-4a8d-9d89-1fa0a4b1e2aa',
  username: 'staff01',
  display_name: 'Staff One',
  role_name: 'staff',
};

const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_DRAFT_ID = '77777777-7777-4777-8777-777777777777';
const CANCELLED_DRAFT_ID = '88888888-8888-4888-8888-888888888888';
const APPOINTMENT_ID = '22222222-2222-4222-8222-222222222222';
const TREATMENT_ID = '33333333-3333-4333-8333-333333333333';
const PACKAGE_ID = '44444444-4444-4444-8444-444444444444';

test.beforeEach(() => {
  resetAppointmentDraftsSchemaEnsureCacheForTests();
});

function buildDraftRow(overrides = {}) {
  return {
    id: DRAFT_ID,
    status: 'draft',
    customer_full_name: 'Promo Customer',
    phone: '0812345678',
    branch_id: 'branch-003',
    treatment_id: TREATMENT_ID,
    treatment_item_text: 'Smooth 1x 399',
    package_id: PACKAGE_ID,
    staff_name: null,
    scheduled_at: null,
    receipt_evidence: {
      receipt_image_ref: 's3://promo/bill-001.jpg',
      receipt_identifier: 'promo-bill-001',
      total_amount_thb: 399,
    },
    source: 'promo_receipt_draft',
    flow_metadata: { campaign_code: 'SUMMER_GLOW' },
    created_by_staff_user_id: STAFF_USER.id,
    updated_by_staff_user_id: STAFF_USER.id,
    submitted_appointment_id: null,
    submitted_at: null,
    created_at: new Date('2026-03-17T08:00:00.000Z'),
    updated_at: new Date('2026-03-17T08:00:00.000Z'),
    ...overrides,
  };
}

function createMockDraftDb(initialDrafts = []) {
  const state = {
    drafts: initialDrafts.map((row) => ({ ...row })),
    txSnapshot: null,
    beginCount: 0,
    commitCount: 0,
    rollbackCount: 0,
    releaseCount: 0,
    insertCount: 0,
    clockTicks: 0,
  };

  function cloneDraft(row) {
    return structuredClone(row);
  }

  function cloneState() {
    return {
      drafts: state.drafts.map(cloneDraft),
      insertCount: state.insertCount,
      clockTicks: state.clockTicks,
    };
  }

  function restoreState(snapshot) {
    state.drafts = snapshot.drafts.map(cloneDraft);
    state.insertCount = snapshot.insertCount;
    state.clockTicks = snapshot.clockTicks;
  }

  function nextTimestamp() {
    const baseMs = Date.parse('2026-03-17T08:00:00.000Z');
    const next = new Date(baseMs + state.clockTicks * 60_000);
    state.clockTicks += 1;
    return next;
  }

  function findDraft(id) {
    return state.drafts.find((row) => row.id === id) || null;
  }

  function normalizeInsertedJson(value) {
    if (typeof value === 'string') {
      return JSON.parse(value);
    }
    return value ?? null;
  }

  function applyUpdateAssignments(queryText, params, row) {
    const setMatch = queryText.match(/set([\s\S]*?)where\s+id\s*=\s*\$\d+/i);
    if (!setMatch) {
      throw new Error(`Unable to parse SET clause: ${queryText}`);
    }

    const assignments = setMatch[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

    for (const assignment of assignments) {
      if (/= now\(\)$/i.test(assignment)) {
        const fieldName = assignment.split('=')[0].trim();
        row[fieldName] = nextTimestamp();
        continue;
      }

      const literalMatch = assignment.match(/^([a-z_]+)\s*=\s*'([^']+)'$/i);
      if (literalMatch) {
        const [, fieldName, literalValue] = literalMatch;
        row[fieldName] = literalValue;
        continue;
      }

      const match = assignment.match(/^([a-z_]+)\s*=\s*\$(\d+)(::jsonb)?$/i);
      if (!match) {
        throw new Error(`Unhandled update assignment: ${assignment}`);
      }

      const [, fieldName, paramIndexRaw, jsonSuffix] = match;
      const paramIndex = Number(paramIndexRaw) - 1;
      const rawValue = params[paramIndex];
      row[fieldName] = jsonSuffix ? normalizeInsertedJson(rawValue) : rawValue;
    }
  }

  const client = {
    async query(sql, params = []) {
      const queryText = String(sql || '').trim();
      const normalized = queryText.toLowerCase();

      if (
        normalized.startsWith('create extension if not exists "pgcrypto"') ||
        normalized.startsWith('create table if not exists public.appointment_drafts') ||
        normalized.startsWith('create index if not exists appointment_drafts_') ||
        normalized.startsWith('create unique index if not exists appointment_drafts_')
      ) {
        return { rowCount: null, rows: [] };
      }

      if (normalized === 'begin') {
        state.beginCount += 1;
        state.txSnapshot = cloneState();
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
          restoreState(state.txSnapshot);
        }
        state.txSnapshot = null;
        return { rowCount: null, rows: [] };
      }

      if (normalized.startsWith('insert into appointment_drafts')) {
        state.insertCount += 1;
        const row = buildDraftRow({
          id:
            state.insertCount === 1
              ? DRAFT_ID
              : `55555555-5555-4555-8555-${String(state.insertCount).padStart(12, '0')}`,
          status: params[0],
          customer_full_name: params[1],
          phone: params[2],
          branch_id: params[3],
          treatment_id: params[4],
          treatment_item_text: params[5],
          package_id: params[6],
          staff_name: params[7],
          scheduled_at: params[8] ? new Date(params[8]) : null,
          receipt_evidence: normalizeInsertedJson(params[9]),
          source: params[10],
          flow_metadata: normalizeInsertedJson(params[11]),
          created_by_staff_user_id: params[12],
          updated_by_staff_user_id: params[12],
          submitted_appointment_id: null,
          submitted_at: null,
          created_at: nextTimestamp(),
          updated_at: nextTimestamp(),
        });
        state.drafts.push(row);
        return { rowCount: 1, rows: [cloneDraft(row)] };
      }

      if (
        normalized.includes('from appointment_drafts') &&
        normalized.includes('where status = any($1::text[])')
      ) {
        const allowedStatuses = Array.isArray(params[0]) ? params[0].map((value) => String(value)) : [];
        const rows = state.drafts
          .filter((row) => allowedStatuses.includes(String(row.status)))
          .sort((left, right) => {
            const updatedDiff = new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
            if (updatedDiff !== 0) return updatedDiff;
            const createdDiff = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
            if (createdDiff !== 0) return createdDiff;
            return String(right.id).localeCompare(String(left.id));
          })
          .map(cloneDraft);
        return { rowCount: rows.length, rows };
      }

      if (
        normalized.includes('from appointment_drafts') &&
        normalized.includes('where id = $1')
      ) {
        const row = findDraft(String(params[0] || ''));
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [cloneDraft(row)] : [],
        };
      }

      if (normalized.startsWith('update appointment_drafts')) {
        const whereMatch = queryText.match(/where\s+id\s*=\s*\$(\d+)/i);
        const idParamIndex = whereMatch ? Number(whereMatch[1]) - 1 : 0;
        const id = String(params[idParamIndex] || '');
        const row = findDraft(id);
        if (!row) {
          return { rowCount: 0, rows: [] };
        }

        applyUpdateAssignments(queryText, params, row);
        return { rowCount: 1, rows: [cloneDraft(row)] };
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

test('create draft with incomplete booking fields', async () => {
  const mock = createMockDraftDb();

  const draft = await createAppointmentDraft({
    body: {
      customer_full_name: 'Promo Customer',
      phone: '081-234-5678',
      branch_id: 'branch-003',
      treatment_id: TREATMENT_ID,
      treatment_item_text: 'Smooth 1x 399',
      receipt_evidence: {
        receipt_image_ref: 's3://promo/bill-001.jpg',
        receipt_identifier: 'promo-bill-001',
        total_amount_thb: 399,
      },
    },
    user: STAFF_USER,
    dbPool: mock.dbPool,
  });

  assert.equal(draft.status, 'draft');
  assert.equal(draft.staff_name, null);
  assert.equal(draft.scheduled_at, null);
  assert.equal(draft.phone, '0812345678');
  assert.equal(draft.receipt_evidence.receipt_identifier, 'promo-bill-001');
  assert.equal(mock.state.drafts.length, 1);
});

test('list drafts returns persisted rows in expected shape and default order', async () => {
  const mock = createMockDraftDb([
    buildDraftRow({
      id: DRAFT_ID,
      status: 'draft',
      updated_at: new Date('2026-03-17T08:00:00.000Z'),
      created_at: new Date('2026-03-17T08:00:00.000Z'),
    }),
    buildDraftRow({
      id: SECOND_DRAFT_ID,
      status: 'submitted',
      updated_at: new Date('2026-03-17T10:00:00.000Z'),
      created_at: new Date('2026-03-17T09:00:00.000Z'),
      submitted_appointment_id: APPOINTMENT_ID,
      submitted_at: new Date('2026-03-17T10:00:00.000Z'),
    }),
    buildDraftRow({
      id: CANCELLED_DRAFT_ID,
      status: 'cancelled',
      updated_at: new Date('2026-03-17T11:00:00.000Z'),
      created_at: new Date('2026-03-17T07:00:00.000Z'),
    }),
  ]);

  const result = await listAppointmentDrafts({
    dbPool: mock.dbPool,
  });

  assert.deepEqual(result.meta.applied_status_filter, ['draft', 'submitted']);
  assert.equal(result.meta.sort, 'updated_at_desc');
  assert.deepEqual(
    result.drafts.map((draft) => draft.id),
    [SECOND_DRAFT_ID, DRAFT_ID]
  );
  assert.equal(result.drafts[0].submitted_appointment_id, APPOINTMENT_ID);
  assert.equal(result.drafts[1].receipt_evidence.receipt_identifier, 'promo-bill-001');
});

test('update draft later with scheduled_at and staff_name', async () => {
  const mock = createMockDraftDb([
    buildDraftRow({
      staff_name: null,
      scheduled_at: null,
    }),
  ]);

  const updated = await patchAppointmentDraft({
    draftId: DRAFT_ID,
    body: {
      staff_name: 'Provider Mint',
      scheduled_at: '2026-03-21T14:00:00+07:00',
    },
    user: STAFF_USER,
    dbPool: mock.dbPool,
  });

  assert.equal(updated.staff_name, 'Provider Mint');
  assert.equal(new Date(updated.scheduled_at).toISOString(), '2026-03-21T07:00:00.000Z');
  assert.equal(updated.updated_by_staff_user_id, STAFF_USER.id);
  assert.equal(mock.state.commitCount, 1);
});

test('draft rows remain reloadable after create and update', async () => {
  const mock = createMockDraftDb();

  const created = await createAppointmentDraft({
    body: {
      customer_full_name: 'Reload Customer',
      phone: '081-222-3333',
      branch_id: 'branch-003',
      treatment_id: TREATMENT_ID,
    },
    user: STAFF_USER,
    dbPool: mock.dbPool,
  });

  const afterCreate = await listAppointmentDrafts({
    dbPool: mock.dbPool,
  });
  assert.equal(afterCreate.drafts[0].id, created.id);
  assert.equal(afterCreate.drafts[0].customer_full_name, 'Reload Customer');

  await patchAppointmentDraft({
    draftId: created.id,
    body: {
      staff_name: 'Provider Mint',
      scheduled_at: '2026-03-21T14:00:00+07:00',
    },
    user: STAFF_USER,
    dbPool: mock.dbPool,
  });

  const afterPatch = await listAppointmentDrafts({
    dbPool: mock.dbPool,
  });
  assert.equal(afterPatch.drafts[0].id, created.id);
  assert.equal(afterPatch.drafts[0].staff_name, 'Provider Mint');
  assert.equal(new Date(afterPatch.drafts[0].scheduled_at).toISOString(), '2026-03-21T07:00:00.000Z');
});

test('list draft status filter returns requested status only', async () => {
  const mock = createMockDraftDb([
    buildDraftRow({
      id: DRAFT_ID,
      status: 'draft',
    }),
    buildDraftRow({
      id: SECOND_DRAFT_ID,
      status: 'submitted',
    }),
    buildDraftRow({
      id: CANCELLED_DRAFT_ID,
      status: 'cancelled',
    }),
  ]);

  const cancelled = await listAppointmentDrafts({
    status: 'cancelled',
    dbPool: mock.dbPool,
  });
  assert.deepEqual(cancelled.meta.applied_status_filter, ['cancelled']);
  assert.deepEqual(
    cancelled.drafts.map((draft) => draft.id),
    [CANCELLED_DRAFT_ID]
  );

  const all = await listAppointmentDrafts({
    status: 'all',
    dbPool: mock.dbPool,
  });
  assert.deepEqual(all.meta.applied_status_filter, ['draft', 'submitted', 'cancelled']);
  assert.equal(all.drafts.length, 3);
});

test('reject invalid draft status filter', async () => {
  const mock = createMockDraftDb();

  await assert.rejects(
    () =>
      listAppointmentDrafts({
        status: 'archived',
        dbPool: mock.dbPool,
      }),
    (error) =>
      Number(error?.status) === 400 &&
      String(error?.message || '').includes('draft|submitted|cancelled|all')
  );
});

test('submit complete draft into real appointment and preserve submitted_appointment_id linkage', async () => {
  const mock = createMockDraftDb([
    buildDraftRow({
      staff_name: 'Provider Mint',
      scheduled_at: new Date('2026-03-21T07:00:00.000Z'),
    }),
  ]);

  let createCall = null;
  const result = await submitAppointmentDraft({
    draftId: DRAFT_ID,
    user: STAFF_USER,
    dbPool: mock.dbPool,
    createAppointmentFn: async (args) => {
      createCall = args;
      return {
        appointment_id: APPOINTMENT_ID,
        customer_id: '66666666-6666-4666-8666-666666666666',
        customer_package_id: null,
        receipt_evidence: args.body.receipt_evidence,
      };
    },
  });

  assert.equal(createCall.body.staff_name, 'Provider Mint');
  assert.equal(createCall.body.scheduled_at, '2026-03-21T07:00:00.000Z');
  assert.equal(createCall.eventMetaExtra.source, 'appointment_draft_submit');
  assert.equal(createCall.eventMetaExtra.draft_id, DRAFT_ID);
  assert.equal(result.draft.status, 'submitted');
  assert.equal(result.draft.submitted_appointment_id, APPOINTMENT_ID);
  assert.equal(result.appointment.appointment_id, APPOINTMENT_ID);
  assert.equal(mock.state.commitCount, 1);
});

test('reject submit if required booking fields are still missing', async () => {
  const mock = createMockDraftDb([
    buildDraftRow({
      staff_name: null,
      scheduled_at: null,
    }),
  ]);

  await assert.rejects(
    () =>
      submitAppointmentDraft({
        draftId: DRAFT_ID,
        user: STAFF_USER,
        dbPool: mock.dbPool,
        createAppointmentFn: async () => {
          throw new Error('should not be called');
        },
      }),
    (error) =>
      Number(error?.status) === 422 &&
      Array.isArray(error?.details?.missing_fields) &&
      error.details.missing_fields.includes('scheduled_at') &&
      error.details.missing_fields.includes('staff_name')
  );

  assert.equal(mock.state.rollbackCount, 1);
});

test('reject duplicate submit on already-submitted draft', async () => {
  const mock = createMockDraftDb([
    buildDraftRow({
      status: 'submitted',
      staff_name: 'Provider Mint',
      scheduled_at: new Date('2026-03-21T07:00:00.000Z'),
      submitted_appointment_id: APPOINTMENT_ID,
      submitted_at: new Date('2026-03-17T09:00:00.000Z'),
    }),
  ]);

  await assert.rejects(
    () =>
      submitAppointmentDraft({
        draftId: DRAFT_ID,
        user: STAFF_USER,
        dbPool: mock.dbPool,
        createAppointmentFn: async () => {
          throw new Error('should not be called');
        },
      }),
    (error) =>
      Number(error?.status) === 409 &&
      String(error?.message || '').includes('already been submitted') &&
      error?.details?.submitted_appointment_id === APPOINTMENT_ID
  );

  assert.equal(mock.state.rollbackCount, 1);
});
