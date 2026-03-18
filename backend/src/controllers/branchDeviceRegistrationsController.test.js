import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBranchDeviceErrorTrace } from './branchDeviceRegistrationsController.js';

test('applyBranchDeviceErrorTrace preserves successful LIFF verification state on downstream 500', () => {
  const trace = {
    liffVerification: 'success',
    verificationReason: null,
    failureStage: null,
    lookupFailure: 'missing_relation',
  };

  applyBranchDeviceErrorTrace(trace, {
    status: 500,
    body: {
      reason: 'server_error',
    },
  });

  assert.equal(trace.liffVerification, 'success');
  assert.equal(trace.verificationReason, null);
  assert.equal(trace.errorReason, 'server_error');
  assert.equal(trace.failureStage, 'registration_lookup');
  assert.equal(trace.lookupFailure, 'missing_relation');
});

test('applyBranchDeviceErrorTrace still records verification failures before LIFF verification succeeds', () => {
  const trace = {
    liffVerification: 'failure',
    verificationReason: null,
    failureStage: null,
  };

  applyBranchDeviceErrorTrace(trace, {
    status: 400,
    body: {
      reason: 'missing_token',
    },
  });

  assert.equal(trace.verificationReason, 'missing_token');
  assert.equal(trace.errorReason, 'missing_token');
  assert.equal(trace.failureStage, null);
});
