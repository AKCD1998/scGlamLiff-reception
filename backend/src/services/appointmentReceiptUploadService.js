import crypto from 'node:crypto';

import { query } from '../db.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT_UPLOADS_TABLE = 'appointment_receipt_uploads';
const FALLBACK_BOOKING_REFERENCE_PREFIX = 'receipt-upload';
const RECEIPT_UPLOAD_INSERT_COLUMNS = Object.freeze([
  'id',
  'appointment_id',
  'booking_reference',
  'receipt_image_ref',
  'original_filename',
  'mime_type',
  'file_size_bytes',
]);
const RECEIPT_UPLOAD_RETURNING_COLUMNS = Object.freeze([
  'id',
  'appointment_id',
  'booking_reference',
  'receipt_image_ref',
  'original_filename',
  'mime_type',
  'file_size_bytes',
  'uploaded_at',
  'ocr_status',
  'ocr_processed_at',
  'ocr_error_message',
]);
const RECEIPT_UPLOAD_SCHEMA_STATEMENTS = Object.freeze([
  `
    CREATE TABLE IF NOT EXISTS public.appointment_receipt_uploads (
      id uuid PRIMARY KEY,
      appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE,
      booking_reference text,
      receipt_image_ref text NOT NULL,
      original_filename text NOT NULL,
      mime_type text NOT NULL,
      file_size_bytes bigint NOT NULL,
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      ocr_status text NOT NULL DEFAULT 'pending',
      ocr_processed_at timestamptz,
      ocr_error_message text,
      CONSTRAINT appointment_receipt_uploads_target_check
        CHECK (
          appointment_id IS NOT NULL
          OR NULLIF(BTRIM(COALESCE(booking_reference, '')), '') IS NOT NULL
        ),
      CONSTRAINT appointment_receipt_uploads_receipt_image_ref_check
        CHECK (NULLIF(BTRIM(receipt_image_ref), '') IS NOT NULL),
      CONSTRAINT appointment_receipt_uploads_original_filename_check
        CHECK (NULLIF(BTRIM(original_filename), '') IS NOT NULL),
      CONSTRAINT appointment_receipt_uploads_mime_type_check
        CHECK (NULLIF(BTRIM(mime_type), '') IS NOT NULL),
      CONSTRAINT appointment_receipt_uploads_file_size_bytes_check
        CHECK (file_size_bytes >= 0),
      CONSTRAINT appointment_receipt_uploads_ocr_status_check
        CHECK (
          LOWER(ocr_status) = ANY (
            ARRAY[
              'pending'::text,
              'processing'::text,
              'processed'::text,
              'failed'::text
            ]
          )
        ),
      CONSTRAINT appointment_receipt_uploads_ocr_processed_at_check
        CHECK (ocr_processed_at IS NULL OR ocr_processed_at >= uploaded_at)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_receipt_uploads_uploaded_at_idx
    ON public.appointment_receipt_uploads (uploaded_at DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_receipt_uploads_appointment_id_uploaded_at_idx
    ON public.appointment_receipt_uploads (appointment_id, uploaded_at DESC)
    WHERE appointment_id IS NOT NULL;
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_receipt_uploads_booking_reference_uploaded_at_idx
    ON public.appointment_receipt_uploads (booking_reference, uploaded_at DESC)
    WHERE booking_reference IS NOT NULL;
  `,
  `
    CREATE INDEX IF NOT EXISTS appointment_receipt_uploads_ocr_status_uploaded_at_idx
    ON public.appointment_receipt_uploads (ocr_status, uploaded_at DESC);
  `,
]);

let ensureReceiptUploadsSchemaPromise = null;

const normalizeText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const toNullableText = (value) => {
  const normalized = normalizeText(value);
  return normalized || null;
};

