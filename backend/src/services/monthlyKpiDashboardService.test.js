import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMonthlyKpiDashboardReport,
  resolveDashboardPeriod,
  resolveDashboardMonthRange,
  resolveDashboardYearRange,
} from './monthlyKpiDashboardService.js';

function capabilityRow(tableName, columnName, { dataType = 'text', udtName = 'text' } = {}) {
  return {
    table_name: tableName,
    column_name: columnName,
    data_type: dataType,
    udt_name: udtName,
  };
}

function buildFullCapabilities() {
  return [
    capabilityRow('appointments', 'source'),
    capabilityRow('appointments', 'selected_toppings', { dataType: 'jsonb', udtName: 'jsonb' }),
    capabilityRow('appointments', 'addons_total_thb', { dataType: 'integer', udtName: 'int4' }),
    capabilityRow('appointment_drafts', 'submitted_appointment_id', {
      dataType: 'uuid',
      udtName: 'uuid',
    }),
    capabilityRow('appointment_drafts', 'source'),
    capabilityRow('appointment_drafts', 'flow_metadata', { dataType: 'jsonb', udtName: 'jsonb' }),
    capabilityRow('appointment_receipts', 'appointment_id', { dataType: 'uuid', udtName: 'uuid' }),
    capabilityRow('appointment_receipts', 'total_amount_thb', {
      dataType: 'numeric',
      udtName: 'numeric',
    }),
    capabilityRow('appointment_receipts', 'verification_metadata', {
      dataType: 'jsonb',
      udtName: 'jsonb',
    }),
    capabilityRow('toppings', 'code'),
    capabilityRow('toppings', 'category'),
  ];
}

