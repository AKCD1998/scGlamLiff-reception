#!/usr/bin/env node

const DEFAULT_APPOINTMENT_IDS = [
  "216cb944-5d28-4945-b4a8-56c90b42cc89",
  "a0a94f48-2978-4b31-86c5-550907087ffe",
];

const REQUIRED_MATCH_FIELDS = [
  "customer_full_name",
  "scheduled_at",
  "branch_id",
  "treatment_id",
  "status",
];

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function parseCliAppointmentIds(argv) {
  const ids = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (token === "--id" && argv[i + 1]) {
      ids.push(String(argv[i + 1]).trim());
      i += 1;
      continue;
    }
    if (token.startsWith("--id=")) {
      ids.push(token.slice("--id=".length).trim());
      continue;
    }
    if (token === "--ids" && argv[i + 1]) {
      ids.push(
        ...String(argv[i + 1])
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      );
      i += 1;
      continue;
    }
    if (token.startsWith("--ids=")) {
      ids.push(
        ...token
          .slice("--ids=".length)
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean)
      );
    }
  }
  return ids.filter(Boolean);
}

function resolveAppointmentIds() {
  const cliIds = parseCliAppointmentIds(process.argv.slice(2));
  if (cliIds.length > 0) return Array.from(new Set(cliIds));

  const envIds = String(process.env.APPOINTMENT_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (envIds.length > 0) return Array.from(new Set(envIds));

  return DEFAULT_APPOINTMENT_IDS;
}

function getRequestHeaders() {
  const headers = {
    Accept: "application/json",
  };

  const cookie = normalizeText(process.env.AUTH_COOKIE);
  if (cookie) {
    headers.Cookie = cookie;
  }

  const bearer = normalizeText(process.env.AUTH_BEARER || process.env.BEARER_TOKEN);
  if (bearer) {
    headers.Authorization = bearer.toLowerCase().startsWith("bearer ")
      ? bearer
      : `Bearer ${bearer}`;
  }

  return headers;
}

async function fetchJson(url, headers) {
  const res = await fetch(url, {
    method: "GET",
    headers,
  });

  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { ok: false, error: `Non-JSON response: ${text.slice(0, 200)}` };
  }

  return { status: res.status, ok: res.ok, payload };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toBangkokDateKey(isoDatetime) {
  const raw = normalizeText(isoDatetime);
  if (!raw) return "";

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw.slice(0, 10);
  }

  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const bangkokDate = new Date(parsed.getTime() + bangkokOffsetMs);
  return `${bangkokDate.getUTCFullYear()}-${pad2(bangkokDate.getUTCMonth() + 1)}-${pad2(
    bangkokDate.getUTCDate()
  )}`;
}

function findQueueRow(rows, appointmentId) {
  const targetId = normalizeText(appointmentId);
  return (
    (Array.isArray(rows) ? rows : []).find((row) => {
      const queueId = normalizeText(row?.appointment_id || row?.id);
      return queueId === targetId;
    }) || null
  );
}

function asQueueSnapshot(row, fallbackId) {
  return {
    appointment_id: normalizeText(row?.appointment_id || row?.id || fallbackId),
    customer_full_name: normalizeText(row?.customer_full_name || row?.customerName),
    scheduled_at: normalizeText(row?.scheduled_at),
    branch_id: normalizeText(row?.branch_id),
    treatment_id: normalizeText(row?.treatment_id),
    status: normalizeText(row?.status),
    raw_sheet_uuid: normalizeText(row?.raw_sheet_uuid),
    phone: normalizeText(row?.phone),
    treatment_item_text: normalizeText(
      row?.treatment_item_text ||
        row?.treatment_item_text_override ||
        row?.treatmentItem ||
        row?.treatmentItemDisplay
    ),
    staff_name: normalizeText(row?.staff_name || row?.staffName),
  };
}

function asAdminSnapshot(appointment, fallbackId) {
  return {
    appointment_id: normalizeText(appointment?.id || fallbackId),
    customer_full_name: normalizeText(appointment?.customer_full_name),
    scheduled_at: normalizeText(appointment?.scheduled_at),
    branch_id: normalizeText(appointment?.branch_id),
    treatment_id: normalizeText(appointment?.treatment_id),
    status: normalizeText(appointment?.status),
    raw_sheet_uuid: normalizeText(appointment?.raw_sheet_uuid),
    phone: normalizeText(appointment?.phone),
    treatment_item_text: normalizeText(appointment?.treatment_item_text),
    staff_name: normalizeText(appointment?.staff_name),
  };
}

function normalizeForCompare(field, value) {
  const text = normalizeText(value);
  if (!text) return "";

  if (field === "scheduled_at") {
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) return text;
    return new Date(parsed).toISOString();
  }

  return text;
}

