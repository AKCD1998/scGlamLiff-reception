import { mkdirSync, promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

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
const RECEIPT_UPLOAD_STORAGE_PROVIDER_LOCAL = 'persistent-disk';
const RECEIPT_UPLOAD_STORAGE_PROVIDER_R2 = 'cloudflare-r2';
const RECEIPT_UPLOAD_STATUS_DEFAULT = 'pending';
const RECEIPT_UPLOAD_MODE = 'receipt-upload-only';
const DEFAULT_STATUS_NOTE =
  'Receipt uploaded and stored successfully. OCR is not executed on this backend.';
const DEFAULT_RECEIPT_UPLOADS_DIR = path.resolve(
  process.cwd(),
  'storage',
  'receipt-uploads'
);
const LOCAL_RECEIPT_UPLOAD_STORAGE_KEY_PREFIX = 'receipt-uploads';
export const RECEIPT_UPLOAD_PUBLIC_PATH = '/api/internal/receipt-uploads';

const trimText = (value) => (typeof value === 'string' ? value.trim() : '');
const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');
const trimSlashes = (value) => String(value || '').replace(/^\/+|\/+$/g, '');
const sanitizeRelativePath = (value) => String(value || '').replace(/\\/g, '/');

const R2_BUCKET = trimText(process.env.R2_BUCKET);
const R2_ACCESS_KEY_ID = trimText(process.env.R2_ACCESS_KEY_ID);
const R2_SECRET_ACCESS_KEY = trimText(process.env.R2_SECRET_ACCESS_KEY);
const R2_ENDPOINT = trimTrailingSlash(process.env.R2_ENDPOINT);
const R2_KEY_PREFIX = trimSlashes(process.env.R2_KEY_PREFIX || 'receipts');
const R2_PUBLIC_BASE_URL = trimTrailingSlash(process.env.R2_PUBLIC_BASE_URL);

const HAS_ANY_R2_CONFIG = Boolean(
  R2_BUCKET || R2_ACCESS_KEY_ID || R2_SECRET_ACCESS_KEY || R2_ENDPOINT
);
const IS_R2_CONFIGURED = Boolean(
  R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ENDPOINT
);
export const RECEIPT_UPLOAD_STORAGE_BACKEND = IS_R2_CONFIGURED
  ? RECEIPT_UPLOAD_STORAGE_PROVIDER_R2
  : RECEIPT_UPLOAD_STORAGE_PROVIDER_LOCAL;

const resolveConfiguredStorageRoot = () => {
  const configuredRoot = trimText(process.env.RECEIPT_UPLOAD_STORAGE_DIR);

  if (!configuredRoot) {
    return DEFAULT_RECEIPT_UPLOADS_DIR;
  }

  return path.isAbsolute(configuredRoot)
    ? configuredRoot
    : path.resolve(process.cwd(), configuredRoot);
};

const normalizeResolvedPath = (value) => path.resolve(String(value || ''));
const hasSameResolvedPath = (left, right) =>
  normalizeResolvedPath(left) === normalizeResolvedPath(right);

const ensureLocalStorageDirectory = (directoryPath) => {
  mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
};

export function resolveActiveLocalReceiptStorageRoot({
  configuredRoot,
  defaultRoot = DEFAULT_RECEIPT_UPLOADS_DIR,
  ensureWritableDirectory = ensureLocalStorageDirectory,
  logger = console,
} = {}) {
  const candidateRoot = trimText(configuredRoot) || defaultRoot;
  const fallbackRoot = trimText(defaultRoot) || DEFAULT_RECEIPT_UPLOADS_DIR;

  try {
    ensureWritableDirectory(candidateRoot);
    return candidateRoot;
  } catch (error) {
    const canFallback = !hasSameResolvedPath(candidateRoot, fallbackRoot);

    logger?.warn?.(
      '[ReceiptUploadStorage]',
      JSON.stringify({
        event: 'local_storage_root_unavailable',
        configuredRoot: candidateRoot,
        fallbackRoot: canFallback ? fallbackRoot : null,
        message: error?.message || 'Failed to prepare local receipt storage root',
        code: error?.code || null,
      })
    );

    if (!canFallback) {
      return candidateRoot;
    }

    try {
      ensureWritableDirectory(fallbackRoot);

      logger?.warn?.(
        '[ReceiptUploadStorage]',
        JSON.stringify({
          event: 'local_storage_root_fallback_selected',
          configuredRoot: candidateRoot,
          activeRoot: fallbackRoot,
        })
      );

      return fallbackRoot;
    } catch (fallbackError) {
      logger?.error?.(
        '[ReceiptUploadStorage]',
        JSON.stringify({
          event: 'local_storage_root_fallback_failed',
          configuredRoot: candidateRoot,
          fallbackRoot,
          message:
            fallbackError?.message || 'Failed to prepare fallback local receipt storage root',
          code: fallbackError?.code || null,
        })
      );

      return candidateRoot;
    }
  }
}

const CONFIGURED_RECEIPT_UPLOAD_STORAGE_ROOT = IS_R2_CONFIGURED
  ? null
  : resolveConfiguredStorageRoot();
export const RECEIPT_UPLOAD_STORAGE_ROOT = IS_R2_CONFIGURED
  ? null
  : resolveActiveLocalReceiptStorageRoot({
      configuredRoot: CONFIGURED_RECEIPT_UPLOAD_STORAGE_ROOT,
      defaultRoot: DEFAULT_RECEIPT_UPLOADS_DIR,
    });
export const RECEIPT_UPLOAD_CONFIGURED_STORAGE_ROOT =
  CONFIGURED_RECEIPT_UPLOAD_STORAGE_ROOT;
export const RECEIPT_UPLOAD_STORAGE_ROOT_FALLBACK_ACTIVE =
  !IS_R2_CONFIGURED &&
  Boolean(CONFIGURED_RECEIPT_UPLOAD_STORAGE_ROOT) &&
  !hasSameResolvedPath(
    CONFIGURED_RECEIPT_UPLOAD_STORAGE_ROOT,
    RECEIPT_UPLOAD_STORAGE_ROOT
  );
export const RECEIPT_UPLOAD_PUBLIC_BASE_URL = IS_R2_CONFIGURED
  ? R2_PUBLIC_BASE_URL
  : trimTrailingSlash(process.env.RECEIPT_UPLOAD_PUBLIC_BASE_URL || RECEIPT_UPLOAD_PUBLIC_PATH);

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

const buildStorageKey = (relativePath, keyPrefix) => {
  const normalizedRelativePath = sanitizeRelativePath(relativePath);
  const normalizedKeyPrefix = trimSlashes(keyPrefix);
  return normalizedKeyPrefix
    ? `${normalizedKeyPrefix}/${normalizedRelativePath}`
    : normalizedRelativePath;
};

const buildStorageReference = ({
  relativePath,
  provider = RECEIPT_UPLOAD_STORAGE_BACKEND,
}) => {
  if (provider === RECEIPT_UPLOAD_STORAGE_PROVIDER_R2) {
    const storageKey = buildStorageKey(relativePath, R2_KEY_PREFIX);

    if (R2_PUBLIC_BASE_URL) {
      return `${R2_PUBLIC_BASE_URL}/${storageKey}`;
    }

    return `r2://${R2_BUCKET}/${storageKey}`;
  }

  const storageKey = buildStorageKey(
    relativePath,
    LOCAL_RECEIPT_UPLOAD_STORAGE_KEY_PREFIX
  );

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

let r2Client = null;

const getR2Client = () => {
  if (!IS_R2_CONFIGURED) {
    return null;
  }

  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }

  return r2Client;
};

const assertReceiptStorageConfig = () => {
  if (!HAS_ANY_R2_CONFIG || IS_R2_CONFIGURED) {
    return;
  }

  throw new ReceiptOcrProcessingError('Receipt storage is partially configured for R2', {
    status: 500,
    code: 'RECEIPT_STORAGE_CONFIG_INVALID',
    details: {
      storageProvider: RECEIPT_UPLOAD_STORAGE_PROVIDER_R2,
      r2BucketConfigured: Boolean(R2_BUCKET),
      r2AccessKeyConfigured: Boolean(R2_ACCESS_KEY_ID),
      r2SecretConfigured: Boolean(R2_SECRET_ACCESS_KEY),
      r2EndpointConfigured: Boolean(R2_ENDPOINT),
    },
  });
};

const storeReceiptUploadToR2 = async ({ file, relativePath, storedFileName, now }) => {
  const storageKey = buildStorageKey(relativePath, R2_KEY_PREFIX);

  console.info(
    '[ReceiptUploadStorage]',
    JSON.stringify({
      event: 'r2_upload_started',
      provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_R2,
      bucket: R2_BUCKET,
      key: storageKey,
      fileName: file.originalname || '',
      fileType: file.mimetype || '',
      fileSizeBytes: Number(file.size) || 0,
    })
  );

  try {
    await getR2Client().send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: storageKey,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
      })
    );
  } catch (error) {
    console.error(
      '[ReceiptUploadStorage]',
      JSON.stringify({
        event: 'r2_upload_failed',
        provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_R2,
        bucket: R2_BUCKET,
        key: storageKey,
        message: error?.message || 'Failed to upload receipt image to R2',
        code: error?.code || null,
        name: error?.name || null,
      })
    );

    throw new ReceiptOcrProcessingError(
      error?.message || 'Failed to upload receipt image to object storage',
      {
        status: 500,
        code: 'RECEIPT_STORAGE_FAILED',
        details: {
          storageProvider: RECEIPT_UPLOAD_STORAGE_PROVIDER_R2,
          bucket: R2_BUCKET,
          key: storageKey,
        },
      }
    );
  }

  const reference = buildStorageReference({
    relativePath,
    provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_R2,
  });

  console.info(
    '[ReceiptUploadStorage]',
    JSON.stringify({
      event: 'r2_upload_succeeded',
      provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_R2,
      bucket: R2_BUCKET,
      key: storageKey,
      reference,
      fileSizeBytes: Number(file.size) || 0,
    })
  );

  return {
    provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_R2,
    reference,
    key: storageKey,
    relativePath: sanitizeRelativePath(relativePath),
    storedFileName,
    publicUrl: R2_PUBLIC_BASE_URL ? `${R2_PUBLIC_BASE_URL}/${storageKey}` : '',
    mimeType: file.mimetype || '',
    originalName: file.originalname || '',
    size: Number(file.size) || 0,
    storedAt: now.toISOString(),
    bucket: R2_BUCKET,
    endpoint: R2_ENDPOINT,
  };
};