function createDashboardQueryFn({
  capabilities = buildFullCapabilities(),
  freeScanRow = {
    free_scan_appointments_count: 0,
    source_customer_count: 0,
    converted_customer_count: 0,
    matched_signals: [],
  },
  completedAddonRows = [
    {
      appointment_id: 'appt-completed-1',
      customer_id: 'cust-a',
      addons_total_thb: 200,
      topping_code: 'serum-a',
      topping_category: 'product',
      receipt_total_amount_thb: null,
    },
    {
      appointment_id: 'appt-completed-2',
      customer_id: 'cust-b',
      addons_total_thb: 0,
      topping_code: null,
      topping_category: null,
      receipt_total_amount_thb: null,
    },
  ],
  receiptAddonRows = [
    {
      appointment_id: 'appt-receipt-1',
      customer_id: 'cust-a',
      addons_total_thb: 200,
      topping_code: 'serum-a',
      topping_category: 'product',
      receipt_total_amount_thb: 1000,
    },
    {
      appointment_id: 'appt-receipt-2',
      customer_id: 'cust-b',
      addons_total_thb: 0,
      topping_code: null,
      topping_category: null,
      receipt_total_amount_thb: 500,
    },
  ],
  receiptFallbackRow = {
    receipt_count: 2,
    receipt_total_amount_thb: 1500,
  },
  allTimeStartRow = {
    start_date: '2025-01-01',
  },
  receiptFallbackError = null,
} = {}) {
  const seenQueries = [];
  const seenCalls = [];

  const queryFn = async (sql, params = []) => {
    const text = String(sql || '');
    const normalized = text.toLowerCase();
    seenQueries.push(text);
    seenCalls.push({ text, params });

    if (normalized.includes('from information_schema.columns')) {
      return { rows: capabilities };
    }

    if (normalized.includes('select min(source_date)::date as start_date')) {
      return { rows: [allTimeStartRow] };
    }

    if (normalized.includes("to_char(date(a.scheduled_at at time zone 'asia/bangkok')")) {
      return {
        rows: [
          {
            report_date: '2026-03-01',
            total_appointments: 8,
            completed_count: 5,
            cancelled_count: 2,
            no_show_count: 1,
          },
          {
            report_date: '2026-03-02',
            total_appointments: 12,
            completed_count: 7,
            cancelled_count: 2,
            no_show_count: 1,
          },
        ],
      };
    }

    if (normalized.includes("to_char(date_trunc('month', a.scheduled_at at time zone 'asia/bangkok')::date")) {
      return {
        rows: [
          {
            report_date: '2026-01',
            total_appointments: 8,
            completed_count: 5,
            cancelled_count: 2,
            no_show_count: 1,
          },
          {
            report_date: '2026-02',
            total_appointments: 12,
            completed_count: 7,
            cancelled_count: 2,
            no_show_count: 1,
          },
        ],
      };
    }

    if (
      normalized.includes('count(*)::int as total_appointments') &&
      normalized.includes('from appointments a') &&
      !normalized.includes('group by')
    ) {
      return {
        rows: [
          {
            total_appointments: 20,
            completed_count: 12,
            cancelled_count: 4,
            no_show_count: 2,
          },
        ],
      };
    }

    if (normalized.includes('from customer_packages cp') && normalized.includes('group by coalesce(p.price_thb, 0)')) {
      return {
        rows: [
          { price_thb: 399, sales_count: 5, buyer_count: 5, revenue_thb: 1995 },
          { price_thb: 999, sales_count: 3, buyer_count: 3, revenue_thb: 2997 },
          { price_thb: 2999, sales_count: 1, buyer_count: 1, revenue_thb: 2999 },
          { price_thb: 1599, sales_count: 2, buyer_count: 2, revenue_thb: 3198 },
        ],
      };
    }

    if (normalized.includes('group by coalesce(nullif(staff_evt.staff_name')) {
      return {
        rows: [
          {
            staff_name: 'พนักงานเอ',
            total_appointments: 10,
            completed_count: 7,
            cancelled_count: 2,
            no_show_count: 1,
          },
          {
            staff_name: 'พนักงานบี',
            total_appointments: 10,
            completed_count: 5,
            cancelled_count: 2,
            no_show_count: 1,
          },
        ],
      };
    }

    if (normalized.includes('count(*)::int as total_redemptions')) {
      return {
        rows: [
          {
            total_redemptions: 11,
            packages_used_count: 6,
            mask_redemptions_count: 4,
          },
        ],
      };
    }

    if (normalized.includes('with usage_rollup as')) {
      return {
        rows: [{ packages_completed_count: 3 }],
      };
    }

    if (normalized.includes('group by coalesce(nullif(p.title')) {
      return {
        rows: [
          {
            package_label: 'Smooth 3 ครั้ง 999',
            redemptions_count: 6,
            packages_used_count: 3,
          },
          {
            package_label: 'Smooth 1 ครั้ง 399',
            redemptions_count: 5,
            packages_used_count: 3,
          },
        ],
      };
    }

    if (normalized.includes('with monthly_buyers as')) {
      return {
        rows: [
          {
            unique_buyers_count: 8,
            repeat_buyers_count: 3,
          },
        ],
      };
    }

    if (normalized.includes('with free_scan_appointments as')) {
      return { rows: [freeScanRow] };
    }

    if (
      normalized.includes('left join toppings t on t.code = topping_codes.code') &&
      normalized.includes("join appointment_receipts ar on ar.appointment_id = a.id")
    ) {
      return { rows: receiptAddonRows };
    }

    if (
      normalized.includes('left join toppings t on t.code = topping_codes.code') &&
      normalized.includes("lower(coalesce(a.status, '')) = 'completed'")
    ) {
      return { rows: completedAddonRows };
    }

    if (normalized.includes('from appointment_receipts ar') && normalized.includes('sum(coalesce(ar.total_amount_thb, 0))')) {
      if (receiptFallbackError) {
        throw receiptFallbackError;
      }
      return { rows: [receiptFallbackRow] };
    }

    throw new Error(`Unhandled query in test: ${normalized}`);
  };

  return { queryFn, seenQueries, seenCalls };
}

test('resolveDashboardMonthRange validates explicit month', () => {
  const range = resolveDashboardMonthRange('2026-03', new Date('2026-01-15T00:00:00.000Z'));
  assert.equal(range.month, '2026-03');
  assert.equal(range.start_date, '2026-03-01');
  assert.equal(range.end_date, '2026-03-31');
  assert.equal(range.month_label_th, 'มีนาคม 2569');
});

test('resolveDashboardMonthRange falls back to current month', () => {
  const range = resolveDashboardMonthRange('', new Date('2026-11-20T10:00:00.000Z'));
  assert.equal(range.month, '2026-11');
  assert.equal(range.start_date, '2026-11-01');
  assert.equal(range.end_date, '2026-11-30');
});

