import test from 'node:test';
import assert from 'node:assert/strict';
import { createBranchDeviceRegistrationStaffAuthMiddleware } from './branchDeviceRegistrationStaffAuth.js';

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('branch-device registration auth keeps the existing cookie auth path', async () => {
  let fallbackCalled = false;
  const middleware = createBranchDeviceRegistrationStaffAuthMiddleware({
    requireAuthMiddleware: async (req, _res, next) => {
      req.user = {
        id: 'staff-cookie-id',
        username: 'staff003',
        display_name: 'SC 003',
        role_name: 'staff',
      };
      return next();
    },
    authenticateStaffCredentialsFn: async () => {
      fallbackCalled = true;
      return { ok: false, user: null };
    },
  });

  const req = {
    body: {
      branch_id: 'branch-003',
      id_token: 'verified-id-token',
    },
    cookies: {
      token: 'staff-session-cookie',
    },
    branchDeviceGuardTrace: {},
  };
  const res = createMockResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(fallbackCalled, false);
  assert.equal(req.user?.id, 'staff-cookie-id');
  assert.equal(req.branchDeviceGuardTrace.staffAuthMethod, 'cookie');
  assert.equal(res.body, null);
});

test('branch-device registration auth falls back to explicit staff credentials when cookie auth is absent', async () => {
  const middleware = createBranchDeviceRegistrationStaffAuthMiddleware({
    requireAuthMiddleware: async (req) =>
      req.authFailureHandler({ reason: 'missing_staff_auth' }),
    authenticateStaffCredentialsFn: async ({ username, password }) => ({
      ok: username === 'staff003' && password === 'pw-003',
      user: {
        id: 'staff-explicit-id',
        username: 'staff003',
        display_name: 'SC 003',
        role_name: 'staff',
      },
    }),
  });

  const req = {
    body: {
      branch_id: 'branch-003',
      id_token: 'verified-id-token',
      staff_username: 'staff003',
      staff_password: 'pw-003',
    },
    cookies: {},
    branchDeviceGuardTrace: {},
  };
  const res = createMockResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user?.id, 'staff-explicit-id');
  assert.equal(req.branchDeviceGuardTrace.staffAuthMethod, 'explicit_credentials');
  assert.equal(req.branchDeviceGuardTrace.explicitStaffUsernamePresent, true);
  assert.equal(req.branchDeviceGuardTrace.explicitStaffPasswordPresent, true);
  assert.equal(res.body, null);
});

test('branch-device registration auth rejects wrong explicit credentials with 401 invalid_staff_credentials', async () => {
  const middleware = createBranchDeviceRegistrationStaffAuthMiddleware({
    requireAuthMiddleware: async (req) =>
      req.authFailureHandler({ reason: 'missing_staff_auth' }),
    authenticateStaffCredentialsFn: async () => ({
      ok: false,
      reason: 'invalid_staff_credentials',
      user: null,
    }),
  });

  const req = {
    body: {
      branch_id: 'branch-003',
      id_token: 'verified-id-token',
      staff_username: 'staff003',
      staff_password: 'wrong-password',
    },
    cookies: {},
    branchDeviceGuardTrace: {},
  };
  const res = createMockResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.success, false);
  assert.equal(res.body?.reason, 'invalid_staff_credentials');
  assert.equal(req.branchDeviceGuardTrace.failureStage, 'staff_auth');
  assert.equal(req.branchDeviceGuardTrace.errorReason, 'invalid_staff_credentials');
});

test('branch-device registration auth rejects requests with neither cookie nor explicit credentials', async () => {
  const middleware = createBranchDeviceRegistrationStaffAuthMiddleware({
    requireAuthMiddleware: async (req) =>
      req.authFailureHandler({ reason: 'missing_staff_auth' }),
    authenticateStaffCredentialsFn: async () => {
      throw new Error('fallback auth should not run without explicit credentials');
    },
  });

  const req = {
    body: {
      branch_id: 'branch-003',
      id_token: 'verified-id-token',
    },
    cookies: {},
    branchDeviceGuardTrace: {},
  };
  const res = createMockResponse();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body?.success, false);
  assert.equal(res.body?.reason, 'missing_staff_auth');
  assert.equal(req.branchDeviceGuardTrace.failureStage, 'staff_auth');
  assert.equal(req.branchDeviceGuardTrace.errorReason, 'missing_staff_auth');
});