const mapReceiptUploadRow = (row) => {
  if (!row) return null;

  return {
    id: normalizeText(row.id),
    appointmentId: toNullableText(row.appointment_id),
    bookingReference: toNullableText(row.booking_reference),
    receiptImageRef: normalizeText(row.receipt_image_ref),
    originalFilename: normalizeText(row.original_filename),
    mimeType: normalizeText(row.mime_type),
    fileSizeBytes:
      row.file_size_bytes === null || row.file_size_bytes === undefined
        ? 0
        : Number(row.file_size_bytes),
    uploadedAt: row.uploaded_at || null,
    ocrStatus: normalizeText(row.ocr_status) || 'pending',
    ocrProcessedAt: row.ocr_processed_at || null,
    ocrErrorMessage: toNullableText(row.ocr_error_message),
  };
};

const buildFallbackBookingReference = () =>
  `${FALLBACK_BOOKING_REFERENCE_PREFIX}-${crypto.randomUUID()}`;

const createReceiptUploadId = () => crypto.randomUUID();

const normalizeAppointmentId = (value) => {
  const normalized = toNullableText(value);
  if (!normalized) return null;

  if (!UUID_PATTERN.test(normalized)) {
    const error = new Error('appointment_id must be a valid UUID');
    error.status = 400;
    error.code = 'INVALID_APPOINTMENT_ID';
    throw error;
  }

  return normalized;
};

export const resolveReceiptUploadLinkage = ({
  appointmentId,
  bookingReference,
} = {}) => {
  const normalizedAppointmentId = normalizeAppointmentId(appointmentId);
  const normalizedBookingReference = toNullableText(bookingReference);

  if (normalizedAppointmentId || normalizedBookingReference) {
    return {
      appointmentId: normalizedAppointmentId,
      bookingReference: normalizedBookingReference,
      generatedFallbackBookingReference: false,
    };
  }

  return {
    appointmentId: null,
    bookingReference: buildFallbackBookingReference(),
    generatedFallbackBookingReference: true,
  };
};

export const ensureAppointmentReceiptUploadsSchema = async ({
  queryFn = query,
  logger = console,
} = {}) => {
  for (const statement of RECEIPT_UPLOAD_SCHEMA_STATEMENTS) {
    await queryFn(statement);
  }

  logger?.info?.(
    '[ReceiptUploadPersistence]',
    JSON.stringify({
      event: 'receipt_upload_schema_ensured',
      table: RECEIPT_UPLOADS_TABLE,
      statementsApplied: RECEIPT_UPLOAD_SCHEMA_STATEMENTS.length,
    })
  );
};

export const ensureAppointmentReceiptUploadsSchemaOnce = async ({
  queryFn = query,
  logger = console,
} = {}) => {
  if (queryFn !== query) {
    return ensureAppointmentReceiptUploadsSchema({ queryFn, logger });
  }

  if (!ensureReceiptUploadsSchemaPromise) {
    ensureReceiptUploadsSchemaPromise = ensureAppointmentReceiptUploadsSchema({
      queryFn,
      logger,
    }).catch((error) => {
      ensureReceiptUploadsSchemaPromise = null;
      throw error;
    });
  }

  return ensureReceiptUploadsSchemaPromise;
};

export const resetReceiptUploadSchemaEnsureCacheForTests = () => {
  ensureReceiptUploadsSchemaPromise = null;
};

const buildInsertPayload = ({
  uploadId,
  linkage,
  storedReceipt,
}) => ({
  id: uploadId,
  appointment_id: linkage.appointmentId,
  booking_reference: linkage.bookingReference,
  receipt_image_ref: storedReceipt.reference,
  original_filename: storedReceipt.originalName,
  mime_type: storedReceipt.mimeType,
  file_size_bytes: storedReceipt.size,
});