test('resolveDashboardYearRange validates explicit year', () => {
  const range = resolveDashboardYearRange('2026', new Date('2026-03-18T00:00:00.000Z'));
  assert.equal(range.year, '2026');
  assert.equal(range.start_date, '2026-01-01');
  assert.equal(range.end_date, '2026-12-31');
  assert.equal(range.label_th, 'ปี 2569');
  assert.equal(range.timeline_granularity, 'month');
});

test('resolveDashboardMonthRange rejects invalid YYYY-MM values', () => {
  assert.throws(
    () => resolveDashboardMonthRange('2026-3', new Date('2026-03-18T00:00:00.000Z')),
    /month must use YYYY-MM format/
  );
});

test('resolveDashboardPeriod resolves all scope from earliest source date', async () => {
  const { queryFn } = createDashboardQueryFn({
    allTimeStartRow: {
      start_date: new Date('2025-02-03T00:00:00+07:00'),
    },
  });

  const range = await resolveDashboardPeriod({
    scope: 'all',
    now: new Date('2026-03-26T12:00:00.000Z'),
    queryFn,
  });

  assert.equal(range.scope, 'all');
  assert.equal(range.start_date, '2025-02-03');
  assert.equal(range.end_date, '2026-03-26');
  assert.equal(range.label_th, 'ภาพรวมทั้งหมด');
  assert.equal(range.timeline_granularity, 'month');
});

test('getMonthlyKpiDashboardReport assembles read-only KPI payload with capability-driven topic metrics', async () => {
  const { queryFn, seenQueries, seenCalls } = createDashboardQueryFn({
    freeScanRow: {
      free_scan_appointments_count: 0,
      source_customer_count: 0,
      converted_customer_count: 0,
      matched_signals: [],
    },
  });

  const report = await getMonthlyKpiDashboardReport({
    month: '2026-03',
    now: new Date('2026-03-18T00:00:00.000Z'),
    queryFn,
  });

  assert.equal(report.period.month, '2026-03');
  assert.equal(report.summary_cards[0].value, 20);
  assert.equal(report.summary_cards[1].value, 60);
  assert.equal(report.sections.course_sales_mix.total_sales_count, 11);
  assert.equal(report.sections.staff_utilization.availability, 'proxy');
  assert.equal(report.sections.course_redemption.packages_completed_count, 3);
  assert.equal(report.sections.repurchase.repurchase_rate_pct, 37.5);
  assert.equal(report.sections.free_scan_conversion.status, 'available');
  assert.equal(report.sections.upsell_conversion.status, 'available');
  assert.equal(report.sections.upsell_conversion.upsell_rate_pct, 50);
  assert.equal(report.sections.revenue_mix.status, 'available');
  assert.equal(report.sections.revenue_mix.value.product_revenue_thb, 200);
  assert.equal(report.sections.revenue_mix.value.service_revenue_thb, 1300);
  assert.equal(report.meta.partial, false);
  assert.equal(report.assumptions.length >= 4, true);
  assert.equal(seenQueries.some((text) => String(text).toLowerCase().includes('from information_schema.columns')), true);
  const appointmentOverviewCall = seenCalls.find(
    ({ text }) =>
      String(text).toLowerCase().includes('count(*)::int as total_appointments') &&
      String(text).toLowerCase().includes('from appointments a') &&
      !String(text).toLowerCase().includes('group by')
  );
  assert.deepEqual(appointmentOverviewCall?.params, ['2026-03-01', '2026-03-31', '^(e2e_|e2e_workflow_|verify-)']);
  assert.equal(
    seenQueries.every((text) => {
      const normalized = String(text || '').trim().toLowerCase();
      return normalized.startsWith('select') || normalized.startsWith('with');
    }),
    true
  );
});

test('getMonthlyKpiDashboardReport uses year scope boundaries and monthly timeline grouping', async () => {
  const { queryFn, seenCalls } = createDashboardQueryFn();

  const report = await getMonthlyKpiDashboardReport({
    scope: 'year',
    year: '2026',
    now: new Date('2026-03-18T00:00:00.000Z'),
    queryFn,
  });

  assert.equal(report.period.scope, 'year');
  assert.equal(report.period.label_th, 'ปี 2569');
  assert.equal(report.period.timeline_granularity, 'month');
  assert.equal(report.sections.appointment_outcomes.daily_rows[0].date, '2026-01');
  assert.equal(report.sections.appointment_outcomes.daily_rows[0].label, 'ม.ค.');

  const appointmentOverviewCall = seenCalls.find(
    ({ text }) =>
      String(text).toLowerCase().includes('count(*)::int as total_appointments') &&
      String(text).toLowerCase().includes('from appointments a') &&
      !String(text).toLowerCase().includes('group by')
  );
  assert.deepEqual(appointmentOverviewCall?.params, ['2026-01-01', '2026-12-31', '^(e2e_|e2e_workflow_|verify-)']);
});

