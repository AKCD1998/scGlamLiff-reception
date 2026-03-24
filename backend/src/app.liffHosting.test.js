import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

import { createApp } from './app.js';

const LIFF_TEST_SHELL = '<!doctype html><html><body>LIFF TEST SHELL</body></html>';

async function withLiffHostingServer(t, run) {
  const previousDistDir = process.env.LIFF_FRONTEND_DIST_DIR;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'liff-hosting-'));

  await fs.writeFile(path.join(tempDir, 'index.html'), LIFF_TEST_SHELL, 'utf8');
  await fs.mkdir(path.join(tempDir, 'assets'), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, 'assets', 'app.js'),
    'console.log("LIFF TEST ASSET");',
    'utf8'
  );

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

test('liff assets still load when a browser sends an Origin header', async (t) => {
  await withLiffHostingServer(t, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/liff/assets/app.js`, {
      headers: {
        Origin: 'https://scglamliff-reception.onrender.com',
      },
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /javascript|ecmascript|text\/plain/i);
    assert.match(body, /LIFF TEST ASSET/);
  });
});

test('same-origin API requests are accepted even when the cross-site allowlist is stale', async () => {
  const script = `
    import { createApp } from './src/app.js';
    import http from 'node:http';
    const app = createApp();
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address();
      const origin = 'http://127.0.0.1:' + port;
      const response = await fetch(origin + '/api/health', {
        headers: { Origin: origin }
      });
      const body = await response.text();
      console.log(JSON.stringify({
        status: response.status,
        contentType: response.headers.get('content-type'),
        body
      }));
      server.close(() => process.exit(0));
    });
  `;

  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {
      cwd: path.resolve(process.cwd()),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        FRONTEND_ORIGIN: 'https://akcd1998.github.io',
        FRONTEND_ORIGINS: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const [exitCode] = await once(child, 'close');

  assert.equal(exitCode, 0, stderr || stdout);
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines.at(-1);
  assert.ok(lastLine, stdout);

  const payload = JSON.parse(lastLine);
  assert.equal(payload.status, 200, stdout);
  assert.match(payload.contentType || '', /application\/json/i);
  assert.deepEqual(JSON.parse(payload.body), {
    ok: true,
    data: {
      status: 'ok',
    },
  });
});
