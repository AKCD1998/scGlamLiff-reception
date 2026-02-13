const E2E_NAME_PATTERNS = [/^e2e_/i, /^e2e_workflow_/i, /^verify-/i];

function parseBooleanEnv(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function hasE2EMarker(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return E2E_NAME_PATTERNS.some((pattern) => pattern.test(text));
}

export function isE2EName(name) {
  return hasE2EMarker(name);
}

export function shouldHideTestRecordsByDefault() {
  const override = parseBooleanEnv(import.meta.env.VITE_HIDE_E2E_RECORDS);
  if (override !== null) return override;
  return Boolean(import.meta.env.PROD);
}

export function isTestRecord(row) {
  if (!row || typeof row !== "object") return false;

  const nameCandidates = [
    row.fullName,
    row.full_name,
    row.customerName,
    row.customer_name,
    row.customer_full_name,
    row.display_name,
    row.lineId,
    row.line_id,
    row.email_or_lineid,
    row.emailOrLineId,
  ];

  return nameCandidates.some(hasE2EMarker);
}