test('free_scan_conversion returns available metric when explicit scan source rows exist', async () => {
  const { queryFn } = createDashboardQueryFn({
    freeScanRow: {
      free_scan_appointments_count: 5,
      source_customer_count: 4,
      converted_customer_count: 1,
      matched_signals: ['free_scan_campaign', 'skin_scan_liff'],
    },
  });

  const report = await getMonthlyKpiDashboardReport({
    month: '2026-03',
    now: new Date('2026-03-20T00:00:00.000Z'),
    queryFn,
  });

  const section = report.sections.free_scan_conversion;
  assert.equal(section.status, 'available');
  assert.equal(section.conversion_rate_pct, 25);
  assert.equal(section.source_customer_count, 4);
  assert.equal(section.converted_customer_count, 1);
  assert.deepEqual(section.matched_signals, ['free_scan_campaign', 'skin_scan_liff']);
  assert.equal(section.dataSource.includes('appointments.source'), true);
});

test('free_scan_conversion returns unavailable metric when schema has no explicit scan-capable source fields', async () => {
  const { queryFn } = createDashboardQueryFn({
    capabilities: [
      capabilityRow('appointments', 'selected_toppings', { dataType: 'jsonb', udtName: 'jsonb' }),
      capabilityRow('appointments', 'addons_total_thb', { dataType: 'integer', udtName: 'int4' }),
      capabilityRow('appointment_receipts', 'appointment_id', { dataType: 'uuid', udtName: 'uuid' }),
      capabilityRow('appointment_receipts', 'total_amount_thb', {
        dataType: 'numeric',
        udtName: 'numeric',
      }),
      capabilityRow('toppings', 'code'),
      capabilityRow('toppings', 'category'),
    ],
  });

  const report = await getMonthlyKpiDashboardReport({
    month: '2026-03',
    now: new Date('2026-03-20T00:00:00.000Z'),
    queryFn,
  });

  const section = report.sections.free_scan_conversion;
  assert.equal(section.status, 'unavailable');
  assert.match(section.explanation, /free facial scan/i);
  assert.equal(section.missingRequirements.length > 0, true);
});

test('upsell_conversion returns available metric when selected_toppings map to explicit product categories', async () => {
  const { queryFn } = createDashboardQueryFn({
    completedAddonRows: [
      {
        appointment_id: 'appt-1',
        customer_id: 'cust-a',
        addons_total_thb: 200,
        topping_code: 'serum-a',
        topping_category: 'product',
        receipt_total_amount_thb: null,
      },
      {
        appointment_id: 'appt-2',
        customer_id: 'cust-b',
        addons_total_thb: 0,
        topping_code: null,
        topping_category: null,
        receipt_total_amount_thb: null,
      },
      {
        appointment_id: 'appt-3',
        customer_id: 'cust-c',
        addons_total_thb: 150,
        topping_code: 'massage-upgrade',
        topping_category: 'service',
        receipt_total_amount_thb: null,
      },
    ],
  });

  const report = await getMonthlyKpiDashboardReport({
    month: '2026-03',
    now: new Date('2026-03-20T00:00:00.000Z'),
    queryFn,
  });

  const section = report.sections.upsell_conversion;
  assert.equal(section.status, 'available');
  assert.equal(section.eligible_appointments_count, 3);
  assert.equal(section.upsell_appointments_count, 1);
  assert.equal(section.upsell_rate_pct, 33.3);
  assert.deepEqual(section.matched_product_categories, ['product']);
});

