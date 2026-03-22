const trimText = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeLine = (line) => trimText(String(line || '').replace(/\s+/g, ' '));

const splitReceiptLines = (text) =>
  String(text || '')
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);

const normalizeAmountCandidate = (rawValue) => {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return {
      numericValue: rawValue,
      display: rawValue.toFixed(2),
    };
  }

  const cleaned = String(rawValue || '').replace(/[^\d., ]/g, '').trim();

  if (!cleaned) {
    return null;
  }

  let normalizedValue = '';
  const spacedMatch = cleaned.match(/^(\d[\d,]*)\s(\d{2})$/);

  if (spacedMatch) {
    normalizedValue = `${spacedMatch[1].replace(/,/g, '')}.${spacedMatch[2]}`;
  } else if (/^\d[\d,]*[.,]\d{2}$/.test(cleaned)) {
    normalizedValue = cleaned.replace(/,/g, '');
  } else if (/^\d[\d,]*$/.test(cleaned)) {
    normalizedValue = `${cleaned.replace(/,/g, '')}.00`;
  } else {
    return null;
  }

  const numericValue = Number(normalizedValue);

  if (Number.isNaN(numericValue)) {
    return null;
  }

  return {
    numericValue,
    display: numericValue.toFixed(2),
  };
};

const collectAmountsFromLine = (line) => {
  const matches = new Set([
    ...(String(line || '').match(/\d[\d,]*\s\d{2}\b/g) || []),
    ...(String(line || '').match(/\d[\d,]*[.,]\d{2}\b/g) || []),
  ]);

  return [...matches]
    .map((value) => normalizeAmountCandidate(value))
    .filter(Boolean);
};

const findReceiptLine = (lines) =>
  lines.find((line) =>
    /\b\d{2}[/-]\d{2}[/-]\d{4}\b.*\b\d{2}:\d{2}\b.*\bBNO[:\s]?[A-Z0-9-:/]+\b/i.test(line)
  ) || '';

const extractReceiptLineParts = (receiptLine) => {
  const match = String(receiptLine || '').match(
    /\b(?<day>\d{2})[/-](?<month>\d{2})[/-](?<year>\d{4})\b(?:.*?\b(?<time>\d{2}:\d{2})\b)?/i
  );

  if (!match?.groups) {
    return {
      receiptDate: '',
      receiptTime: '',
    };
  }

  const { day, month, year, time } = match.groups;

  return {
    receiptDate:
      day && month && year
        ? `${year}-${month}-${day}`
        : '',
    receiptTime: time || '',
  };
};

const isReceiptMetaLine = (line) =>
  /\bBNO[:\s]?[A-Z0-9-:/]+\b/i.test(line) ||
  /\b\d{2}[/-]\d{2}[/-]\d{4}\b.*\b\d{2}:\d{2}\b/.test(line);

const findTotalAmountCandidate = (lines) => {
  const anchorIndexes = lines.reduce((indexes, line, index) => {
    if (/\b(total|amount|items|cash|change)\b/i.test(line)) {
      indexes.push(index);
    }
    return indexes;
  }, []);

  const anchoredLines = anchorIndexes.flatMap((index) =>
    lines.slice(Math.max(0, index - 1), index + 3)
  );
  const fallbackLines = lines.slice(-6);
  const candidates = [...anchoredLines, ...fallbackLines]
    .filter((line) => !isReceiptMetaLine(line))
    .flatMap((line) => collectAmountsFromLine(line))
    .sort((left, right) => right.numericValue - left.numericValue);

  const meaningfulCandidates = candidates.filter((candidate) => candidate.numericValue >= 10);

  return meaningfulCandidates[0] || candidates[0] || null;
};

const isMerchantCandidate = (line) => {
  if (!line) {
    return false;
  }

  return (
    !isReceiptMetaLine(line) &&
    /[A-Za-z\u0E00-\u0E7F]/.test(line) &&
    !/\b(total|amount|items|cash|change)\b/i.test(line)
  );
};

const findMerchantName = (lines) => lines.find((line) => isMerchantCandidate(line)) || '';

export const parseReceiptText = (rawText) => {
  const receiptLines = splitReceiptLines(rawText);
  const receiptLine = findReceiptLine(receiptLines);
  const totalAmountCandidate = findTotalAmountCandidate(receiptLines);
  const { receiptDate, receiptTime } = extractReceiptLineParts(receiptLine);
  const merchant = findMerchantName(receiptLines);

  return {
    receiptLine,
    receiptLines,
    totalAmount: totalAmountCandidate ? `${totalAmountCandidate.display} THB` : '',
    totalAmountValue: totalAmountCandidate?.numericValue ?? null,
    receiptDate,
    receiptTime,
    merchant,
    merchantName: merchant,
  };
};

export default parseReceiptText;
