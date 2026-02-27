import { spawn } from 'node:child_process';
import net from 'node:net';

const BACKEND_PORT = Number(process.env.PORT || 5050);
const npmCommand = 'npm';

function runNpmScript(scriptName) {
  const child = spawn(npmCommand, ['run', scriptName], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  const forward = (signal) => {
    if (child.exitCode === null) child.kill(signal);
  };

  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error(`[dev:local] Failed to start npm script "${scriptName}":`, error?.message || error);
    process.exit(1);
  });
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();

    probe.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') return resolve(true);
      resolve(true);
    });

    probe.once('listening', () => {
      probe.close(() => resolve(false));
    });

    probe.listen(port);
  });
}

async function isHealthyBackend(port) {
  const urls = [
    `http://127.0.0.1:${port}/api/health`,
    `http://localhost:${port}/api/health`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) continue;
      const body = await response.json().catch(() => null);
      if (body?.ok === true) return true;
    } catch {
      // Try next URL variant.
    }
  }
  return false;
}

async function main() {
  const busy = await isPortInUse(BACKEND_PORT);
  if (!busy) {
    return runNpmScript('dev:local:stack');
  }

  const healthy = await isHealthyBackend(BACKEND_PORT);
  if (healthy) {
    console.log(
      `[dev:local] Reusing existing backend on http://localhost:${BACKEND_PORT} and starting frontend only.`
    );
    return runNpmScript('dev:frontend');
  }

  console.error(`[dev:local] Port ${BACKEND_PORT} is already in use, but backend health check failed.`);
  console.error(
    `[dev:local] Stop the process using port ${BACKEND_PORT}, or set PORT and VITE_API_BASE_URL to the same free port.`
  );
  process.exit(1);
}

void main().catch((error) => {
  console.error('[dev:local] Unexpected error:', error?.message || error);
  process.exit(1);
});
