function normalizeBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/, "");
}

function getOriginSafe(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

let hasWarnedApiConfig = false;

function warnIfApiConfigLooksRisky(apiBase) {
  if (hasWarnedApiConfig) return;
  if (typeof window === "undefined") return;

  const isDev = Boolean(import.meta.env.DEV);
  const host = String(window.location.hostname || "").toLowerCase();
  const isRenderHost = host.endsWith(".onrender.com");
  const sameOrigin = apiBase && getOriginSafe(apiBase) === window.location.origin;
  const allowSameOrigin =
    String(import.meta.env.VITE_ALLOW_SAME_ORIGIN_API || "")
      .trim()
      .toLowerCase() === "true";

  // Guardrail: empty API base outside local dev usually means wrong production wiring.
  if (!apiBase && !isDev) {
    hasWarnedApiConfig = true;
    console.warn(
      "[config] API base is empty in non-dev mode. Set VITE_API_BASE_URL to your backend service URL."
    );
    return;
  }

  // Guardrail for Render static-site deployments where frontend origin is not backend.
  if (isRenderHost && (!apiBase || (sameOrigin && !allowSameOrigin))) {
    hasWarnedApiConfig = true;
    console.warn(
      "[config] API base looks misconfigured for Render. " +
        "Set VITE_API_BASE_URL to your backend web service URL. " +
        "Use same-origin only if /api rewrite is intentionally configured " +
        "(or set VITE_ALLOW_SAME_ORIGIN_API=true).",
      {
        frontendOrigin: window.location.origin,
        apiBase: apiBase || "(empty)",
      }
    );
  }
}

export function getApiBaseUrl() {
  const primary = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
  const fallback = normalizeBaseUrl(import.meta.env.VITE_API_BASE);
  const resolved = primary || fallback;
  warnIfApiConfigLooksRisky(resolved);
  return resolved;
}
