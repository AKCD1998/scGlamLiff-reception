import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { insertAppointmentReceiptUpload } from '../appointmentReceiptUploadService.js';
import {
  OCR_ROUTE_ABSOLUTE_PATHS,
  OCR_ROUTE_BASE_PATH,
} from './ocrRouteConfig.js';

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

const MAX_RECEIPT_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const RECEIPT_UPLOAD_STORAGE_PROVIDER = 'persistent-disk';
const RECEIPT_UPLOAD_STATUS_DEFAULT = 'pending';
const RECEIPT_UPLOAD_MODE = 'receipt-upload-only';
const DEFAULT_STATUS_NOTE =
  'Receipt uploaded and stored successfully. OCR is not executed on this backend.';
const DEFAULT_RECEIPT_UPLOADS_DIR = path.resolve(
  process.cwd(),
  'storage',
  'receipt-uploads'
);
const RECEIPT_UPLOAD_STORAGE_KEY_PREFIX = 'receipt-uploads';
export const RECEIPT_UPLOAD_PUBLIC_PATH = '/api/internal/receipt-uploads';

const trimText = (value) => (typeof value === 'string' ? value.trim() : '');
const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const resolveStorageRoot = () => {
  const configuredRoot = trimText(process.env.RECEIPT_UPLOAD_STORAGE_DIR);

  if (!configuredRoot) {
    return DEFAULT_RECEIPT_UPLOADS_DIR;
  }

  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.resolve(process.cwd(), configuredRoot);
};

const RECEIPT_UPLOAD_STORAGE_ROOT = resolveStorageRoot();
export const RECEIPT_UPLOAD_PUBLIC_BASE_URL = trimTrailingSlash(
  process.env.RECEIPT_UPLOAD_PUBLIC_BASE_URL || RECEIPT_UPLOAD_PUBLIC_PATH
);

const buildFileMetadata = (file) => ({
  originalName: file.originalname || '',
  mimeType: file.mimetype || '',
  size: Number(file.size) || 0,
});

const buildReceiptOcrEmptyPayload = () => ({
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
  rawText: '',
  ocrText: '',
});

const sanitizeRelativePath = (value) => String(value || '').replace(/\\/g, '/');

const getSafeFileExtension = (file) => {
  const originalExtension = trimText(path.extname(file.originalname || '')).toLowerCase();
  if (/^\.[a-z0-9]+$/.test(originalExtension)) {
    return originalExtension;
  }

  switch (String(file.mimetype || '').toLowerCase()) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/heic':
      return '.heic';
    case 'image/heif':
      return '.heif';
    case 'image/gif':
      return '.gif';
    case 'image/bmp':
      return '.bmp';
    case 'image/tiff':
      return '.tiff';
    default:
      return '.bin';
  }
};

const buildStorageKey = (relativePath) =>
  `${RECEIPT_UPLOAD_STORAGE_KEY_PREFIX}/${sanitizeRelativePath(relativePath)}`;

const buildStorageReference = (relativePath) => {
  const storageKey = buildStorageKey(relativePath);

  if (RECEIPT_UPLOAD_PUBLIC_BASE_URL) {
    return `${RECEIPT_UPLOAD_PUBLIC_BASE_URL}/${sanitizeRelativePath(relativePath)}`;
  }

  return `disk://${storageKey}`;
};

export const buildReceiptOcrErrorPayload = ({
  code = 'OCR_PROCESSING_FAILED',
  message = 'Failed to upload receipt image',
  mode = RECEIPT_UPLOAD_MODE,
  details = null,
} = {}) => ({
  success: false,
  code,
  message,
  errorCode: code,
  errorMessage: message,
  ocrStatus: 'error',
  mode,
  ...buildReceiptOcrEmptyPayload(),
  receiptImageRef: '',
  ocrMetadata: {},
  statusNote: '',
  error: {
    code,
    message,
    ...(details ? { details } : {}),
  },
});

