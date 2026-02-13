import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "../fixtures/base";
import { saveJsonSnapshot } from "../utils/artifacts";

type CommandResult = {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

type BackendProbe = {
  path: string;
  status: number | null;
  ok: boolean;
  exists: boolean;
  error: string | null;
};

type LocalhostHit = {
  file: string;
  line: number;
  match: string;
};

type ManagedProcess = {
  command: string;
  cwd: string;
  child: ChildProcess;
  getStdout: () => string;
  getStderr: () => string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

type ProdLikeSummary = {
  spec: string;
  timestamp: string;
  overallPass: boolean;
  missingEnvVars: string[];
  build: {
    pass: boolean;
    command: string;
    exitCode: number | null;
  };
  backend: {
    checked: boolean;
    pass: boolean;
    command: string | null;
    scriptName: string | null;
    port: number;
    probes: BackendProbe[];
  };
  localhostScan: {
    pass: boolean;
    command: string;
    hits: LocalhostHit[];
  };
  preview: {
    checked: boolean;
    pass: boolean;
    command: string | null;
    fatalErrors: string[];
  };
  commands: Array<{
    command: string;
    cwd: string;
    exitCode: number | null;
    timedOut: boolean;
    stderrShort: string;
  }>;
  notes: string[];
  artifactPath: string | null;
};

type BackendScript = {
  scriptName: string | null;
  command: string | null;
};

const ROOT_DIR = process.cwd();
const BACKEND_DIR = path.join(ROOT_DIR, "backend");
const FRONTEND_DIST_DIR = path.join(ROOT_DIR, "dist");
const DIARY_CANDIDATES = [
  "PROJECT_DIARY.md",
  "PROJECT_DIARIES.md",
  path.join("markdown", "PROJECT_DIARY.md"),
  path.join("markdown", "PROJECT_DIARIES.md"),
];

function nowIso(): string {
  return new Date().toISOString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shortText(input: string, max = 500): string {
  return stripAnsi(String(input || ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function stripAnsi(input: string): string {
  return String(input || "").replace(/\u001b\[[0-9;]*m/g, "");
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function sanitizeForMarkdown(value: string): string {
  return value.replace(/`/g, "'").trim();
}

function detectMissingEnvVars(logText: string): string[] {
  const matches = new Set<string>();
  const lines = logText.split(/\r?\n/);
  const envToken = /\b[A-Z][A-Z0-9_]{2,}\b/g;
  const missingHint = /missing|required|undefined|not set|not defined|must be provided|env/i;

  for (const line of lines) {
    if (!missingHint.test(line)) continue;
    const tokens = line.match(envToken) || [];
    for (const token of tokens) {
      if (
        token.startsWith("VITE_") ||
        token === "DATABASE_URL" ||
        token.startsWith("DB_") ||
        token.startsWith("JWT_") ||
        token.startsWith("PG") ||
        token.startsWith("API_") ||
        token.startsWith("FRONTEND_") ||
        token === "PORT" ||
        token === "NODE_ENV"
      ) {
        matches.add(token);
      }
    }
  }

  return Array.from(matches).sort();
}

async function runCommand(params: {
  command: string;
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<CommandResult> {
  const { command, cwd, timeoutMs = 180_000, env } = params;
  const startedAt = Date.now();
  const child = spawn(command, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    shell: true,
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let timer: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      void terminateProcessTree(child);
      resolve();
    }, timeoutMs);
  });

  const exitPromise = new Promise<number | null>((resolve) => {
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve(code);
    });
    child.on("error", () => {
      resolve(-1);
    });
  });

  const exitCode = await Promise.race([
    exitPromise,
    (async () => {
      await timeoutPromise;
      return null;
    })(),
  ]);

  if (timer) clearTimeout(timer);

  return {
    command,
    cwd,
    exitCode,
    stdout,
    stderr,
    durationMs: Date.now() - startedAt,
    timedOut,
  };
}

function spawnManagedProcess(params: {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): ManagedProcess {
  const { command, cwd, env } = params;
  const child = spawn(command, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    shell: true,
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("close", (code, signal) => {
      resolve({
        code,
        signal,
      });
    });
    child.on("error", () => {
      resolve({
        code: -1,
        signal: null,
      });
    });
  });

  return {
    command,
    cwd,
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
    exited,
  };
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  if (child.killed) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        shell: true,
        windowsHide: true,
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // Best effort; no-op.
  }
}

async function waitForProcessReady(params: {
  proc: ManagedProcess;
  matcher: RegExp;
  timeoutMs: number;
  label: string;
}): Promise<void> {
  const { proc, matcher, timeoutMs, label } = params;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const combined = stripAnsi(`${proc.getStdout()}\n${proc.getStderr()}`);
    if (matcher.test(combined)) return;

    const exit = await Promise.race([proc.exited, wait(250).then(() => null)]);
    if (exit) {
      throw new Error(
        `${label} exited before ready (code=${exit.code}, signal=${String(exit.signal)})`
      );
    }
  }

  throw new Error(`${label} did not report ready state within ${timeoutMs}ms`);
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(filePath, "utf8");
  return safeJsonParse(raw);
}

async function resolveBackendScript(): Promise<BackendScript> {
  const backendPkgPath = path.join(BACKEND_DIR, "package.json");
  const pkg = await readJsonFile(backendPkgPath);
  const scripts = (pkg.scripts || {}) as Record<string, unknown>;

  const preferred = ["start:prod", "prod", "start"];
  for (const scriptName of preferred) {
    const scriptValue = scripts[scriptName];
    if (typeof scriptValue === "string" && scriptValue.trim()) {
      return {
        scriptName,
        command: `npm run ${scriptName}`,
      };
    }
  }

  return {
    scriptName: null,
    command: null,
  };
}

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

async function scanDistForLocalhostApiBase(): Promise<LocalhostHit[]> {
  const hits: LocalhostHit[] = [];
  const files = await collectFiles(FRONTEND_DIST_DIR);
  const targetExtensions = new Set([".html", ".js", ".css", ".json", ".txt", ".mjs", ".cjs"]);
  // Avoid false positives from library internals (e.g. URL constructor defaults).
  // We only flag likely API-base hardcodes: localhost with explicit port or /api path.
  const localhostRegex =
    /https?:\/\/(?:localhost|127\.0\.0\.1)(?:(?::\d+)(?:\/[^\s"'`)]+)?|(?:\/api(?:\/[^\s"'`)]+)?))/gi;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!targetExtensions.has(ext)) continue;

    let content = "";
    try {
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      const matches = lineText.match(localhostRegex);
      if (!matches) return;
      for (const match of matches) {
        hits.push({
          file: path.relative(ROOT_DIR, file).split(path.sep).join("/"),
          line: index + 1,
          match,
        });
      }
    });
  }

  return hits;
}

async function probeBackendEndpoint(baseUrl: string, endpointPath: string): Promise<BackendProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 8_000);

  try {
    const response = await fetch(`${baseUrl}${endpointPath}`, {
      method: "GET",
      signal: controller.signal,
    });

    const status = response.status;
    return {
      path: endpointPath,
      status,
      ok: response.ok,
      exists: status !== 404,
      error: null,
    };
  } catch (error) {
    return {
      path: endpointPath,
      status: null,
      ok: false,
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveOrCreate(
  candidates: string[],
  fallbackName: string,
  header: string
): Promise<string> {
  for (const candidate of candidates) {
    const full = path.join(ROOT_DIR, candidate);
    if (await ensureExists(full)) return full;
  }

  const fallback = path.join(ROOT_DIR, fallbackName);
  await fs.writeFile(fallback, `${header}\n\n`, "utf8");
  return fallback;
}

async function appendDiarySummary(params: {
  summary: ProdLikeSummary;
  testInfo: TestInfo;
}): Promise<void> {
  const { summary, testInfo } = params;
  const diaryPath = await resolveOrCreate(
    DIARY_CANDIDATES,
    "PROJECT_DIARY.md",
    "# Project Diary"
  );

  const commands = summary.commands
    .map((item) => {
      const commandText = sanitizeForMarkdown(item.command);
      const cwdText = sanitizeForMarkdown(path.relative(ROOT_DIR, item.cwd) || ".");
      const stderrShort = item.stderrShort ? ` | stderr: ${sanitizeForMarkdown(item.stderrShort)}` : "";
      return `- \`${commandText}\` (cwd: \`${cwdText}\`) -> exit=${String(
        item.exitCode
      )}, timeout=${String(item.timedOut)}${stderrShort}`;
    })
    .join("\n");

  const entry = [
    "",
    `## ${nowIso()} — E2E Prod-like Check (Prompt 8)`,
    "",
    `- Spec: \`${testInfo.titlePath.join(" > ")}\``,
    `- Result: ${summary.overallPass ? "PASS" : "FAIL"}`,
    `- Build: ${summary.build.pass ? "PASS" : "FAIL"} (exit=${String(summary.build.exitCode)})`,
    `- Missing env vars: ${
      summary.missingEnvVars.length > 0 ? summary.missingEnvVars.join(", ") : "(none)"
    }`,
    `- Backend check: ${
      summary.backend.checked
        ? `${summary.backend.pass ? "PASS" : "FAIL"} (${summary.backend.command || "n/a"})`
        : "SKIPPED"
    }`,
    `- Localhost scan: ${
      summary.localhostScan.pass ? "PASS" : `FAIL (${summary.localhostScan.hits.length} hits)`
    }`,
    `- Preview console check: ${
      summary.preview.checked ? (summary.preview.pass ? "PASS" : "FAIL") : "SKIPPED"
    }`,
    `- Summary artifact: ${summary.artifactPath ? `\`${summary.artifactPath}\`` : "(not captured)"}`,
    "",
    "### Commands",
    commands || "- (no command executed)",
    ...(summary.notes.length > 0 ? ["", "### Notes", ...summary.notes.map((note) => `- ${note}`)] : []),
    "",
  ].join("\n");

  await fs.appendFile(diaryPath, entry, "utf8");
}

function pushCommand(summary: ProdLikeSummary, result: CommandResult): void {
  summary.commands.push({
    command: result.command,
    cwd: result.cwd,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stderrShort: shortText(result.stderr || result.stdout),
  });
}

function buildCommandFailureError(params: {
  step: string;
  result: CommandResult;
  expected: string;
  missingEnvVars?: string[];
  artifactPath: string;
}): Error {
  const { step, result, expected, missingEnvVars = [], artifactPath } = params;
  const stderrShort = shortText(result.stderr || result.stdout);
  const missing = missingEnvVars.length > 0 ? missingEnvVars.join(",") : "none";
  return new Error(
    `[PROD_LIKE_FAILURE] step=${step} command="${result.command}" cwd="${result.cwd}" exit=${String(
      result.exitCode
    )} timedOut=${String(result.timedOut)} expected="${expected}" stderr="${stderrShort}" missing_env="${missing}" artifact="${artifactPath}"`
  );
}

function buildCheckFailureError(params: {
  step: string;
  command: string;
  expected: string;
  actual: string;
  artifactPath: string;
}): Error {
  const { step, command, expected, actual, artifactPath } = params;
  return new Error(
    `[PROD_LIKE_FAILURE] step=${step} command="${command}" expected="${expected}" actual="${shortText(
      actual
    )}" artifact="${artifactPath}"`
  );
}

async function failWithSummary(params: {
  summary: ProdLikeSummary;
  testInfo: TestInfo;
  error: Error;
}): Promise<never> {
  const { summary, testInfo, error } = params;
  summary.overallPass = false;
  if (!summary.artifactPath) {
    summary.artifactPath = await saveJsonSnapshot(
      `${testInfo.titlePath.join(" > ")}--prod-like-failure-summary`,
      summary
    );
  }
  throw error;
}

async function checkPreviewFatalErrors(page: Page, previewUrl: string): Promise<string[]> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  const pageErrorListener = (error: Error) => {
    pageErrors.push(error.message || String(error));
  };
  const consoleListener = (message: { type(): string; text(): string }) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  };

  page.on("pageerror", pageErrorListener);
  page.on("console", consoleListener);

  try {
    await page.goto(previewUrl, { waitUntil: "domcontentloaded", timeout: 40_000 });
    await page.waitForTimeout(2_000);
  } finally {
    page.off("pageerror", pageErrorListener);
    page.off("console", consoleListener);
  }

  const fatalConsole = consoleErrors.filter((line) =>
    /uncaught|typeerror|referenceerror|syntaxerror|cannot read|is not defined|fatal/i.test(
      String(line || "")
    )
  );
  return [...pageErrors, ...fatalConsole];
}

test.describe("07 Production-like check", () => {
  test("build + backend prod boot + localhost scan + preview sanity", async ({ page }, testInfo) => {
    test.setTimeout(480_000);

    const summary: ProdLikeSummary = {
      spec: testInfo.titlePath.join(" > "),
      timestamp: nowIso(),
      overallPass: false,
      missingEnvVars: [],
      build: {
        pass: false,
        command: "npm run build",
        exitCode: null,
      },
      backend: {
        checked: false,
        pass: false,
        command: null,
        scriptName: null,
        port: 5252,
        probes: [],
      },
      localhostScan: {
        pass: false,
        command: 'grep dist for "localhost|127.0.0.1"',
        hits: [],
      },
      preview: {
        checked: false,
        pass: false,
        command: null,
        fatalErrors: [],
      },
      commands: [],
      notes: [],
      artifactPath: null,
    };

    let backendProc: ManagedProcess | null = null;
    let previewProc: ManagedProcess | null = null;

    try {
      const buildResult = await runCommand({
        command: summary.build.command,
        cwd: ROOT_DIR,
        timeoutMs: 240_000,
      });
      pushCommand(summary, buildResult);
      summary.build.exitCode = buildResult.exitCode;
      summary.missingEnvVars = detectMissingEnvVars(`${buildResult.stdout}\n${buildResult.stderr}`);

      if (buildResult.timedOut || buildResult.exitCode !== 0) {
        summary.artifactPath = await saveJsonSnapshot(
          `${testInfo.titlePath.join(" > ")}--build-failure`,
          {
            step: "frontend-build",
            result: buildResult,
            missingEnvVars: summary.missingEnvVars,
          }
        );
        await failWithSummary({
          summary,
          testInfo,
          error: buildCommandFailureError({
            step: "frontend-build",
            result: buildResult,
            expected: "npm run build exits with code 0",
            missingEnvVars: summary.missingEnvVars,
            artifactPath: summary.artifactPath,
          }),
        });
      }

      if (summary.missingEnvVars.length > 0) {
        summary.artifactPath = await saveJsonSnapshot(
          `${testInfo.titlePath.join(" > ")}--build-missing-env`,
          {
            step: "build-env-check",
            missingEnvVars: summary.missingEnvVars,
            stderr: shortText(buildResult.stderr || buildResult.stdout, 1_500),
          }
        );
        await failWithSummary({
          summary,
          testInfo,
          error: buildCheckFailureError({
            step: "build-env-check",
            command: summary.build.command,
            expected: "no missing env var warnings/errors in build output",
            actual: `missing env vars detected: ${summary.missingEnvVars.join(", ")}`,
            artifactPath: summary.artifactPath,
          }),
        });
      }

      summary.build.pass = true;

      const localhostHits = await scanDistForLocalhostApiBase();
      summary.localhostScan.hits = localhostHits;
      summary.localhostScan.pass = localhostHits.length === 0;

      if (!summary.localhostScan.pass) {
        summary.artifactPath = await saveJsonSnapshot(
          `${testInfo.titlePath.join(" > ")}--localhost-hits`,
          {
            step: "dist-localhost-scan",
            hits: localhostHits.slice(0, 80),
            hitCount: localhostHits.length,
          }
        );
        await failWithSummary({
          summary,
          testInfo,
          error: buildCheckFailureError({
            step: "dist-localhost-scan",
            command: summary.localhostScan.command,
            expected: "built dist has no hardcoded localhost/127.0.0.1 URLs",
            actual: `found ${localhostHits.length} localhost references`,
            artifactPath: summary.artifactPath,
          }),
        });
      }

      const backendScript = await resolveBackendScript();
      summary.backend.scriptName = backendScript.scriptName;
      summary.backend.command = backendScript.command;

      if (backendScript.command) {
        summary.backend.checked = true;
        backendProc = spawnManagedProcess({
          command: backendScript.command,
          cwd: BACKEND_DIR,
          env: {
            NODE_ENV: "production",
            PORT: String(summary.backend.port),
          },
        });

        try {
          await waitForProcessReady({
            proc: backendProc,
            matcher: /Listening on port/i,
            timeoutMs: 30_000,
            label: "backend production process",
          });
        } catch (error) {
          summary.artifactPath = await saveJsonSnapshot(
            `${testInfo.titlePath.join(" > ")}--backend-prod-boot-failure`,
            {
              step: "backend-prod-boot",
              command: backendScript.command,
              stdout: shortText(backendProc.getStdout(), 4_000),
              stderr: shortText(backendProc.getStderr(), 4_000),
            }
          );
          await failWithSummary({
            summary,
            testInfo,
            error: buildCheckFailureError({
              step: "backend-prod-boot",
              command: backendScript.command,
              expected: "backend boots in production mode without crashing",
              actual: error instanceof Error ? error.message : String(error),
              artifactPath: summary.artifactPath,
            }),
          });
        }

        const backendBaseUrl = `http://127.0.0.1:${summary.backend.port}`;
        const probePaths = ["/", "/api/health", "/api/admin/staff-users", "/api/appointments/queue", "/api/visits"];
        const probes: BackendProbe[] = [];

        for (const endpointPath of probePaths) {
          probes.push(await probeBackendEndpoint(backendBaseUrl, endpointPath));
        }

        summary.backend.probes = probes;
        const requiredApiPaths = ["/api/admin/staff-users", "/api/appointments/queue", "/api/visits"];
        const missingRoutes = requiredApiPaths.filter((requiredPath) => {
          const probe = probes.find((item) => item.path === requiredPath);
          return !probe || !probe.exists;
        });
        const baseResponsive = probes.some((item) => item.path === "/" && item.status !== null);
        summary.backend.pass = baseResponsive && missingRoutes.length === 0;

        if (!summary.backend.pass) {
          summary.artifactPath = await saveJsonSnapshot(
            `${testInfo.titlePath.join(" > ")}--backend-probe-failure`,
            {
              step: "backend-endpoint-probe",
              probes,
              missingRoutes,
            }
          );
          await failWithSummary({
            summary,
            testInfo,
            error: buildCheckFailureError({
              step: "backend-endpoint-probe",
              command: `${backendScript.command} && probe ${requiredApiPaths.join(", ")}`,
              expected: "base URL responds and required API routes are not 404",
              actual: `missing routes: ${
                missingRoutes.length > 0 ? missingRoutes.join(", ") : "(none)"
              }`,
              artifactPath: summary.artifactPath,
            }),
          });
        }
      } else {
        summary.backend.checked = false;
        summary.backend.pass = true;
        summary.notes.push("Backend prod boot skipped: no start/start:prod/prod script found in backend/package.json.");
      }

      const rootPkg = await readJsonFile(path.join(ROOT_DIR, "package.json"));
      const rootScripts = (rootPkg.scripts || {}) as Record<string, unknown>;
      if (typeof rootScripts.preview === "string" && rootScripts.preview.trim()) {
        summary.preview.checked = true;
        summary.preview.command = "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort";
        previewProc = spawnManagedProcess({
          command: summary.preview.command,
          cwd: ROOT_DIR,
        });

        try {
          await waitForProcessReady({
            proc: previewProc,
            matcher: /127\.0\.0\.1:4173|localhost:4173|Local:/i,
            timeoutMs: 30_000,
            label: "vite preview process",
          });
        } catch (error) {
          summary.artifactPath = await saveJsonSnapshot(
            `${testInfo.titlePath.join(" > ")}--preview-boot-failure`,
            {
              step: "preview-boot",
              command: summary.preview.command,
              stdout: shortText(previewProc.getStdout(), 3_000),
              stderr: shortText(previewProc.getStderr(), 3_000),
            }
          );
          await failWithSummary({
            summary,
            testInfo,
            error: buildCheckFailureError({
              step: "preview-boot",
              command: summary.preview.command,
              expected: "vite preview boots and serves dist",
              actual: error instanceof Error ? error.message : String(error),
              artifactPath: summary.artifactPath,
            }),
          });
        }

        const fatalErrors = await checkPreviewFatalErrors(page, "http://127.0.0.1:4173");
        summary.preview.fatalErrors = fatalErrors;
        summary.preview.pass = fatalErrors.length === 0;
        if (!summary.preview.pass) {
          summary.artifactPath = await saveJsonSnapshot(
            `${testInfo.titlePath.join(" > ")}--preview-fatal-console`,
            {
              step: "preview-console-check",
              fatalErrors,
            }
          );
          await failWithSummary({
            summary,
            testInfo,
            error: buildCheckFailureError({
              step: "preview-console-check",
              command: "open http://127.0.0.1:4173 with Playwright",
              expected: "no fatal console/page errors",
              actual: fatalErrors.join(" | "),
              artifactPath: summary.artifactPath,
            }),
          });
        }
      } else {
        summary.preview.checked = false;
        summary.preview.pass = true;
        summary.notes.push("Preview check skipped: no preview script in root package.json.");
      }

      summary.overallPass = true;
      summary.artifactPath = await saveJsonSnapshot(
        `${testInfo.titlePath.join(" > ")}--prod-like-summary`,
        summary
      );

      expect(summary.build.pass).toBe(true);
      expect(summary.localhostScan.pass).toBe(true);
      expect(summary.backend.pass).toBe(true);
      expect(summary.preview.pass).toBe(true);
    } finally {
      if (previewProc) {
        await terminateProcessTree(previewProc.child);
      }
      if (backendProc) {
        await terminateProcessTree(backendProc.child);
      }

      if (!summary.artifactPath) {
        summary.artifactPath = await saveJsonSnapshot(
          `${testInfo.titlePath.join(" > ")}--prod-like-summary-finally`,
          summary
        );
      }
      await appendDiarySummary({ summary, testInfo });
    }
  });
});
