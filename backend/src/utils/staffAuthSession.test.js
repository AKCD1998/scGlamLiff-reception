import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_COOKIE_NAME,
  AUTH_TOKEN_MAX_AGE_MS,
  buildStaffSessionCookieOptions,
  summarizeStaffSessionCookieOptions,
} from './staffAuthSession.js';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE,
  COOKIE_SECURE: process.env.COOKIE_SECURE,
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
};

test('staff session cookie defaults to cross-site-safe production settings', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.COOKIE_SAMESITE;
  delete process.env.COOKIE_SECURE;
  delete process.env.COOKIE_DOMAIN;

  const cookieOptions = buildStaffSessionCookieOptions();
  const summary = summarizeStaffSessionCookieOptions(cookieOptions);

  assert.equal(summary.name, AUTH_COOKIE_NAME);
  assert.equal(summary.httpOnly, true);
  assert.equal(summary.sameSite, 'none');
  assert.equal(summary.secure, true);
  assert.equal(summary.path, '/');
  assert.equal(summary.domain, null);
  assert.equal(summary.maxAge, AUTH_TOKEN_MAX_AGE_MS);
});

test('staff session cookie respects explicit cookie env overrides', () => {
  process.env.NODE_ENV = 'production';
  process.env.COOKIE_SAMESITE = 'strict';
  process.env.COOKIE_SECURE = 'false';
  process.env.COOKIE_DOMAIN = 'scglamliff-reception.onrender.com';

  const summary = summarizeStaffSessionCookieOptions(buildStaffSessionCookieOptions());

  assert.equal(summary.sameSite, 'strict');
  assert.equal(summary.secure, true);
  assert.equal(summary.domain, 'scglamliff-reception.onrender.com');
});

test.after(() => {
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  process.env.COOKIE_SAMESITE = ORIGINAL_ENV.COOKIE_SAMESITE;
  process.env.COOKIE_SECURE = ORIGINAL_ENV.COOKIE_SECURE;
  process.env.COOKIE_DOMAIN = ORIGINAL_ENV.COOKIE_DOMAIN;
});
