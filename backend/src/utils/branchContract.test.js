import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BRANCH_ID,
  isUuidBranchId,
  normalizeBranchWriteValue,
  parseBranchFilterQuery,
  resolveCanonicalWriteBranchId,
} from './branchContract.js';

const UUID_BRANCH_ID = '99999999-9999-4999-8999-999999999999';

test('branch write contract preserves text branch values and default fallback', () => {
  assert.equal(normalizeBranchWriteValue(' branch-003 '), 'branch-003');
  assert.equal(resolveCanonicalWriteBranchId('branch-003'), 'branch-003');
  assert.equal(
    resolveCanonicalWriteBranchId('', { defaultValue: DEFAULT_BRANCH_ID }),
    DEFAULT_BRANCH_ID
  );
});

test('branch availability filter only accepts uuid-shaped branch ids', () => {
  assert.equal(isUuidBranchId(UUID_BRANCH_ID), true);
  assert.equal(parseBranchFilterQuery(` ${UUID_BRANCH_ID} `), UUID_BRANCH_ID);

  assert.throws(
    () => parseBranchFilterQuery('branch-003'),
    (error) =>
      Number(error?.status) === 400 &&
      error?.details?.param === 'branch_id' &&
      error?.details?.provided === 'branch-003' &&
      error?.details?.expected === 'uuid'
  );
});
