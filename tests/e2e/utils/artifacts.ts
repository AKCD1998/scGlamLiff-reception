import fs from "node:fs/promises";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

export interface ApiResponseSnapshot {
  url: string;
  method: string;
  status: number;
  ok: boolean;
  timestamp: string;
  contentType: string | null;
  body: unknown;
}

export interface FailureArtifacts {
  screenshotPath: string | null;
  responseSnapshotPath: string | null;
  loginResponsePath: string | null;
  metadataPath: string;
}

const ARTIFACT_ROOT = path.join(process.cwd(), "tests", "e2e", "artifacts");

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toSafeName(input: string): string {
  return input
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 140);
}

function toRelativePath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
}

export async function ensureArtifactDayDir(date = new Date()): Promise<string> {
  const dayDir = path.join(ARTIFACT_ROOT, formatDate(date));
  await fs.mkdir(dayDir, { recursive: true });
  return dayDir;
}

export async function saveJsonSnapshot(
  fileName: string,
  payload: unknown,
  date = new Date()
): Promise<string> {
  const dayDir = await ensureArtifactDayDir(date);
  const filePath = path.join(dayDir, `${toSafeName(fileName)}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return toRelativePath(filePath);
}

export async function saveFailureArtifacts(params: {
  page: Page;
  testInfo: TestInfo;
  lastApiResponse: ApiResponseSnapshot | null;
}): Promise<FailureArtifacts> {
  const { page, testInfo, lastApiResponse } = params;
  const dayDir = await ensureArtifactDayDir();
  const title = testInfo.titlePath.join(" > ");
  const baseName = toSafeName(`${title}--retry-${testInfo.retry}`);

  const screenshotAbsolute = path.join(dayDir, `${baseName}.png`);
  let screenshotPath: string | null = null;
  try {
    await page.screenshot({ path: screenshotAbsolute, fullPage: true });
    screenshotPath = toRelativePath(screenshotAbsolute);
  } catch {
    screenshotPath = null;
  }

  let responseSnapshotPath: string | null = null;
  if (lastApiResponse) {
    const responseAbsolute = path.join(dayDir, `${baseName}--last-api-response.json`);
    await fs.writeFile(responseAbsolute, JSON.stringify(lastApiResponse, null, 2), "utf8");
    responseSnapshotPath = toRelativePath(responseAbsolute);
  }

  const metadataAbsolute = path.join(dayDir, `${baseName}--failure-meta.json`);
  const metadata = {
    test: {
      title: testInfo.title,
      titlePath: testInfo.titlePath,
      file: testInfo.file,
      line: testInfo.line,
      retry: testInfo.retry,
      status: testInfo.status,
      expectedStatus: testInfo.expectedStatus,
      durationMs: testInfo.duration,
    },
    error: testInfo.error
      ? {
          message: testInfo.error.message,
          stack: testInfo.error.stack || null,
        }
      : null,
    artifacts: {
      screenshotPath,
      responseSnapshotPath,
    },
    capturedAt: new Date().toISOString(),
  };
  await fs.writeFile(metadataAbsolute, JSON.stringify(metadata, null, 2), "utf8");

  return {
    screenshotPath,
    responseSnapshotPath,
    loginResponsePath: null,
    metadataPath: toRelativePath(metadataAbsolute),
  };
}
