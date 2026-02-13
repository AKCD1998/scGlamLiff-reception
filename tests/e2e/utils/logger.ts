import fs from "node:fs/promises";
import path from "node:path";
import type { TestInfo } from "@playwright/test";

export interface FailureLogArtifacts {
  screenshotPath: string | null;
  responseSnapshotPath: string | null;
  metadataPath: string;
}

export interface FailureLogContext {
  testInfo: TestInfo;
  artifacts: FailureLogArtifacts;
  failingStep?: string;
  expected?: string;
  actual?: string;
}

interface LogPaths {
  projectDiary: string;
  blunder: string;
}

const DIARY_CANDIDATES = [
  "PROJECT_DIARY.md",
  "PROJECT_DIARIES.md",
  path.join("markdown", "PROJECT_DIARY.md"),
  path.join("markdown", "PROJECT_DIARIES.md"),
];

const BLUNDER_CANDIDATES = [
  "BLUNDER.md",
  "BLUNDERS.md",
  path.join("markdown", "BLUNDER.md"),
  path.join("markdown", "BLUNDERS.md"),
];

async function exists(filePath: string): Promise<boolean> {
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
  const root = process.cwd();
  for (const rel of candidates) {
    const fullPath = path.join(root, rel);
    if (await exists(fullPath)) {
      return fullPath;
    }
  }

  const fallbackPath = path.join(root, fallbackName);
  await fs.writeFile(fallbackPath, `${header}\n\n`, "utf8");
  return fallbackPath;
}

async function resolveLogPaths(): Promise<LogPaths> {
  const [projectDiary, blunder] = await Promise.all([
    resolveOrCreate(DIARY_CANDIDATES, "PROJECT_DIARY.md", "# Project Diary"),
    resolveOrCreate(BLUNDER_CANDIDATES, "BLUNDER.md", "# Blunder Log"),
  ]);
  return { projectDiary, blunder };
}

function toRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join("/");
}

function compactMessage(errorMessage: string | undefined): string {
  if (!errorMessage) return "Unknown failure";
  return errorMessage.split("\n").slice(0, 2).join(" ").trim();
}

function buildReproCommand(testInfo: TestInfo): string {
  const file = path.relative(process.cwd(), testInfo.file).split(path.sep).join("/");
  const grep = testInfo.title.replace(/"/g, '\\"');
  return `npm run test:e2e -- ${file} --grep "${grep}"`;
}

function formatArtifactList(artifacts: FailureLogArtifacts): string {
  const lines: string[] = [];
  if (artifacts.screenshotPath) lines.push(`screenshot: \`${artifacts.screenshotPath}\``);
  if (artifacts.responseSnapshotPath) {
    lines.push(`last-response: \`${artifacts.responseSnapshotPath}\``);
  }
  lines.push(`metadata: \`${artifacts.metadataPath}\``);
  return lines.join(", ");
}

export async function appendFailureLogs(context: FailureLogContext): Promise<void> {
  const { testInfo, artifacts } = context;
  const logPaths = await resolveLogPaths();

  const timestamp = new Date().toISOString();
  const specName = testInfo.titlePath.join(" > ");
  const failingStep = context.failingStep || specName;
  const expected =
    context.expected || "Spec assertions should pass without request/response mismatches.";
  const actual = context.actual || compactMessage(testInfo.error?.message);
  const reproCommand = buildReproCommand(testInfo);
  const artifactSummary = formatArtifactList(artifacts);

  const diaryEntry = [
    "",
    `## ${timestamp} — E2E Failure: ${specName}`,
    "",
    `- Spec: \`${specName}\``,
    `- Reproduction: \`${reproCommand}\``,
    `- Error: ${actual}`,
    `- Artifacts: ${artifactSummary}`,
    "",
  ].join("\n");

  const blunderEntry = [
    "",
    `## ${timestamp} — E2E: ${testInfo.title}`,
    "",
    `- Title: ${testInfo.title}`,
    `- Failing step: ${failingStep}`,
    `- Expected: ${expected}`,
    `- Actual: ${actual}`,
    `- Artifact paths: ${artifactSummary}`,
    "",
  ].join("\n");

  await Promise.all([
    fs.appendFile(logPaths.projectDiary, diaryEntry, "utf8"),
    fs.appendFile(logPaths.blunder, blunderEntry, "utf8"),
  ]);

  // Keep this for debugging if path resolution changes later.
  const indexEntry = [
    "",
    `<!-- e2e-log-index: ${timestamp} diary=${toRelative(logPaths.projectDiary)} blunder=${toRelative(logPaths.blunder)} -->`,
    "",
  ].join("\n");
  await fs.appendFile(logPaths.projectDiary, indexEntry, "utf8");
}

