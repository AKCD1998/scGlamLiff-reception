import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://codex:codex@127.0.0.1:5432/codex_test';
process.env.PGSSLMODE ||= 'disable';

const receiptUploadServiceModule = await import('./appointmentReceiptUploadService.js');
const {
  ensureAppointmentReceiptUploadsSchema,
  insertAppointmentReceiptUpload,
  resolveReceiptUploadLinkage,
} = receiptUploadServiceModule;

test('resolveReceiptUploadLinkage generates a fallback booking reference when neither identifier is provided', () => {
  const linkage = resolveReceiptUploadLinkage();

  assert.equal(linkage.appointmentId, null);
  assert.equal(typeof linkage.bookingReference, 'string');
  assert.match(linkage.bookingReference, /^receipt-upload-/);
  assert.equal(linkage.generatedFallbackBookingReference, true);
});

test('insertAppointmentReceiptUpload persists metadata with an explicit upload id and preserves response shape', async () => {
  const calls = [];
  const logger = {
    info() {},
    error() {},
  };
  const fakeQuery = async (sql, params) => {
    calls.push({ sql, params });

    if (!params) {
      return { rows: [] };
    }

    return {
      rows: [
        {
          id: params[0],
          appointment_id: params[1],
          booking_reference: params[2],
          receipt_image_ref: params[3],
          original_filename: params[4],
          mime_type: params[5],
          file_size_bytes: params[6],
          uploaded_at: '2026-03-25T01:42:00.000Z',
          ocr_status: 'pending',
          ocr_processed_at: null,
          ocr_error_message: null,
        },
      ],
    };
  };

  const result = await insertAppointmentReceiptUpload({
    appointmentId: null,
    bookingReference: '',
    storedReceipt: {
      reference: '/api/internal/receipt-uploads/2026/03/25/example.jpg',
      originalName: 'image.jpg',
      mimeType: 'image/jpeg',
      size: 2562233,
    },
    queryFn: fakeQuery,
    logger,
    createUploadId: () => '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(calls.length, 6);
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS public\.appointment_receipt_uploads/i);
  assert.match(calls.at(-1).sql, /INSERT INTO appointment_receipt_uploads/i);
  assert.deepEqual(calls.at(-1).params, [
    '11111111-1111-4111-8111-111111111111',
    null,
    result.bookingReference,
    '/api/internal/receipt-uploads/2026/03/25/example.jpg',
    'image.jpg',
    'image/jpeg',
    2562233,
  ]);
  assert.deepEqual(result, {
    id: '11111111-1111-4111-8111-111111111111',
    appointmentId: null,
    bookingReference: result.bookingReference,
    receiptImageRef: '/api/internal/receipt-uploads/2026/03/25/example.jpg',
    originalFilename: 'image.jpg',
    mimeType: 'image/jpeg',
    fileSizeBytes: 2562233,
    uploadedAt: '2026-03-25T01:42:00.000Z',
    ocrStatus: 'pending',
    ocrProcessedAt: null,
    ocrErrorMessage: null,
  });
  assert.match(result.bookingReference, /^receipt-upload-/);
});

test('insertAppointmentReceiptUpload rejects non-UUID appointment ids before touching the database', async () => {
  const fakeQuery = async () => {
    throw new Error('query should not run');
  };

  await assert.rejects(
    () =>
      insertAppointmentReceiptUpload({
        appointmentId: 'not-a-uuid',
        bookingReference: '',
        storedReceipt: {
          reference: '/api/internal/receipt-uploads/example.jpg',
          originalName: 'image.jpg',
          mimeType: 'image/jpeg',
          size: 123,
        },
        queryFn: fakeQuery,
        logger: {
          info() {},
          error() {},
        },
      }),
    (error) => {
      assert.equal(error?.status, 400);
      assert.equal(error?.code, 'INVALID_APPOINTMENT_ID');
      return true;
    }
  );
});

test('ensureAppointmentReceiptUploadsSchema runs the expected idempotent DDL statements', async () => {
  const statements = [];

  await ensureAppointmentReceiptUploadsSchema({
    queryFn: async (sql) => {
      statements.push(sql);
      return { rows: [] };
    },
    logger: {
      info() {},
      error() {},
    },
  });

  assert.equal(statements.length, 5);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS public\.appointment_receipt_uploads/i);
  assert.match(statements[1], /CREATE INDEX IF NOT EXISTS appointment_receipt_uploads_uploaded_at_idx/i);
  assert.match(statements[4], /CREATE INDEX IF NOT EXISTS appointment_receipt_uploads_ocr_status_uploaded_at_idx/i);
});
