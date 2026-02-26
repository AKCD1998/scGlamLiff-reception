#!/usr/bin/env node

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function parseArgs(argv) {
  const limitToken = argv.find((arg) => String(arg).startsWith("--limit="));
  const limitRaw = limitToken ? Number.parseInt(limitToken.split("=")[1], 10) : 500;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 2000) : 500;
  return { limit };
}

function getRequestHeaders() {
  const headers = {
    Accept: "application/json",
  };

  const cookie = normalizeText(process.env.AUTH_COOKIE);
  if (cookie) headers.Cookie = cookie;

  const bearer = normalizeText(process.env.AUTH_BEARER || process.env.BEARER_TOKEN);
  if (bearer) {
    headers.Authorization = bearer.toLowerCase().startsWith("bearer ")
      ? bearer
      : `Bearer ${bearer}`;
  }
  return headers;
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { method: "GET", headers });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { ok: false, error: `Non-JSON response: ${text.slice(0, 200)}` };
  }
  return { status: res.status, ok: res.ok, payload };
}

async function main() {
  const { limit } = parseArgs(process.argv.slice(2));
  const apiBase = stripTrailingSlash(process.env.API_BASE_URL || "http://localhost:5050");
  const headers = getRequestHeaders();
  const queueUrl = `${apiBase}/api/appointments/queue?limit=${encodeURIComponent(String(limit))}`;

  console.log("=== Treatment Display Consistency Verification ===");
  console.log(`API_BASE_URL: ${apiBase}`);
  console.log(`queue_limit: ${limit}`);
  console.log("");

  const queueRes = await fetchJson(queueUrl, headers);
  if (!queueRes.ok || !queueRes.payload?.ok) {
    console.error(`Queue request failed (status ${queueRes.status})`);
    console.error(JSON.stringify(queueRes.payload, null, 2));
    process.exit(1);
    return;
  }

  const rows = Array.isArray(queueRes.payload?.rows) ? queueRes.payload.rows : [];
  const violations = [];
  const thaiPattern = /บำบัดผิวใส\s*ให้เรียบเนียน/i;

  for (const row of rows) {
    const treatmentId = normalizeText(row?.treatment_id);
    if (!treatmentId) continue;

    const display = normalizeText(
      row?.treatment_display || row?.treatmentDisplay || row?.treatment_item_text || row?.treatmentItem
    );
    if (!display) continue;

    if (thaiPattern.test(display)) {
      violations.push({
        appointment_id: normalizeText(row?.appointment_id || row?.id),
        treatment_id: treatmentId,
        treatment_code: normalizeText(row?.treatment_code),
        treatment_display: display,
      });
    }
  }

  if (violations.length === 0) {
    console.log(`RESULT: PASS (${rows.length} rows scanned)`);
    process.exit(0);
    return;
  }

  console.log(`RESULT: FAIL (${violations.length} rows with non-canonical display)`);
  for (const violation of violations) {
    console.log(JSON.stringify(violation));
  }
  process.exit(1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
