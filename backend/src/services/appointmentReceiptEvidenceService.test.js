import test from 'node:test';
import assert from 'node:assert/strict';

import {
  insertAppointmentReceiptEvidence,
  resetAppointmentReceiptsSchemaEnsureCacheForTests,
} from './appointmentReceiptEvidenceService.js';

test.beforeEach(() => {
  resetAppointmentReceiptsSchemaEnsureCacheForTests();
});

test('insertAppointmentReceiptEvidence ensures schema and persists the expected receipt fields', async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });

      if (!params) {
        return { rows: [] };
      }

      return {
        rows: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            appointment_id: params[0],
            receipt_image_ref: params[1],
            receipt_number: params[2],
            receipt_line: params[3],
            receipt_identifier: params[4],
            total_amount_thb: params[5],
            ocr_status: params[6],
            ocr_raw_text: params[7],
            ocr_metadata: params[8] ? JSON.parse(params[8]) : null,
            verification_source: params[9],
            verification_metadata: params[10] ? JSON.parse(params[10]) : null,
            created_at: '2026-03-25T03:20:00.000Z',
            updated_at: '2026-03-25T03:20:00.000Z',
          },
        ],
      };
    },
  };

  const result = await insertAppointmentReceiptEvidence(client, {
    appointmentId: '11111111-1111-4111-8111-111111111111',
    receiptEvidence: {
      receipt_image_ref: '/api/internal/receipt-uploads/example.jpg',
      receipt_number: 'RCP-20260325-0001',
      receipt_line: 'counter 01',
      receipt_identifier: 'receipt-verify-abc',
      total_amount_thb: 900,
      ocr_status: 'stored',
      ocr_raw_text: null,
      ocr_metadata: {
        storage: 'local',
      },
      verification_source: 'bill_verification_modal',
      verification_metadata: {
        flow: 'receipt_booking',
        booking_channel: 'liff_receipt_promo_q2_2026',
      },
    },
  });

  assert.equal(calls.length, 5);
  assert.match(calls[0].sql, /CREATE EXTENSION IF NOT EXISTS "pgcrypto"/i);
  assert.match(calls[1].sql, /CREATE TABLE IF NOT EXISTS public\.appointment_receipts/i);
  assert.match(calls.at(-1).sql, /INSERT INTO appointment_receipts/i);
  assert.deepEqual(result, {
    id: '99999999-9999-4999-8999-999999999999',
    appointment_id: '11111111-1111-4111-8111-111111111111',
    receipt_image_ref: '/api/internal/receipt-uploads/example.jpg',
    receipt_number: 'RCP-20260325-0001',
    receipt_line: 'counter 01',
    receipt_identifier: 'receipt-verify-abc',
    total_amount_thb: 900,
    ocr_status: 'stored',
    ocr_raw_text: null,
    ocr_metadata: {
      storage: 'local',
    },
    verification_source: 'bill_verification_modal',
    verification_metadata: {
      flow: 'receipt_booking',
      booking_channel: 'liff_receipt_promo_q2_2026',
    },
    created_at: '2026-03-25T03:20:00.000Z',
    updated_at: '2026-03-25T03:20:00.000Z',
  });
});

test('insertAppointmentReceiptEvidence returns null when no receipt evidence is supplied', async () => {
  let queryCalled = false;
  const client = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };

  const result = await insertAppointmentReceiptEvidence(client, {
    appointmentId: '11111111-1111-4111-8111-111111111111',
    receiptEvidence: null,
  });

  assert.equal(result, null);
  assert.equal(queryCalled, false);
});
