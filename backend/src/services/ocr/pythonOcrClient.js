const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const parseBooleanEnv = (value, fallbackValue = false) => {
  if (typeof value !== 'string') {
    return fallbackValue;
  }

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallbackValue;
};

export const OCR_SERVICE_BASE_URL =
  trimTrailingSlash(process.env.OCR_SERVICE_BASE_URL) || 'http://127.0.0.1:8001';

export const OCR_SERVICE_ENABLED = parseBooleanEnv(process.env.OCR_SERVICE_ENABLED, true);

export const OCR_SERVICE_FALLBACK_TO_MOCK = parseBooleanEnv(
  process.env.OCR_SERVICE_FALLBACK_TO_MOCK,
  false
);

export const buildOcrServiceUrl = (path) =>
  `${OCR_SERVICE_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

const parseJsonSafely = async (response) => {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const requestPythonReceiptOcr = async ({ file }) => {
  const formData = new FormData();
  const blob = new Blob([file.buffer], {
    type: file.mimetype || 'application/octet-stream',
  });

  formData.append('receipt', blob, file.originalname || 'receipt-image');

  const endpoint = buildOcrServiceUrl('/ocr/receipt');
  let response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    });
  } catch (networkError) {
    const error = new Error(networkError?.message || 'Python OCR service is unavailable');
    error.status = 503;
    error.code = 'OCR_SERVICE_UNAVAILABLE';
    error.payload = null;
    throw error;
  }

  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    const detail =
      payload?.detail && typeof payload.detail === 'object'
        ? payload.detail
        : null;
    const error = new Error(
      detail?.message ||
        payload?.message ||
        payload?.errorMessage ||
        payload?.error?.message ||
        payload?.error ||
        `Python OCR service request failed: ${response.status}`
    );
    error.status = response.status;
    error.code =
      detail?.code ||
      payload?.errorCode ||
      payload?.code ||
      payload?.error?.code ||
      'OCR_SERVICE_UNAVAILABLE';
    error.payload = payload;
    throw error;
  }

  return payload || {};
};

export const checkPythonOcrHealth = async () => {
  const endpoint = buildOcrServiceUrl('/health');

  if (!OCR_SERVICE_ENABLED) {
    return {
      reachable: false,
      status: null,
      ok: false,
      code: 'OCR_SERVICE_DISABLED',
      message: 'Python OCR service is disabled',
      url: endpoint,
      payload: null,
    };
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 5000);

  let response;

  try {
    response = await fetch(endpoint, {
      method: 'GET',
      signal: abortController.signal,
    });
  } catch (networkError) {
    const isTimeout = networkError?.name === 'AbortError';

    return {
      reachable: false,
      status: null,
      ok: false,
      code: 'OCR_SERVICE_UNAVAILABLE',
      message: isTimeout
        ? 'Python OCR health check timed out'
        : networkError?.message || 'Python OCR service is unavailable',
      url: endpoint,
      payload: null,
    };
  } finally {
    clearTimeout(timeout);
  }

  const payload = await parseJsonSafely(response);

  return {
    reachable: response.ok,
    status: response.status,
    ok:
      response.ok &&
      payload?.ok !== false &&
      payload?.success !== false,
    code:
      response.ok
        ? ''
        : payload?.errorCode ||
          payload?.code ||
          payload?.error?.code ||
          'OCR_SERVICE_UNAVAILABLE',
    message:
      response.ok
        ? ''
        : payload?.message ||
          payload?.errorMessage ||
          payload?.error?.message ||
          `Python OCR health check failed: ${response.status}`,
    url: endpoint,
    payload,
  };
};

export default requestPythonReceiptOcr;
