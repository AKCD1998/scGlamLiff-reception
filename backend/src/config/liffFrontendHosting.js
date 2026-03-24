import fs from 'node:fs';
import path from 'node:path';

export const LIFF_FRONTEND_BASE_PATH = '/liff';
export const LIFF_FRONTEND_LEGACY_ASSET_BASE_PATH = '/ScGlamLiFF';

function normalizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function isUsableDistDirectory(candidatePath) {
  const normalizedPath = normalizeText(candidatePath);

  if (!normalizedPath) {
    return false;
  }

  const indexHtmlPath = path.join(normalizedPath, 'index.html');

  try {
    return fs.statSync(indexHtmlPath).isFile();
  } catch {
    return false;
  }
}

function dedupePaths(paths) {
  const seen = new Set();

  return paths.filter((candidatePath) => {
    const normalizedPath = normalizeText(candidatePath);

    if (!normalizedPath || seen.has(normalizedPath)) {
      return false;
    }

    seen.add(normalizedPath);
    return true;
  });
}

export function resolveLiffFrontendHostingConfig() {
  const candidatePaths = dedupePaths([
    normalizeText(process.env.LIFF_FRONTEND_DIST_DIR),
    path.resolve(process.cwd(), 'public', 'liff'),
    path.resolve(process.cwd(), '..', '..', 'scGlamLiFFF', 'scGlamLiFF', 'dist'),
  ]);
  const distDir = candidatePaths.find((candidatePath) =>
    isUsableDistDirectory(candidatePath)
  );

  return {
    enabled: Boolean(distDir),
    basePath: LIFF_FRONTEND_BASE_PATH,
    legacyAssetBasePath: LIFF_FRONTEND_LEGACY_ASSET_BASE_PATH,
    distDir: distDir || null,
    indexHtmlPath: distDir ? path.join(distDir, 'index.html') : null,
    candidatePaths,
  };
}
