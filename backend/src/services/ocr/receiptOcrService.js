import { parseReceiptText } from './receiptParser.js';
import {
  OCR_SERVICE_BASE_URL,
  OCR_SERVICE_ENABLED,
  OCR_SERVICE_FALLBACK_TO_MOCK,
  checkPythonOcrHealth,
  requestPythonReceiptOcr,
} from './pythonOcrClient.js';
import {
  OCR_ROUTE_ABSOLUTE_PATHS,
  OCR_ROUTE_BASE_PATH,
} from './ocrRouteConfig.js';

const DEFAULT_MOCK_RECEIPT_TEXT = [
  '17/03/2026 08:36 BNO:S2603004002-0006510',
  'Total 1.00 Items',
  '324 00',
].join('\n');

const EMPTY_PARSED_RESULT = Object.freeze({
  receiptLine: '',
  receiptLines: [],
  totalAmount: '',
  totalAmountValue: null,
  receiptDate: '',
  receiptTime: '',
  merchant: '',
  merchantName: '',
});

const trimText = (value) => (typeof value === 'string' ? value.trim() : '');

const splitReceiptLines = (value) =>
  String(value || '')
    .split(/\r?\n/)
    .map((line) => trimText(line.replace(/\s+/g, ' ')))
    .filter(Boolean);

const pickFirstObject = (...values) =>
  values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) || null;

const pickFirstText = (...values) =>
  values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';

const buildFileMetadata = (file) => ({
  originalName: file.originalname || '',
  mimeType: file.mimetype || '',
  size: Number(file.size) || 0,
});

const normalizeAmountCandidate = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      numericValue: value,
      display: value.toFixed(2),
    };
  }

  const cleaned = String(value || '').replace(/[^\d., ]/g, '').trim();

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

const normalizeParsedReceipt = (parsed, rawText) => {
  const fallbackParsed = parseReceiptText(rawText);
  const parsedPayload = pickFirstObject(parsed) || {};
  const receiptLines = Array.isArray(parsedPayload.receiptLines)
    ? parsedPayload.receiptLines.map((line) => trimText(line)).filter(Boolean)
    : Array.isArray(parsedPayload.receipt_lines)
      ? parsedPayload.receipt_lines.map((line) => trimText(line)).filter(Boolean)
      : fallbackParsed.receiptLines;
  const amountCandidate =
    normalizeAmountCandidate(parsedPayload.totalAmountValue) ||
    normalizeAmountCandidate(parsedPayload.total_amount_value) ||
    normalizeAmountCandidate(parsedPayload.totalAmount) ||
    normalizeAmountCandidate(parsedPayload.total_amount) ||
    normalizeAmountCandidate(fallbackParsed.totalAmountValue) ||
    normalizeAmountCandidate(fallbackParsed.totalAmount);
  const merchant = pickFirstText(
    parsedPayload.merchant,
    parsedPayload.merchantName,
    parsedPayload.merchant_name,
    fallbackParsed.merchant,
    fallbackParsed.merchantName
  );

  return {
    receiptLine: pickFirstText(parsedPayload.receiptLine, parsedPayload.receipt_line, fallbackParsed.receiptLine),
    receiptLines,
    totalAmount: amountCandidate ? `${amountCandidate.display} THB` : pickFirstText(parsedPayload.totalAmount, fallbackParsed.totalAmount),
    totalAmountValue: amountCandidate?.numericValue ?? null,
    receiptDate: pickFirstText(parsedPayload.receiptDate, parsedPayload.receipt_date, fallbackParsed.receiptDate),
    receiptTime: pickFirstText(parsedPayload.receiptTime, parsedPayload.receipt_time, fallbackParsed.receiptTime),
    merchant,
    merchantName: merchant,
  };
};

const hasUsableParsedResult = (parsed) =>
  Boolean(
    trimText(parsed?.receiptLine) ||
      (Array.isArray(parsed?.receiptLines) && parsed.receiptLines.length > 0) ||
      trimText(parsed?.totalAmount) ||
      (typeof parsed?.totalAmountValue === 'number' && Number.isFinite(parsed.totalAmountValue))
  );

