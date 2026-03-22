export const OCR_ROUTE_BASE_PATH = '/api/ocr';

export const OCR_ROUTE_ENDPOINTS = Object.freeze({
  health: '/health',
  receipt: '/receipt',
});

export const OCR_ROUTE_ABSOLUTE_PATHS = Object.freeze({
  health: `${OCR_ROUTE_BASE_PATH}${OCR_ROUTE_ENDPOINTS.health}`,
  receipt: `${OCR_ROUTE_BASE_PATH}${OCR_ROUTE_ENDPOINTS.receipt}`,
});
