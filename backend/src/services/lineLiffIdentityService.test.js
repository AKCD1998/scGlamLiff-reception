import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLineCredentialPayload,
  verifyLineLiffIdentity,
} from './lineLiffIdentityService.js';

function createJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test('extractLineCredentialPayload reads bearer access token and header id token', () => {
  const credentials = extractLineCredentialPayload({
    headers: {
      authorization: 'Bearer access-token-123',
      'x-line-id-token': 'id-token-456',
      'x-liff-app-id': '1650000000-test',
    },
  });

  assert.equal(credentials.accessToken, 'access-token-123');
  assert.equal(credentials.idToken, 'id-token-456');
  assert.equal(credentials.liffAppId, '1650000000-test');
});

test('verifyLineLiffIdentity verifies id_token against configured channel', async () => {
  const calls = [];
  const identity = await verifyLineLiffIdentity({
    idToken: 'valid-id-token',
    channelId: '2001234567',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return createJsonResponse({
        sub: 'U1234567890',
        aud: '2001234567',
        name: 'Branch Tablet',
      });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.line.me/oauth2/v2.1/verify');
  assert.equal(calls[0].options.method, 'POST');
  assert.match(String(calls[0].options.body), /id_token=valid-id-token/);
  assert.match(String(calls[0].options.body), /client_id=2001234567/);
  assert.equal(identity.line_user_id, 'U1234567890');
  assert.equal(identity.display_name, 'Branch Tablet');
  assert.equal(identity.verification_source, 'id_token');
});

test('verifyLineLiffIdentity verifies access_token then resolves LINE profile', async () => {
  const calls = [];
  const identity = await verifyLineLiffIdentity({
    accessToken: 'valid-access-token',
    channelId: '2001234567',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (String(url).includes('/oauth2/v2.1/verify')) {
        return createJsonResponse({
          client_id: '2001234567',
          scope: 'profile openid',
        });
      }
      if (String(url).includes('/v2/profile')) {
        return createJsonResponse({
          userId: 'UACCESS123',
          displayName: 'Front Desk Phone',
          pictureUrl: 'https://example.com/profile.png',
        });
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    },
  });

  assert.equal(calls.length, 2);
  assert.match(String(calls[0].url), /access_token=valid-access-token/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer valid-access-token');
  assert.equal(identity.line_user_id, 'UACCESS123');
  assert.equal(identity.display_name, 'Front Desk Phone');
  assert.equal(identity.verification_source, 'access_token');
});

test('verifyLineLiffIdentity rejects when id_token and access_token resolve to different users', async () => {
  await assert.rejects(
    () =>
      verifyLineLiffIdentity({
        idToken: 'valid-id-token',
        accessToken: 'valid-access-token',
        channelId: '2001234567',
        fetchImpl: async (url) => {
          if (String(url).includes('/v2/profile')) {
            return createJsonResponse({
              userId: 'UACCESS999',
              displayName: 'Mismatch Device',
            });
          }
          if (String(url).includes('access_token=')) {
            return createJsonResponse({
              client_id: '2001234567',
              scope: 'profile openid',
            });
          }
          return createJsonResponse({
            sub: 'UIDTOKEN123',
            aud: '2001234567',
            name: 'Mismatch Device',
          });
        },
      }),
    (error) =>
      Number(error?.status) === 401 &&
      error?.code === 'LINE_IDENTITY_MISMATCH' &&
      String(error?.message || '').includes('different users')
  );
});

test('verifyLineLiffIdentity requires channel config for LINE token verification', async () => {
  await assert.rejects(
    () =>
      verifyLineLiffIdentity({
        idToken: 'valid-id-token',
        channelId: '',
        fetchImpl: async () => {
          throw new Error('should not fetch');
        },
      }),
    (error) =>
      Number(error?.status) === 500 &&
      error?.code === 'LINE_LIFF_CONFIG_MISSING' &&
      String(error?.message || '').includes('LINE_LIFF_CHANNEL_ID')
  );
});