const storeReceiptUploadToLocalDisk = async ({
  file,
  relativePath,
  storedFileName,
  now,
}) => {
  const storageDirectory = path.join(RECEIPT_UPLOAD_STORAGE_ROOT, ...relativePath.split('/').slice(0, -1));
  const absolutePath = path.join(RECEIPT_UPLOAD_STORAGE_ROOT, ...relativePath.split('/'));

  console.info(
    '[ReceiptUploadStorage]',
    JSON.stringify({
      event: 'local_storage_write_started',
      provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_LOCAL,
      storageRoot: RECEIPT_UPLOAD_STORAGE_ROOT,
      absolutePath,
      fileName: file.originalname || '',
      fileType: file.mimetype || '',
      fileSizeBytes: Number(file.size) || 0,
    })
  );

  try {
    await fs.mkdir(storageDirectory, { recursive: true });
    await fs.writeFile(absolutePath, file.buffer);
  } catch (error) {
    console.error(
      '[ReceiptUploadStorage]',
      JSON.stringify({
        event: 'local_storage_write_failed',
        provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_LOCAL,
        storageRoot: RECEIPT_UPLOAD_STORAGE_ROOT,
        absolutePath,
        message: error?.message || 'Failed to store receipt upload',
        code: error?.code || null,
      })
    );

    throw new ReceiptOcrProcessingError(
      error?.message || 'Failed to store receipt upload',
      {
        status: 500,
        code: 'RECEIPT_STORAGE_FAILED',
        details: {
          storageProvider: RECEIPT_UPLOAD_STORAGE_PROVIDER_LOCAL,
        },
      }
    );
  }

  const reference = buildStorageReference({
    relativePath,
    provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_LOCAL,
  });

  console.info(
    '[ReceiptUploadStorage]',
    JSON.stringify({
      event: 'local_storage_write_succeeded',
      provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_LOCAL,
      storageRoot: RECEIPT_UPLOAD_STORAGE_ROOT,
      absolutePath,
      reference,
      fileSizeBytes: Number(file.size) || 0,
    })
  );

  return {
    provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_LOCAL,
    reference,
    key: buildStorageKey(relativePath, LOCAL_RECEIPT_UPLOAD_STORAGE_KEY_PREFIX),
    relativePath: sanitizeRelativePath(relativePath),
    storedFileName,
    publicUrl: RECEIPT_UPLOAD_PUBLIC_BASE_URL
      ? buildStorageReference({
          relativePath,
          provider: RECEIPT_UPLOAD_STORAGE_PROVIDER_LOCAL,
        })
      : '',
    mimeType: file.mimetype || '',
    originalName: file.originalname || '',
    size: Number(file.size) || 0,
    storedAt: now.toISOString(),
  };
};

