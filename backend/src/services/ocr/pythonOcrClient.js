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

export const OCR_DOWNSTREAM_PATHS = Object.freeze({
  health: '/health',
  receipt: '/ocr/receipt',
});

export const buildOcrServiceUrl = (path) =>
  `${OCR_SERVICE_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

export const getOcrDownstreamTargets = () => ({
  baseUrl: OCR_SERVICE_BASE_URL,
  healthPath: OCR_DOWNSTREAM_PATHS.health,
  receiptPath: OCR_DOWNSTREAM_PATHS.receipt,
  healthUrl: buildOcrServiceUrl(OCR_DOWNSTREAM_PATHS.health),
  receiptUrl: buildOcrServiceUrl(OCR_DOWNSTREAM_PATHS.receipt),
});

const logOcrBridge = (level, event, details = {}) => {
  const logger =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;

  logger(
    '[ReceiptOCRBridge]',
    JSON.stringify({
      event,
      ...details,
    })
  );
};

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

  const downstreamTargets = getOcrDownstreamTargets();
  const endpoint = downstreamTargets.receiptUrl;
  let response;

  logOcrBridge('info', 'downstream_request_started', {
    method: 'POST',
    targetPath: downstreamTargets.receiptPath,
    targetUrl: endpoint,
    ocrServiceBaseUrl: downstreamTargets.baseUrl,
    fileName: file.originalname || '',
    fileType: file.mimetype || '',
    fileSize: Number(file.size) || 0,
  });

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    });
  } catch (networkError) {
    logOcrBridge('warn', 'downstream_request_failed', {
      method: 'POST',
      targetPath: downstreamTargets.receiptPath,
      targetUrl: endpoint,
      ocrServiceBaseUrl: downstreamTargets.baseUrl,
      message: networkError?.message || 'Python OCR service is unavailable',
    });

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
    const upstreamRouteMissing = response.status === 404 || response.status === 405;
    const error = new Error(
      detail?.message ||
        payload?.message ||
        payload?.errorMessage ||
        payload?.error?.message ||
        payload?.error ||
        (upstreamRouteMissing
          ? `Python OCR receipt route is not available: ${response.status}`
          : `Python OCR service request failed: ${response.status}`)
    );
    error.status = upstreamRouteMissing ? 503 : response.status;
    error.code =
      detail?.code ||
      payload?.errorCode ||
      payload?.code ||
      payload?.error?.code ||
      (upstreamRouteMissing
        ? 'OCR_DOWNSTREAM_ROUTE_NOT_FOUND'
        : 'OCR_SERVICE_UNAVAILABLE');
    error.payload = payload;

    logOcrBridge('warn', 'downstream_request_rejected', {
      method: 'POST',
      targetPath: downstreamTargets.receiptPath,
      targetUrl: endpoint,
      ocrServiceBaseUrl: downstreamTargets.baseUrl,
      status: response.status,
      code: error.code,
      message: error.message,
    });

    throw error;
  }

  logOcrBridge('info', 'downstream_request_succeeded', {
    method: 'POST',
    targetPath: downstreamTargets.receiptPath,
    targetUrl: endpoint,
    ocrServiceBaseUrl: downstreamTargets.baseUrl,
    status: response.status,
  });

  return payload || {};
};

export const checkPythonOcrHealth = async () => {
  const downstreamTargets = getOcrDownstreamTargets();
  const endpoint = downstreamTargets.healthUrl;

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

  logOcrBridge('info', 'downstream_health_probe_started', {
    method: 'GET',
    targetPath: downstreamTargets.healthPath,
    targetUrl: endpoint,
    ocrServiceBaseUrl: downstreamTargets.baseUrl,
  });

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
    const result = {
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

    logOcrBridge('warn', 'downstream_health_probe_failed', {
      method: 'GET',
      targetPath: downstreamTargets.healthPath,
      targetUrl: endpoint,
      ocrServiceBaseUrl: downstreamTargets.baseUrl,
      code: result.code,
      message: result.message,
    });

    return result;
  } finally {
    clearTimeout(timeout);
  }

  const payload = await parseJsonSafely(response);

  const result = {
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

  logOcrBridge(response.ok ? 'info' : 'warn', 'downstream_health_probe_finished', {
    method: 'GET',
    targetPath: downstreamTargets.healthPath,
    targetUrl: endpoint,
    ocrServiceBaseUrl: downstreamTargets.baseUrl,
    status: result.status,
    reachable: result.reachable,
    code: result.code,
    message: result.message,
  });

  return result;
};

export const checkPythonOcrReceiptRoute = async () => {
  const downstreamTargets = getOcrDownstreamTargets();
  const endpoint = downstreamTargets.receiptUrl;

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

  logOcrBridge('info', 'downstream_receipt_probe_started', {
    method: 'POST',
    targetPath: downstreamTargets.receiptPath,
    targetUrl: endpoint,
    ocrServiceBaseUrl: downstreamTargets.baseUrl,
  });

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 5000);
  const formData = new FormData();

  let response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
      signal: abortController.signal,
    });
  } catch (networkError) {
    const isTimeout = networkError?.name === 'AbortError';
    const result = {
      reachable: false,
      status: null,
      ok: false,
      code: 'OCR_SERVICE_UNAVAILABLE',
      message: isTimeout
        ? 'Python OCR receipt route probe timed out'
        : networkError?.message || 'Python OCR receipt route is unavailable',
      url: endpoint,
      payload: null,
    };

    logOcrBridge('warn', 'downstream_receipt_probe_failed', {
      method: 'POST',
      targetPath: downstreamTargets.receiptPath,
      targetUrl: endpoint,
      ocrServiceBaseUrl: downstreamTargets.baseUrl,
      code: result.code,
      message: result.message,
    });

    return result;
  } finally {
    clearTimeout(timeout);
  }

  const payload = await parseJsonSafely(response);
  const upstreamRouteMissing = response.status === 404 || response.status === 405;

  const result = {
    reachable: !upstreamRouteMissing,
    status: response.status,
    ok: !upstreamRouteMissing,
    code:
      upstreamRouteMissing
        ? 'OCR_DOWNSTREAM_ROUTE_NOT_FOUND'
        : response.ok
          ? ''
          : payload?.errorCode ||
            payload?.code ||
            payload?.error?.code ||
            '',
    message:
      upstreamRouteMissing
        ? `Python OCR receipt route is not available: ${response.status}`
        : response.ok
          ? ''
          : payload?.message ||
            payload?.errorMessage ||
            payload?.error?.message ||
            '',
    url: endpoint,
    payload,
  };

  logOcrBridge(result.ok ? 'info' : 'warn', 'downstream_receipt_probe_finished', {
    method: 'POST',
    targetPath: downstreamTargets.receiptPath,
    targetUrl: endpoint,
    ocrServiceBaseUrl: downstreamTargets.baseUrl,
    status: result.status,
    reachable: result.reachable,
    code: result.code,
    message: result.message,
  });

  return result;
};

export default requestPythonReceiptOcr;