export const buildReceiptOcrErrorPayload = ({
  code = 'OCR_PROCESSING_FAILED',
  message = 'Failed to process receipt OCR',
  mode = 'node-receipt-ocr',
  details = null,
} = {}) => ({
  success: false,
  code,
  message,
  errorCode: code,
  errorMessage: message,
  ocrStatus: 'error',
  mode,
  rawText: '',
  ocrText: '',
  parsed: {
    ...EMPTY_PARSED_RESULT,
  },
  receiptLine: '',
  receiptLines: [],
  totalAmount: '',
  totalAmountTHB: null,
  receiptDate: '',
  receiptTime: '',
  merchant: '',
  merchantName: '',
  ocrMetadata: {},
  error: {
    code,
    message,
    ...(details ? { details } : {}),
  },
});

const buildReceiptOcrSuccessResponse = ({
  code = 'OCR_OK',
  message = 'Receipt OCR completed',
  ocrStatus = 'success',
  mode,
  file,
  rawText,
  parsed,
  ocrMetadata = {},
  statusNote = '',
}) => {
  const normalizedParsed = normalizeParsedReceipt(parsed, rawText);

  return {
    success: true,
    code,
    message,
    errorCode: '',
    errorMessage: '',
    ocrStatus,
    mode,
    file: buildFileMetadata(file),
    rawText: trimText(rawText),
    ocrText: trimText(rawText),
    parsed: normalizedParsed,
    receiptLine: normalizedParsed.receiptLine,
    receiptLines: normalizedParsed.receiptLines,
    totalAmount: normalizedParsed.totalAmount,
    totalAmountTHB: normalizedParsed.totalAmountValue,
    receiptDate: normalizedParsed.receiptDate,
    receiptTime: normalizedParsed.receiptTime,
    merchant: normalizedParsed.merchant,
    merchantName: normalizedParsed.merchantName,
    ocrMetadata,
    statusNote,
    error: null,
  };
};

export class ReceiptOcrProcessingError extends Error {
  constructor(
    message,
    { status = 500, code = 'OCR_PROCESSING_FAILED', details = null, mode } = {}
  ) {
    super(message);
    this.name = 'ReceiptOcrProcessingError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.mode = mode || 'node-receipt-ocr';
    this.payload = buildReceiptOcrErrorPayload({
      code,
      message,
      mode: this.mode,
      details,
    });
  }
}

const buildMockReceiptOcrResponse = ({ file, rawText, mode = 'mock-upload', statusNote = '' }) =>
  buildReceiptOcrSuccessResponse({
    code: 'OCR_LEGACY_MOCK_RESULT',
    message: 'Legacy mock OCR result returned',
    ocrStatus: 'mock',
    mode,
    file,
    rawText,
    parsed: parseReceiptText(rawText),
    ocrMetadata: {
      engine: 'legacy-mock',
      activePath: false,
    },
    statusNote,
  });

const buildPythonReceiptOcrResponse = ({ file, payload }) => {
  const rawText = pickFirstText(payload?.rawText, payload?.ocrText, payload?.text);
  const parsed = normalizeParsedReceipt(payload?.parsed, rawText);

  if (!trimText(rawText) && !hasUsableParsedResult(parsed)) {
    throw new ReceiptOcrProcessingError('Python OCR service returned no usable OCR data', {
      status: 502,
      code: 'OCR_RESPONSE_INVALID',
      mode: trimText(payload?.mode) || 'python-paddleocr',
    });
  }

  return buildReceiptOcrSuccessResponse({
    code: pickFirstText(payload?.code, payload?.errorCode) || 'OCR_OK',
    message: pickFirstText(payload?.message, payload?.errorMessage) || 'Receipt OCR completed',
    ocrStatus: trimText(payload?.ocrStatus) || 'success',
    mode: trimText(payload?.mode) || 'python-paddleocr',
    file,
    rawText,
    parsed: {
      ...parsed,
      receiptLines:
        Array.isArray(payload?.receiptLines) && payload.receiptLines.length
          ? payload.receiptLines.map((line) => trimText(line)).filter(Boolean)
          : Array.isArray(payload?.parsed?.receiptLines) && payload.parsed.receiptLines.length
            ? payload.parsed.receiptLines.map((line) => trimText(line)).filter(Boolean)
            : parsed.receiptLines,
      merchant:
        pickFirstText(payload?.merchant, payload?.merchantName, payload?.parsed?.merchant, payload?.parsed?.merchantName) ||
        parsed.merchant,
      merchantName:
        pickFirstText(payload?.merchantName, payload?.merchant, payload?.parsed?.merchantName, payload?.parsed?.merchant) ||
        parsed.merchantName,
    },
    ocrMetadata: pickFirstObject(payload?.ocrMetadata, payload?.meta) || {},
  });
};

