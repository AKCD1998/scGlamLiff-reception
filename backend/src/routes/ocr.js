import { Router } from 'express';
import {
  getReceiptOcrHealth,
  postReceiptOcr,
} from '../controllers/ocrController.js';
import receiptUploadMiddleware from '../middlewares/receiptUpload.js';
import {
  OCR_ROUTE_ENDPOINTS,
} from '../services/ocr/ocrRouteConfig.js';

const router = Router();

router.get(OCR_ROUTE_ENDPOINTS.health, getReceiptOcrHealth);
router.post(OCR_ROUTE_ENDPOINTS.receipt, receiptUploadMiddleware, postReceiptOcr);

export default router;