const buildReceiptUploadSuccessResponse = ({
  file,
  storedReceipt,
  persistedUpload,
  statusNote = DEFAULT_STATUS_NOTE,
}) => ({
  success: true,
  code: 'RECEIPT_UPLOAD_ACCEPTED',
  message: 'Receipt uploaded successfully',
  errorCode: '',
  errorMessage: '',
  ocrStatus: RECEIPT_UPLOAD_STATUS_DEFAULT,
  mode: RECEIPT_UPLOAD_MODE,
  file: buildFileMetadata(file),
  ...buildReceiptOcrEmptyPayload(),
  receiptImageRef: storedReceipt.reference,
  ocrMetadata: {
    storage: storedReceipt,
    uploadRecord: persistedUpload || null,
  },
  statusNote,
  error: null,
});

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
    this.mode = mode || RECEIPT_UPLOAD_MODE;
    this.payload = buildReceiptOcrErrorPayload({
      code,
      message,
      mode: this.mode,
      details,
    });
  }
}

const storeReceiptUpload = async (file) => {
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new ReceiptOcrProcessingError('receipt image is empty', {
      status: 400,
      code: 'OCR_EMPTY_FILE',
    });
  }

  const now = new Date();
  const partitions = [
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ];
  const storageDirectory = path.join(RECEIPT_UPLOAD_STORAGE_ROOT, ...partitions);
  const fileExtension = getSafeFileExtension(file);
  const storedFileName = `${crypto.randomUUID()}${fileExtension}`;
  const absolutePath = path.join(storageDirectory, storedFileName);
  const relativePath = path.posix.join(...partitions, storedFileName);

  try {
    await fs.mkdir(storageDirectory, { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);
  } catch (error) {
    throw new ReceiptOcrProcessingError(
      error?.message || 'Failed to store receipt upload',
      {
        status: 500,
        code: 'RECEIPT_STORAGE_FAILED',
        details: {
          storageProvider: RECEIPT_UPLOAD_STORAGE_PROVIDER,
        },
      }
    );
  }

  return {
    provider: RECEIPT_UPLOAD_STORAGE_PROVIDER,
    reference: buildStorageReference(relativePath),
    key: buildStorageKey(relativePath),
    relativePath: sanitizeRelativePath(relativePath),
    storedFileName,
    publicUrl: RECEIPT_UPLOAD_PUBLIC_BASE_URL
      ? buildStorageReference(relativePath)
      : '',
    mimeType: file.mimetype || '',
    originalName: file.originalname || '',
    size: Number(file.size) || 0,
    storedAt: now.toISOString(),
  };
};

export const processReceiptOcrRequest = async ({
  file,
  appointmentId,
  bookingReference,
}) => {
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

  const storedReceipt = await storeReceiptUpload(file);
  const persistedUpload = await insertAppointmentReceiptUpload({
    appointmentId,
    bookingReference,
    storedReceipt,
  });

  return buildReceiptUploadSuccessResponse({
    file,
    storedReceipt,
    persistedUpload,
  });
};

export const inspectReceiptOcrHealth = async () => ({
  routeMounted: true,
  mountedBasePath: OCR_ROUTE_BASE_PATH,
  receiptPath: OCR_ROUTE_ABSOLUTE_PATHS.receipt,
  healthPath: OCR_ROUTE_ABSOLUTE_PATHS.health,
  mode: RECEIPT_UPLOAD_MODE,
  ocrStatusDefault: RECEIPT_UPLOAD_STATUS_DEFAULT,
  storageProvider: RECEIPT_UPLOAD_STORAGE_PROVIDER,
  storageRoot: RECEIPT_UPLOAD_STORAGE_ROOT,
  storagePublicBaseUrl: RECEIPT_UPLOAD_PUBLIC_BASE_URL || null,
  uploadField: 'receipt',
  uploadMaxFileSizeBytes: MAX_RECEIPT_FILE_SIZE_BYTES,
  acceptedMimePrefix: 'image/',
  metadataPersistenceTable: 'appointment_receipt_uploads',
  ocrServiceEnabled: false,
  ocrServiceFallbackToMock: false,
  downstreamBaseUrl: null,
  downstreamHealthUrl: null,
  downstreamReceiptUrl: null,
  downstreamReachable: false,
  downstreamReceiptRouteReachable: false,
  downstream: {
    reachable: false,
    status: null,
    ok: false,
    code: 'OCR_DISABLED',
    message: 'Receipt upload route is running without OCR service integration',
    url: null,
    payload: null,
  },
  downstreamReceiptRoute: {
    reachable: false,
    status: null,
    ok: false,
    code: 'OCR_DISABLED',
    message: 'Receipt upload route is running without OCR service integration',
    url: null,
    payload: null,
  },
});

export default processReceiptOcrRequest;