export const processReceiptOcrRequest = async ({ file, rawTextOverride }) => {
  const normalizedOverride =
    typeof rawTextOverride === 'string' && rawTextOverride.trim()
      ? rawTextOverride.trim()
      : '';

  if (!file) {
    throw new ReceiptOcrProcessingError('receipt image is required', {
      status: 400,
      code: 'OCR_IMAGE_REQUIRED',
    });
  }

  if (!file.mimetype?.startsWith('image/')) {
    throw new ReceiptOcrProcessingError('receipt must be an image file', {
      status: 400,
      code: 'OCR_INVALID_FILE_TYPE',
    });
  }

  if (normalizedOverride) {
    return buildMockReceiptOcrResponse({
      file,
      rawText: normalizedOverride,
      mode: 'mock-upload',
      statusNote:
        'Legacy mock OCR path was used from rawText override and should not be treated as real receipt OCR.',
    });
  }

  if (!OCR_SERVICE_ENABLED) {
    if (!OCR_SERVICE_FALLBACK_TO_MOCK) {
      throw new ReceiptOcrProcessingError('Python OCR service is disabled', {
        status: 503,
        code: 'OCR_SERVICE_DISABLED',
        details: {
          ocrServiceBaseUrl: OCR_SERVICE_BASE_URL,
        },
      });
    }

    return buildMockReceiptOcrResponse({
      file,
      rawText: DEFAULT_MOCK_RECEIPT_TEXT,
      mode: 'mock-upload',
      statusNote: 'Legacy mock OCR fallback was used because OCR_SERVICE_ENABLED=false.',
    });
  }

  try {
    const pythonPayload = await requestPythonReceiptOcr({ file });

    if (pythonPayload?.success === false) {
      throw new ReceiptOcrProcessingError(
        pickFirstText(pythonPayload?.message, pythonPayload?.errorMessage) ||
          'Python OCR service reported failure',
        {
          status: 502,
          code:
            pickFirstText(
              pythonPayload?.errorCode,
              pythonPayload?.code,
              pythonPayload?.error?.code
            ) || 'OCR_SERVICE_UNAVAILABLE',
          details: pickFirstObject(
            pythonPayload?.error?.details,
            pythonPayload?.error,
            pythonPayload
          ),
          mode: trimText(pythonPayload?.mode) || 'python-paddleocr',
        }
      );
    }

    return buildPythonReceiptOcrResponse({
      file,
      payload: pythonPayload,
    });
  } catch (error) {
    if (!OCR_SERVICE_FALLBACK_TO_MOCK) {
      throw new ReceiptOcrProcessingError(
        error?.message || 'Python OCR service is unavailable',
        {
          status: error?.status || 503,
          code: error?.code || 'OCR_SERVICE_UNAVAILABLE',
          details: {
            ocrServiceBaseUrl: OCR_SERVICE_BASE_URL,
            upstreamPayload: error?.payload || null,
          },
          mode: 'python-paddleocr',
        }
      );
    }

    console.warn(
      '[ReceiptOCRRoute]',
      JSON.stringify({
        event: 'python_ocr_fallback_to_mock',
        message: error?.message || 'unknown_error',
        status: error?.status || null,
        code: error?.code || null,
      })
    );

    return buildMockReceiptOcrResponse({
      file,
      rawText: DEFAULT_MOCK_RECEIPT_TEXT,
      mode: 'mock-fallback',
      statusNote:
        'Legacy mock OCR fallback was used because the Python OCR service was unavailable.',
    });
  }
};

export const inspectReceiptOcrHealth = async () => {
  const downstream = await checkPythonOcrHealth();

  return {
    routeMounted: true,
    mountedBasePath: OCR_ROUTE_BASE_PATH,
    receiptPath: OCR_ROUTE_ABSOLUTE_PATHS.receipt,
    healthPath: OCR_ROUTE_ABSOLUTE_PATHS.health,
    ocrServiceBaseUrl: OCR_SERVICE_BASE_URL,
    ocrServiceEnabled: OCR_SERVICE_ENABLED,
    ocrServiceFallbackToMock: OCR_SERVICE_FALLBACK_TO_MOCK,
    downstream,
  };
};

export default processReceiptOcrRequest;
