import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';

import { createApp } from './app.js';

const LIFF_TEST_SHELL = '<!doctype html><html><body>LIFF TEST SHELL</body></html>';

async function withLiffHostingServer(t, run) {
  const previousDistDir = process.env.LIFF_FRONTEND_DIST_DIR;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'liff-hosting-'));

  await fs.writeFile(path.join(tempDir, 'index.html'), LIFF_TEST_SHELL, 'utf8');

  process.env.LIFF_FRONTEND_DIST_DIR = tempDir;

  const app = createApp();
  const server = http.createServer(app);

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));

    if (previousDistDir === undefined) {
      delete process.env.LIFF_FRONTEND_DIST_DIR;
    } else {
      process.env.LIFF_FRONTEND_DIST_DIR = previousDistDir;
    }

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  await run({ baseUrl });
}

test('api health still reaches the backend handler when LIFF hosting is enabled', async (t) => {
  await withLiffHostingServer(t, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /application\/json/i);
    assert.deepEqual(payload, {
      ok: true,
      data: {
        status: 'ok',
      },
    });
  });
});

test('liff root serves the LIFF frontend index', async (t) => {
  await withLiffHostingServer(t, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/liff/`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/i);
    assert.match(body, /LIFF TEST SHELL/);
  });
});

test('nested liff paths fall back to the LIFF frontend index', async (t) => {
  await withLiffHostingServer(t, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/liff/some/nested/path`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/i);
    assert.match(body, /LIFF TEST SHELL/);
  });
});

test('api 404 responses stay on the backend JSON path and are not intercepted by the LIFF fallback', async (t) => {
  await withLiffHostingServer(t, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/not-a-real-route`);
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') || '', /application\/json/i);
    assert.doesNotMatch(body, /LIFF TEST SHELL/);
    assert.deepEqual(JSON.parse(body), {
      ok: false,
      error: 'Not found',
    });
  });
});

test('backend-like subpaths under /liff still 404 instead of returning the SPA shell', async (t) => {
  await withLiffHostingServer(t, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/liff/api/health`);
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') || '', /application\/json/i);
    assert.doesNotMatch(body, /LIFF TEST SHELL/);
    assert.deepEqual(JSON.parse(body), {
      ok: false,
      error: 'Not found',
    });
  });
});
