import { EMAIL_PATTERN, LINE_ID_PATTERN } from "./constants";

export function sanitizeThaiPhone(input) {
  const digits = String(input ?? "").replace(/\D+/g, "");
  if (!digits) return "";

  if (digits.startsWith("66") && digits.length === 11) {
    return `0${digits.slice(-9)}`;
  }

  if (digits.length === 10 && digits.startsWith("0")) {
    return digits;
  }

  if (digits.length === 9 && !digits.startsWith("0")) {
    return `0${digits}`;
  }

  return "";
}

export function sanitizeEmailOrLine(input) {
  const cleaned = String(input ?? "").trim();
  if (!cleaned) return "";

  if (cleaned.includes("@")) {
    return EMAIL_PATTERN.test(cleaned) ? cleaned : "";
  }

  return LINE_ID_PATTERN.test(cleaned) ? cleaned : "";
}