test('upsell_conversion returns unavailable metric when selected_toppings classification fields are missing', async () => {
  const { queryFn } = createDashboardQueryFn({
    capabilities: [
      capabilityRow('appointments', 'source'),
      capabilityRow('appointment_receipts', 'appointment_id', { dataType: 'uuid', udtName: 'uuid' }),
      capabilityRow('appointment_receipts', 'total_amount_thb', {
        dataType: 'numeric',
        udtName: 'numeric',
      }),
    ],
  });

  const report = await getMonthlyKpiDashboardReport({
    month: '2026-03',
    now: new Date('2026-03-20T00:00:00.000Z'),
    queryFn,
  });

  const section = report.sections.upsell_conversion;
  assert.equal(section.status, 'unavailable');
  assert.equal(section.missingRequirements.includes('appointments.selected_toppings (jsonb)'), true);
  assert.equal(section.missingRequirements.includes('toppings.code'), true);
});

test('revenue_mix returns available metric when every receipt-backed appointment is classifiable', async () => {
  const { queryFn } = createDashboardQueryFn({
    receiptAddonRows: [
      {
        appointment_id: 'appt-1',
        customer_id: 'cust-a',
        addons_total_thb: 200,
        topping_code: 'serum-a',
        topping_category: 'product',
        receipt_total_amount_thb: 1000,
      },
      {
        appointment_id: 'appt-2',
        customer_id: 'cust-b',
        addons_total_thb: 120,
        topping_code: 'massage-upgrade',
        topping_category: 'service',
        receipt_total_amount_thb: 620,
      },
    ],
    receiptFallbackRow: {
      receipt_count: 2,
      receipt_total_amount_thb: 1620,
    },
  });

  const report = await getMonthlyKpiDashboardReport({
    month: '2026-03',
    now: new Date('2026-03-20T00:00:00.000Z'),
    queryFn,
  });

  const section = report.sections.revenue_mix;
  assert.equal(section.status, 'available');
  assert.deepEqual(section.value, {
    service_revenue_thb: 1420,
    product_revenue_thb: 200,
    service_revenue_pct: 87.7,
    product_revenue_pct: 12.3,
  });
  assert.equal(section.classifiable_receipt_count, 2);
  assert.equal(section.ambiguous_receipt_count, 0);
});

test('revenue_mix returns fallback metric when receipt totals exist but add-on split is ambiguous', async () => {
  const { queryFn } = createDashboardQueryFn({
    receiptAddonRows: [
      {
        appointment_id: 'appt-1',
        customer_id: 'cust-a',
        addons_total_thb: 200,
        topping_code: null,
        topping_category: null,
        receipt_total_amount_thb: 1000,
      },
    ],
    receiptFallbackRow: {
      receipt_count: 1,
      receipt_total_amount_thb: 1000,
    },
  });

  const report = await getMonthlyKpiDashboardReport({
    month: '2026-03',
    now: new Date('2026-03-20T00:00:00.000Z'),
    queryFn,
  });

  const section = report.sections.revenue_mix;
  assert.equal(section.status, 'fallback');
  assert.equal(section.classifiable_receipt_count, 0);
  assert.equal(section.ambiguous_receipt_count, 1);
  assert.equal(section.fallback.receipt_total_amount_thb, 1000);
  assert.match(section.explanation, /split add-on/i);
});

test('getMonthlyKpiDashboardReport returns partial payload when receipt fallback source table is missing', async () => {
  const missingRelationError = new Error('relation "appointment_receipts" does not exist');
  missingRelationError.code = '42P01';
  missingRelationError.table = 'appointment_receipts';

  const { queryFn } = createDashboardQueryFn({
    capabilities: [
      capabilityRow('appointments', 'source'),
      capabilityRow('appointments', 'selected_toppings', { dataType: 'jsonb', udtName: 'jsonb' }),
      capabilityRow('appointments', 'addons_total_thb', { dataType: 'integer', udtName: 'int4' }),
      capabilityRow('toppings', 'code'),
      capabilityRow('toppings', 'category'),
    ],
    receiptFallbackError: missingRelationError,
  });

  const report = await getMonthlyKpiDashboardReport({
    month: '2026-03',
    now: new Date('2026-03-18T00:00:00.000Z'),
    queryFn,
  });

  assert.equal(report.meta.partial, true);
  assert.deepEqual(report.meta.unavailable_sections, ['revenue_mix_receipt_fallback']);
  assert.equal(report.sections.appointment_outcomes.availability, 'available');
  assert.equal(report.sections.revenue_mix.status, 'unavailable');
  assert.equal(report.sections.revenue_mix.fallback, null);
  assert.equal(report.summary_cards[0].availability, 'available');
  assert.equal(report.summary_cards[2].availability, 'available');
});