export const insertAppointmentReceiptUpload = async ({
  appointmentId,
  bookingReference,
  storedReceipt,
  queryFn = query,
  logger = console,
  ensureSchema = ensureAppointmentReceiptUploadsSchemaOnce,
  createUploadId = createReceiptUploadId,
} = {}) => {
  const linkage = resolveReceiptUploadLinkage({
    appointmentId,
    bookingReference,
  });
  const uploadId = createUploadId();
  const insertPayload = buildInsertPayload({
    uploadId,
    linkage,
    storedReceipt,
  });

  try {
    await ensureSchema({ queryFn, logger });

    logger?.info?.(
      '[ReceiptUploadPersistence]',
      JSON.stringify({
        event: 'receipt_upload_metadata_insert_attempt',
        table: RECEIPT_UPLOADS_TABLE,
        insertColumns: RECEIPT_UPLOAD_INSERT_COLUMNS,
        insertPayload: {
          id: insertPayload.id,
          appointmentId: insertPayload.appointment_id,
          bookingReference: insertPayload.booking_reference,
          receiptImageRef: insertPayload.receipt_image_ref,
          originalFilename: insertPayload.original_filename,
          mimeType: insertPayload.mime_type,
          fileSizeBytes: insertPayload.file_size_bytes,
        },
        generatedFallbackBookingReference:
          linkage.generatedFallbackBookingReference,
      })
    );

    const result = await queryFn(
      `
        INSERT INTO appointment_receipt_uploads (
          ${RECEIPT_UPLOAD_INSERT_COLUMNS.join(',\n          ')}
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          ${RECEIPT_UPLOAD_RETURNING_COLUMNS.join(',\n          ')}
      `,
      [
        insertPayload.id,
        insertPayload.appointment_id,
        insertPayload.booking_reference,
        insertPayload.receipt_image_ref,
        insertPayload.original_filename,
        insertPayload.mime_type,
        insertPayload.file_size_bytes,
      ]
    );

    const insertedRow = mapReceiptUploadRow(result.rows[0] || null);

    logger?.info?.(
      '[ReceiptUploadPersistence]',
      JSON.stringify({
        event: 'receipt_upload_metadata_inserted',
        table: RECEIPT_UPLOADS_TABLE,
        uploadId: insertedRow?.id || null,
        appointmentId: insertedRow?.appointmentId || null,
        bookingReference: insertedRow?.bookingReference || null,
        generatedFallbackBookingReference:
          linkage.generatedFallbackBookingReference,
        receiptImageRef: insertedRow?.receiptImageRef || null,
        fileSizeBytes: insertedRow?.fileSizeBytes || 0,
        ocrStatus: insertedRow?.ocrStatus || 'pending',
      })
    );

    return insertedRow;
  } catch (error) {
    logger?.error?.(
      '[ReceiptUploadPersistence]',
      JSON.stringify({
        event: 'receipt_upload_metadata_insert_failed',
        table: RECEIPT_UPLOADS_TABLE,
        insertColumns: RECEIPT_UPLOAD_INSERT_COLUMNS,
        insertPayload: {
          id: insertPayload.id,
          appointmentId: insertPayload.appointment_id,
          bookingReference: insertPayload.booking_reference,
          receiptImageRef: insertPayload.receipt_image_ref,
          originalFilename: insertPayload.original_filename,
          mimeType: insertPayload.mime_type,
          fileSizeBytes: insertPayload.file_size_bytes,
        },
        appointmentId: linkage.appointmentId || null,
        bookingReference: linkage.bookingReference || null,
        generatedFallbackBookingReference:
          linkage.generatedFallbackBookingReference,
        receiptImageRef: storedReceipt?.reference || null,
        message: error?.message || 'Failed to persist receipt upload metadata',
        code: error?.code || null,
        detail: error?.detail || null,
        constraint: error?.constraint || null,
        tableName: error?.table || null,
        column: error?.column || null,
        where: error?.where || null,
      })
    );

    if (error?.status) {
      throw error;
    }

    const wrapped = new Error('Failed to persist receipt upload metadata');
    wrapped.status = 500;
    wrapped.code = 'RECEIPT_METADATA_PERSIST_FAILED';
    throw wrapped;
  }
};

export default insertAppointmentReceiptUpload;
