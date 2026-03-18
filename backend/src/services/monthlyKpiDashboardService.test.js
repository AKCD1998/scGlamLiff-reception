import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMonthlyKpiDashboardReport,
  resolveDashboardMonthRange,
} from './monthlyKpiDashboardService.js';

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

test('resolveDashboardMonthRange rejects invalid YYYY-MM values', () => {
  assert.throws(
    () => resolveDashboardMonthRange('2026-3', new Date('2026-03-18T00:00:00.000Z')),
    /month must use YYYY-MM format/
  );
});

test('getMonthlyKpiDashboardReport assembles read-only KPI payload', async () => {
  const seenQueries = [];
  const queryFn = async (sql) => {
    const text = String(sql || '');
    seenQueries.push(text);
    const normalized = text.toLowerCase();

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
        rows: [
          {
            packages_completed_count: 3,
          },
        ],
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

    if (normalized.includes('from appointment_receipts ar')) {
      return {
        rows: [
          {
            receipt_count: 4,
            receipt_total_amount_thb: 4396.5,
          },
        ],
      };
    }

    throw new Error(`Unhandled query in test: ${normalized}`);
  };

  const report = await getMonthlyKpiDashboardReport({
    month: '2026-03',
    now: new Date('2026-03-18T00:00:00.000Z'),
    queryFn,
  });

  assert.equal(report.period.month, '2026-03');
  assert.equal(report.summary_cards[0].value, 20);
  assert.equal(report.summary_cards[1].value, 60);
  assert.equal(report.sections.course_sales_mix.total_sales_count, 11);
  assert.equal(report.sections.course_sales_mix.rows[0].sales_count, 5);
  assert.equal(report.sections.course_sales_mix.rows[3].bucket, 'other');
  assert.equal(report.sections.staff_utilization.availability, 'proxy');
  assert.equal(report.sections.staff_utilization.rows[0].share_of_completed_pct, 58.3);
  assert.equal(report.sections.no_show_cancellation.no_show_rate_pct, 10);
  assert.equal(report.sections.course_redemption.packages_completed_count, 3);
  assert.equal(report.sections.repurchase.repurchase_rate_pct, 37.5);
  assert.equal(report.sections.revenue_mix.availability, 'unavailable');
  assert.equal(report.sections.revenue_mix.fallback.receipt_total_amount_thb, 4396.5);
  assert.equal(report.sections.free_scan_conversion.availability, 'unavailable');
  assert.equal(report.assumptions.length >= 4, true);
  assert.equal(seenQueries.length >= 7, true);
  assert.equal(
    seenQueries.every((text) => {
      const normalized = String(text || '').trim().toLowerCase();
      return normalized.startsWith('select') || normalized.startsWith('with');
    }),
    true
  );
});

test('getMonthlyKpiDashboardReport returns partial payload when an optional KPI source table is missing', async () => {
  const queryFn = async (sql) => {
    const normalized = String(sql || '').toLowerCase();

    if (normalized.includes("to_char(date(a.scheduled_at at time zone 'asia/bangkok')")) {
      return {
        rows: [
          {
            report_date: '2026-03-01',
            total_appointments: 5,
            completed_count: 4,
            cancelled_count: 1,
            no_show_count: 0,
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
            total_appointments: 5,
            completed_count: 4,
            cancelled_count: 1,
            no_show_count: 0,
          },
        ],
      };
    }

    if (normalized.includes('from customer_packages cp') && normalized.includes('group by coalesce(p.price_thb, 0)')) {
      return {
        rows: [{ price_thb: 399, sales_count: 2, buyer_count: 2, revenue_thb: 798 }],
      };
    }

    if (normalized.includes('group by coalesce(nullif(staff_evt.staff_name')) {
      return {
        rows: [
          {
            staff_name: 'พนักงานเอ',
            total_appointments: 5,
            completed_count: 4,
            cancelled_count: 1,
            no_show_count: 0,
          },
        ],
      };
    }

    if (normalized.includes('count(*)::int as total_redemptions')) {
      return {
        rows: [
          {
            total_redemptions: 3,
            packages_used_count: 2,
            mask_redemptions_count: 1,
          },
        ],
      };
    }

    if (normalized.includes('with usage_rollup as')) {
      return {
        rows: [{ packages_completed_count: 1 }],
      };
    }

    if (normalized.includes('group by coalesce(nullif(p.title')) {
      return {
        rows: [
          {
            package_label: 'Smooth 1 ครั้ง 399',
            redemptions_count: 3,
            packages_used_count: 2,
          },
        ],
      };
    }

    if (normalized.includes('with monthly_buyers as')) {
      return {
        rows: [
          {
            unique_buyers_count: 2,
            repeat_buyers_count: 1,
          },
        ],
      };
    }

    if (normalized.includes('from appointment_receipts ar')) {
      const error = new Error('relation "appointment_receipts" does not exist');
      error.code = '42P01';
      error.table = 'appointment_receipts';
      throw error;
    }

    throw new Error(`Unhandled query in partial test: ${normalized}`);
  };

  const report = await getMonthlyKpiDashboardReport({
    month: '2026-03',
    now: new Date('2026-03-18T00:00:00.000Z'),
    queryFn,
  });

  assert.equal(report.meta.partial, true);
  assert.deepEqual(report.meta.unavailable_sections, ['revenue_mix_receipt_fallback']);
  assert.equal(report.sections.appointment_outcomes.availability, 'available');
  assert.equal(report.sections.revenue_mix.availability, 'unavailable');
  assert.equal(report.sections.revenue_mix.fallback, null);
  assert.match(report.sections.revenue_mix.note, /production/i);
  assert.equal(report.summary_cards[0].availability, 'available');
  assert.equal(report.summary_cards[2].availability, 'available');
});