function compareSnapshots(queueSnapshot, adminSnapshot, fields) {
  const mismatches = [];
  for (const field of fields) {
    const queueValue = normalizeForCompare(field, queueSnapshot[field]);
    const adminValue = normalizeForCompare(field, adminSnapshot[field]);
    if (queueValue !== adminValue) {
      mismatches.push({
        field,
        queue: queueSnapshot[field] || "",
        admin: adminSnapshot[field] || "",
      });
    }
  }
  return mismatches;
}

function printUsageHint() {
  console.log("Hint: set AUTH_COOKIE or AUTH_BEARER if endpoints require auth.");
  console.log("Example:");
  console.log(
    "  AUTH_COOKIE=\"connect.sid=...\" API_BASE_URL=\"http://localhost:5050\" node scripts/verify_appointment_consistency.js"
  );
}

async function main() {
  const apiBase = stripTrailingSlash(
    process.env.API_BASE_URL || process.env.VERIFY_API_BASE || "http://localhost:5050"
  );
  const ids = resolveAppointmentIds();
  const headers = getRequestHeaders();

  console.log("=== Appointment Consistency Verification ===");
  console.log(`API_BASE_URL: ${apiBase}`);
  console.log(`appointment_ids: ${ids.join(", ")}`);
  console.log(`required_fields: ${REQUIRED_MATCH_FIELDS.join(", ")}`);
  console.log("");

  const failures = [];
  let passCount = 0;

  for (const appointmentId of ids) {
    const detailUrl = `${apiBase}/api/admin/appointments/${encodeURIComponent(appointmentId)}`;
    const detailRes = await fetchJson(detailUrl, headers);

    if (!detailRes.ok || !detailRes.payload?.ok) {
      failures.push({
        appointment_id: appointmentId,
        reason: `detail request failed (status ${detailRes.status})`,
        details: detailRes.payload,
      });
      console.log(`[FAIL] ${appointmentId} detail request failed (status ${detailRes.status})`);
      continue;
    }

    const adminSnapshot = asAdminSnapshot(detailRes.payload?.appointment, appointmentId);
    const dateKey = toBangkokDateKey(adminSnapshot.scheduled_at);
    const queueUrl = `${apiBase}/api/appointments/queue?limit=500${
      dateKey ? `&date=${encodeURIComponent(dateKey)}` : ""
    }`;
    const queueRes = await fetchJson(queueUrl, headers);

    if (!queueRes.ok || !queueRes.payload?.ok) {
      failures.push({
        appointment_id: appointmentId,
        reason: `queue request failed (status ${queueRes.status})`,
        details: queueRes.payload,
      });
      console.log(`[FAIL] ${appointmentId} queue request failed (status ${queueRes.status})`);
      continue;
    }

    let queueRow = findQueueRow(queueRes.payload?.rows, appointmentId);
    if (!queueRow && dateKey) {
      const fallbackQueueUrl = `${apiBase}/api/appointments/queue?limit=500`;
      const fallbackQueueRes = await fetchJson(fallbackQueueUrl, headers);
      if (fallbackQueueRes.ok && fallbackQueueRes.payload?.ok) {
        queueRow = findQueueRow(fallbackQueueRes.payload?.rows, appointmentId);
      }
    }

    if (!queueRow) {
      failures.push({
        appointment_id: appointmentId,
        reason: "appointment_id not found in queue rows",
      });
      console.log(`[FAIL] ${appointmentId} not found in queue rows`);
      continue;
    }

    const queueSnapshot = asQueueSnapshot(queueRow, appointmentId);
    const mismatches = compareSnapshots(
      queueSnapshot,
      adminSnapshot,
      REQUIRED_MATCH_FIELDS
    );

    if (mismatches.length > 0) {
      failures.push({
        appointment_id: appointmentId,
        reason: "field mismatch",
        mismatches,
        queue: queueSnapshot,
        admin: adminSnapshot,
      });
      console.log(`[FAIL] ${appointmentId} mismatched fields:`);
      for (const row of mismatches) {
        console.log(`  - ${row.field}: queue="${row.queue}" admin="${row.admin}"`);
      }
      continue;
    }

    passCount += 1;
    console.log(`[PASS] ${appointmentId} matches on ${REQUIRED_MATCH_FIELDS.join(", ")}`);
  }

  console.log("");
  if (failures.length === 0) {
    console.log(`RESULT: PASS (${passCount}/${ids.length})`);
    process.exitCode = 0;
    return;
  }

  console.log(`RESULT: FAIL (${passCount}/${ids.length} passed, ${failures.length} failed)`);
  for (const failure of failures) {
    console.log(`- ${failure.appointment_id}: ${failure.reason}`);
  }
  console.log("");
  printUsageHint();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("Fatal error:", error);
  printUsageHint();
  process.exitCode = 1;
});