const storeReceiptUpload = async (file) => {
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new ReceiptOcrProcessingError('receipt image is empty', {
      status: 400,
      code: 'OCR_EMPTY_FILE',
    });
  }

  assertReceiptStorageConfig();

  const now = new Date();
  const partitions = [
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ];
  const fileExtension = getSafeFileExtension(file);
  const storedFileName = `${crypto.randomUUID()}${fileExtension}`;
  const relativePath = path.posix.join(...partitions, storedFileName);

  if (IS_R2_CONFIGURED) {
    return storeReceiptUploadToR2({
      file,
      relativePath,
      storedFileName,
      now,
    });
  }

  return storeReceiptUploadToLocalDisk({
    file,
    relativePath,
    storedFileName,
    now,
  });
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
  storageProvider: RECEIPT_UPLOAD_STORAGE_BACKEND,
  configuredStorageRoot: RECEIPT_UPLOAD_CONFIGURED_STORAGE_ROOT,
  storageRoot: RECEIPT_UPLOAD_STORAGE_ROOT,
  storageRootFallbackActive: RECEIPT_UPLOAD_STORAGE_ROOT_FALLBACK_ACTIVE,
  storagePublicBaseUrl: RECEIPT_UPLOAD_PUBLIC_BASE_URL || null,
  r2Configured: IS_R2_CONFIGURED,
  r2Bucket: R2_BUCKET || null,
  r2Endpoint: R2_ENDPOINT || null,
  r2KeyPrefix: R2_KEY_PREFIX || null,
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
