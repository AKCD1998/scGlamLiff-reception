function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toNonNegativeInt(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function toTitleCase(value) {
  const text = normalizeText(value);
  if (!text) return "";
  return text
    .split(/\s+/)
    .map((word) => {
      if (!word) return "";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function deriveNameFromCode(code) {
  const raw = normalizeText(code).replace(/[_-]+/g, " ");
  if (!raw) return "";
  return toTitleCase(raw);
}

function resolveBaseName(name, code) {
  const direct = normalizeText(name);
  if (direct) return direct;
  const fromCode = deriveNameFromCode(code);
  if (fromCode) return fromCode;
  return "Treatment";
}

export function formatTreatmentDisplay({
  treatmentName,
  treatmentSessions = 1,
  treatmentMask = 0,
  treatmentPrice = null,
} = {}) {
  const name = resolveBaseName(treatmentName);
  const sessionsRaw = toNonNegativeInt(treatmentSessions, 1);
  const sessions = sessionsRaw > 0 ? sessionsRaw : 1;
  const mask = toNonNegativeInt(treatmentMask, 0) || 0;
  const price = toNonNegativeInt(treatmentPrice, null);
  const priceText = Number.isFinite(price) && price > 0 ? ` (${price})` : "";

  if (sessions <= 1 && mask <= 0) {
    return `${name}${priceText}`;
  }

  return `${sessions}x ${name}${priceText} | Mask ${mask}`;
}

export function parseLegacyTreatmentText(text, { fallbackName = "", fallbackCode = "" } = {}) {
  const raw = normalizeText(text);
  if (!raw) return null;
  const lowered = raw.toLowerCase();

  let sessions = null;
  let mask = null;
  let price = null;

  const slashSessions = lowered.match(/\b\d+\s*\/\s*(\d+)\b/);
  if (slashSessions) {
    sessions = toNonNegativeInt(slashSessions[1], null);
  }
  if (!Number.isFinite(sessions)) {
    const xSessions = lowered.match(/\b(\d+)\s*x\b/);
    if (xSessions) sessions = toNonNegativeInt(xSessions[1], null);
  }

  const maskPair = lowered.match(/mask\s*(\d+)\s*\/\s*(\d+)/);
  if (maskPair) {
    mask = toNonNegativeInt(maskPair[2], null);
  }
  if (!Number.isFinite(mask)) {
    const maskSingle = lowered.match(/mask\s*(\d+)/);
    if (maskSingle) mask = toNonNegativeInt(maskSingle[1], null);
  }
  if (!Number.isFinite(mask)) {
    const reverseMask = lowered.match(/\b(\d+)\s*mask\b/);
    if (reverseMask) mask = toNonNegativeInt(reverseMask[1], null);
  }

  const parenPrice = lowered.match(/\((\d{2,6})\)/);
  if (parenPrice) {
    price = toNonNegativeInt(parenPrice[1], null);
  }
  if (!Number.isFinite(price)) {
    const numbers = [...lowered.matchAll(/\b(\d{2,6})\b/g)]
      .map((entry) => toNonNegativeInt(entry[1], null))
      .filter((value) => Number.isFinite(value));

    const candidates = numbers.filter((value) => value > 20 && value !== sessions && value !== mask);
    if (candidates.length > 0) {
      price = Math.max(...candidates);
    } else if (numbers.length === 1 && numbers[0] > 20) {
      price = numbers[0];
    }
  }

  let treatmentName = "";
  if (lowered.includes("smooth")) {
    treatmentName = "Smooth";
  } else {
    const words = raw
      .split(/[^A-Za-z\u0E00-\u0E7F]+/g)
      .map((word) => normalizeText(word))
      .filter(Boolean)
      .filter((word) => {
        const l = word.toLowerCase();
        return l !== "mask" && l !== "thb" && l !== "บาท" && l !== "free";
      });

    if (words.length > 0) {
      treatmentName = words.slice(0, 3).join(" ");
      if (/^[A-Za-z\s]+$/.test(treatmentName)) {
        treatmentName = toTitleCase(treatmentName);
      }
    }
  }

  const resolvedName =
    normalizeText(treatmentName) || resolveBaseName(fallbackName, fallbackCode);
  const resolvedSessions = Number.isFinite(sessions) && sessions > 0 ? sessions : 1;
  const resolvedMask = Number.isFinite(mask) && mask >= 0 ? mask : 0;
  const resolvedPrice = Number.isFinite(price) ? price : null;

  return {
    treatment_name: resolvedName,
    treatment_sessions: resolvedSessions,
    treatment_mask: resolvedMask,
    treatment_price: resolvedPrice,
    treatment_display: formatTreatmentDisplay({
      treatmentName: resolvedName,
      treatmentSessions: resolvedSessions,
      treatmentMask: resolvedMask,
      treatmentPrice: resolvedPrice,
    }),
  };
}

export function resolveTreatmentDisplay({
  treatmentId = "",
  treatmentName = "",
  treatmentCode = "",
  treatmentSessions = 1,
  treatmentMask = 0,
  treatmentPrice = null,
  legacyText = "",
} = {}) {
  const hasCatalogId = Boolean(normalizeText(treatmentId));

  if (hasCatalogId) {
    const resolvedName = resolveBaseName(treatmentName, treatmentCode);
    const sessionsRaw = toNonNegativeInt(treatmentSessions, 1);
    const sessions = sessionsRaw > 0 ? sessionsRaw : 1;
    const mask = toNonNegativeInt(treatmentMask, 0) || 0;
    const price = toNonNegativeInt(treatmentPrice, null);

    return {
      treatment_name: resolvedName,
      treatment_sessions: sessions,
      treatment_mask: mask,
      treatment_price: Number.isFinite(price) ? price : null,
      treatment_display: formatTreatmentDisplay({
        treatmentName: resolvedName,
        treatmentSessions: sessions,
        treatmentMask: mask,
        treatmentPrice: price,
      }),
      treatment_display_source: "catalog",
    };
  }

  const parsed = parseLegacyTreatmentText(legacyText, {
    fallbackName: treatmentName,
    fallbackCode: treatmentCode,
  });
  if (parsed) {
    return {
      ...parsed,
      treatment_display_source: "legacy_text",
    };
  }

  const fallbackName = resolveBaseName(treatmentName, treatmentCode);
  return {
    treatment_name: fallbackName,
    treatment_sessions: 1,
    treatment_mask: 0,
    treatment_price: null,
    treatment_display: fallbackName,
    treatment_display_source: "legacy_text",
  };
}

