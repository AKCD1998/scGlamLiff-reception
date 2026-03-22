import {
  buildReceiptOcrErrorPayload,
  inspectReceiptOcrHealth,
  processReceiptOcrRequest,
} from '../services/ocr/receiptOcrService.js';
import { OCR_ROUTE_ABSOLUTE_PATHS } from '../services/ocr/ocrRouteConfig.js';

const createRequestId = () => `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const postReceiptOcr = async (req, res) => {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const path = String(req.originalUrl || req.url || OCR_ROUTE_ABSOLUTE_PATHS.receipt);
  const hasRawTextOverride =
    typeof req.body?.rawText === 'string' && req.body.rawText.trim().length > 0;

  console.info(
    '[ReceiptOCRRoute]',
    JSON.stringify({
      event: 'request_started',
      requestId,
      method: String(req.method || 'POST').toUpperCase(),
      path,
      origin: req.headers?.origin || null,
      fileName: req.file?.originalname || '',
      fileType: req.file?.mimetype || '',
      fileSize: Number(req.file?.size) || 0,
      hasRawTextOverride,
    })
  );

  try {
    const result = await processReceiptOcrRequest({
      file: req.file,
      rawTextOverride: req.body?.rawText,
    });

    console.info(
      '[ReceiptOCRRoute]',
      JSON.stringify({
        event: 'request_succeeded',
        requestId,
        method: String(req.method || 'POST').toUpperCase(),
        path,
        durationMs: Date.now() - startedAt,
        code: result.code || null,
        mode: result.mode || null,
        ocrStatus: result.ocrStatus || null,
        success: result.success === true,
      })
    );

    res.json(result);
  } catch (error) {
    console.error(
      '[ReceiptOCRRoute]',
      JSON.stringify({
        event: 'request_failed',
        requestId,
        method: String(req.method || 'POST').toUpperCase(),
        path,
        durationMs: Date.now() - startedAt,
        status: error.status || 500,
        code: error.code || 'OCR_PROCESSING_FAILED',
        message: error.message || 'Failed to process receipt OCR',
      })
    );

    res
      .status(error.status || 500)
      .json(
        error.payload ||
          buildReceiptOcrErrorPayload({
            code: error.code || 'OCR_PROCESSING_FAILED',
            message: error.message || 'Failed to process receipt OCR',
          })
      );
  }
};

export const getReceiptOcrHealth = async (req, res) => {
  const requestId = createRequestId();
  const startedAt = Date.now();
  const path = String(req.originalUrl || req.url || OCR_ROUTE_ABSOLUTE_PATHS.health);

  console.info(
    '[ReceiptOCRRoute]',
    JSON.stringify({
      event: 'health_requested',
      requestId,
      method: String(req.method || 'GET').toUpperCase(),
      path,
      origin: req.headers?.origin || null,
    })
  );

  try {
    const health = await inspectReceiptOcrHealth();

    console.info(
      '[ReceiptOCRRoute]',
      JSON.stringify({
        event: 'health_succeeded',
        requestId,
        method: String(req.method || 'GET').toUpperCase(),
        path,
        durationMs: Date.now() - startedAt,
        downstreamReachable: Boolean(health?.downstream?.reachable),
        downstreamStatus: health?.downstream?.status ?? null,
      })
    );

    return res.json({ ok: true, data: health });
  } catch (error) {
    console.error(
      '[ReceiptOCRRoute]',
      JSON.stringify({
        event: 'health_failed',
        requestId,
        method: String(req.method || 'GET').toUpperCase(),
        path,
        durationMs: Date.now() - startedAt,
        message: error?.message || 'Failed to inspect OCR health',
      })
    );

    return res.status(500).json({
      ok: false,
      error: 'Server error',
      message: error?.message || 'Failed to inspect OCR health',
    });
  }
};

export default postReceiptOcr;
