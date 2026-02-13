import fs from "node:fs";
import path from "node:path";

export interface UserCredentials {
  username: string;
  password: string;
}

export interface RuntimeEnv {
  baseUrl: string;
  apiBase: string;
  admin: UserCredentials;
  staff: UserCredentials;
}

function parseDotEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    result[key] = value;
  }
  return result;
}

function readDotEnvFile(filePath: string): Record<string, string> {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return parseDotEnv(content);
  } catch {
    return {};
  }
}

function normalizeBaseUrl(input: string): string {
  return (input || "").replace(/\/+$/, "");
}

function resolveRequiredCredentials(params: {
  username: string | undefined;
  password: string | undefined;
  roleLabel: string;
}): UserCredentials {
  const username = String(params.username || "").trim();
  const password = String(params.password || "").trim();
  if (!username || !password) {
    throw new Error(
      `Missing ${params.roleLabel} credentials for E2E. Set env vars or backend/.env values.`
    );
  }
  return { username, password };
}

export function loadRuntimeEnv(): RuntimeEnv {
  const root = process.cwd();
  const feEnv = readDotEnvFile(path.join(root, ".env.development"));
  const backendEnv = readDotEnvFile(path.join(root, "backend", ".env"));

  const baseUrl = normalizeBaseUrl(
    process.env.E2E_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173"
  );
  const apiBase = normalizeBaseUrl(
    process.env.E2E_API_BASE ||
      process.env.VITE_API_BASE ||
      feEnv.VITE_API_BASE ||
      "http://localhost:5050"
  );

  const admin = resolveRequiredCredentials({
    username: process.env.E2E_ADMIN_USERNAME || backendEnv.ADMIN_USERNAME,
    password: process.env.E2E_ADMIN_PASSWORD || backendEnv.ADMIN_PASSWORD,
    roleLabel: "admin",
  });

  const staff = resolveRequiredCredentials({
    username: process.env.E2E_STAFF_USERNAME || backendEnv.SEED_USERNAME,
    password: process.env.E2E_STAFF_PASSWORD || backendEnv.SEED_PASSWORD,
    roleLabel: "staff",
  });

  return {
    baseUrl,
    apiBase,
    admin,
    staff,
  };
}

