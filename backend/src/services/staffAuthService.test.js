import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { authenticateStaffCredentials } from './staffAuthService.js';

test('authenticateStaffCredentials returns a trusted staff user and records successful verification', async () => {
  const passwordHash = await bcrypt.hash('pw-003', 10);
  const queries = [];

  const result = await authenticateStaffCredentials({
    username: 'staff003',
    password: 'pw-003',
    queryFn: async (sql, params = []) => {
      queries.push({ sql: String(sql || '').trim(), params });

      if (queries.length === 1) {
        return {
          rows: [
            {
              id: 'staff-user-id',
              username: 'staff003',
              display_name: 'SC 003',
              password_hash: passwordHash,
              is_active: true,
              role_name: 'staff',
            },
          ],
        };
      }

      return { rows: [], rowCount: 1 };
    },
    recordAudit: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.user, {
    id: 'staff-user-id',
    username: 'staff003',
    display_name: 'SC 003',
    role_name: 'staff',
  });
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /SET failed_login_count = 0/i);
});

test('authenticateStaffCredentials rejects wrong credentials and records a failed attempt', async () => {
  const passwordHash = await bcrypt.hash('pw-003', 10);
  const queries = [];

  const result = await authenticateStaffCredentials({
    username: 'staff003',
    password: 'wrong-password',
    queryFn: async (sql, params = []) => {
      queries.push({ sql: String(sql || '').trim(), params });

      if (queries.length === 1) {
        return {
          rows: [
            {
              id: 'staff-user-id',
              username: 'staff003',
              display_name: 'SC 003',
              password_hash: passwordHash,
              is_active: true,
              role_name: 'staff',
            },
          ],
        };
      }

      return { rows: [], rowCount: 1 };
    },
    recordAudit: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_staff_credentials');
  assert.equal(result.user, null);
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /SET failed_login_count = failed_login_count \+ 1/i);
});
