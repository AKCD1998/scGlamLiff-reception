import crypto from 'node:crypto';

import { query } from '../db.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT_UPLOADS_TABLE = 'appointment_receipt_uploads';
const FALLBACK_BOOKING_REFERENCE_PREFIX = 'receipt-upload';

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

export const insertAppointmentReceiptUpload = async ({
  appointmentId,
  bookingReference,
  storedReceipt,
} = {}) => {
  const linkage = resolveReceiptUploadLinkage({
    appointmentId,
    bookingReference,
  });

  try {
    const result = await query(
      `
        INSERT INTO appointment_receipt_uploads (
          appointment_id,
          booking_reference,
          receipt_image_ref,
          original_filename,
          mime_type,
          file_size_bytes
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
          id,
          appointment_id,
          booking_reference,
          receipt_image_ref,
          original_filename,
          mime_type,
          file_size_bytes,
          uploaded_at,
          ocr_status,
          ocr_processed_at,
          ocr_error_message
      `,
      [
        linkage.appointmentId,
        linkage.bookingReference,
        storedReceipt.reference,
        storedReceipt.originalName,
        storedReceipt.mimeType,
        storedReceipt.size,
      ]
    );

    const insertedRow = mapReceiptUploadRow(result.rows[0] || null);

    console.info(
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
    console.error(
      '[ReceiptUploadPersistence]',
      JSON.stringify({
        event: 'receipt_upload_metadata_insert_failed',
        table: RECEIPT_UPLOADS_TABLE,
        appointmentId: linkage.appointmentId || null,
        bookingReference: linkage.bookingReference || null,
        generatedFallbackBookingReference:
          linkage.generatedFallbackBookingReference,
        receiptImageRef: storedReceipt?.reference || null,
        message: error?.message || 'Failed to persist receipt upload metadata',
        code: error?.code || null,
        detail: error?.detail || null,
        constraint: error?.constraint || null,
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
