import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAuthNoStore } from '../middlewares/applyAuthNoStore.js';

test('applyAuthNoStore disables caching and strips conditional request headers', () => {
  const req = {
    headers: {
      'if-none-match': '"etag-value"',
      'if-modified-since': 'Tue, 24 Mar 2026 09:57:19 GMT',
    },
  };
  const headers = new Map();
  const res = {
    setHeader(name, value) {
      headers.set(name, value);
    },
  };

  let nextCalled = false;

  applyAuthNoStore(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(
    headers.get('Cache-Control'),
    'no-store, no-cache, must-revalidate, private, max-age=0'
  );
  assert.equal(headers.get('Pragma'), 'no-cache');
  assert.equal(headers.get('Expires'), '0');
  assert.equal(req.headers['if-none-match'], undefined);
  assert.equal(req.headers['if-modified-since'], undefined);
});
