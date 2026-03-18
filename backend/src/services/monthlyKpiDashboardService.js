const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const REPORT_ERROR_CODE_MAP = {
  '42P01': 'missing_relation',
  '42703': 'missing_column',
  '42883': 'schema_mismatch',
};
const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];
const TEST_RECORD_REGEX_SQL = '^(e2e_|e2e_workflow_|verify-)';

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function badRequest(message, details = null) {
  const error = new Error(message);
  error.status = 400;
  if (details) {
    error.details = details;
  }
  return error;
}

function toInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.trunc(parsed);
}

function toMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function toRate(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

function toThaiMonthLabel(month) {
  const [year, monthNumber] = String(month).split('-').map((part) => Number.parseInt(part, 10));
  const monthIndex = monthNumber - 1;
  return `${THAI_MONTHS[monthIndex] || month} ${year + 543}`;
}

export function resolveDashboardMonthRange(rawMonth, now = new Date()) {
  const fallbackMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = normalizeText(rawMonth) || fallbackMonth;

  if (!MONTH_PATTERN.test(month)) {
    throw badRequest('month must use YYYY-MM format', {
      param: 'month',
      provided: month,
      expected: 'YYYY-MM',
    });
  }

  const [yearText, monthText] = month.split('-');
  const year = Number.parseInt(yearText, 10);
  const monthIndex = Number.parseInt(monthText, 10) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  const startDate = `${yearText}-${monthText}-01`;
  const endDate = `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(
    end.getUTCDate()
  ).padStart(2, '0')}`;

  return {
    month,
    month_label_th: toThaiMonthLabel(month),
    start_date: startDate,
    end_date: endDate,
  };
}

function buildCard({
  id,
  label,
  value = null,
  unit = '',
  availability = 'available',
  reason = '',
  note = '',
}) {
  return {
    id,
    label,
    value,
    unit,
    availability,
    reason: reason || null,
    note: note || null,
  };
}

function buildNoDataSection({ title, reason, note = '', fallback = null }) {
  return {
    availability: 'unavailable',
    title,
    reason,
    note: note || null,
    fallback,
  };
}

function buildUnavailableSection({
  title,
  reason,
  note = '',
  fallback = null,
  rows = [],
  top_packages = [],
  daily_rows = [],
  total_appointments = null,
  completed_count = null,
  cancelled_count = null,
  no_show_count = null,
  completion_rate_pct = null,
  cancellation_rate_pct = null,
  no_show_rate_pct = null,
  total_sales_count = null,
  total_buyer_count = null,
  total_revenue_thb = null,
  total_redemptions = null,
  packages_used_count = null,
  mask_redemptions_count = null,
  packages_completed_count = null,
  unique_buyers_count = null,
  repeat_buyers_count = null,
  first_time_buyers_count = null,
  repurchase_rate_pct = null,
} = {}) {
  return {
    availability: 'unavailable',
    title,
    reason,
    note: note || null,
    fallback,
    rows,
    top_packages,
    daily_rows,
    total_appointments,
    completed_count,
    cancelled_count,
    no_show_count,
    completion_rate_pct,
    cancellation_rate_pct,
    no_show_rate_pct,
    total_sales_count,
    total_buyer_count,
    total_revenue_thb,
    total_redemptions,
    packages_used_count,
    mask_redemptions_count,
    packages_completed_count,
    unique_buyers_count,
    repeat_buyers_count,
    first_time_buyers_count,
    repurchase_rate_pct,
  };
}

function getReportErrorCategory(error) {
  const normalizedCode = normalizeText(error?.code).toUpperCase();
  return REPORT_ERROR_CODE_MAP[normalizedCode] || 'query_failed';
}

function buildRecoverableSectionReason(error) {
  const category = getReportErrorCategory(error);

  if (category === 'missing_relation') {
    return {
      reason: 'ยังอ่านข้อมูลส่วนนี้ไม่ได้ เพราะฐานข้อมูล production ยังไม่มีตารางต้นทางบางตัวที่ KPI นี้ต้องใช้',
      note: 'ระบบยังคงแสดง KPI ส่วนอื่นต่อได้ และควรตรวจสอบ migration/schema ของข้อมูลรายงานส่วนนี้ใน server logs',
    };
  }

  if (category === 'missing_column') {
    return {
      reason: 'ยังอ่านข้อมูลส่วนนี้ไม่ได้ เพราะ schema production ยังขาดคอลัมน์ที่ KPI นี้ต้องใช้',
      note: 'ระบบยังคงแสดง KPI ส่วนอื่นต่อได้ และควรตรวจสอบความตรงกันของ schema ระหว่างเครื่องพัฒนาและ production',
    };
  }

  if (category === 'schema_mismatch') {
    return {
      reason: 'ยังอ่านข้อมูลส่วนนี้ไม่ได้ เพราะโครงสร้างข้อมูลใน production ยังไม่ตรงกับ query ของ KPI ชุดนี้',
      note: 'ระบบยังคงแสดง KPI ส่วนอื่นต่อได้ และควรตรวจสอบ type/operator หรือ query compatibility ของฐานข้อมูลส่วนนี้',
    };
  }

  return {
    reason: 'ยังอ่านข้อมูลส่วนนี้ไม่ได้ในขณะนี้ ระบบข้าม KPI ส่วนนี้ชั่วคราวเพื่อไม่ให้ทั้ง dashboard ล้ม',
    note: 'ส่วนนี้เป็นข้อมูลอ่านอย่างเดียว และไม่มีผลต่อข้อมูลธุรกรรมเดิม',
  };
}

function logSectionFailure(sectionKey, error, { month } = {}) {
  console.error('[monthlyKpiDashboard] section failed', {
    section: sectionKey,
    month: normalizeText(month) || null,
    message: normalizeText(error?.message) || 'unknown error',
    code: normalizeText(error?.code) || null,
    detail: normalizeText(error?.detail) || null,
    hint: normalizeText(error?.hint) || null,
    table: normalizeText(error?.table) || null,
    column: normalizeText(error?.column) || null,
    constraint: normalizeText(error?.constraint) || null,
    where: normalizeText(error?.where) || null,
    stack: error?.stack || null,
  });
}

function buildSectionWarning(sectionKey, error, title) {
  const detail = buildRecoverableSectionReason(error);
  return {
    section: sectionKey,
    title,
    availability: 'unavailable',
    reason: detail.reason,
    note: detail.note || null,
    category: getReportErrorCategory(error),
  };
}

async function readSectionSafely({ sectionKey, title, month, run }) {
  try {
    const data = await run();
    return {
      ok: true,
      sectionKey,
      title,
      data,
      warning: null,
    };
  } catch (error) {
    logSectionFailure(sectionKey, error, { month });
    return {
      ok: false,
      sectionKey,
      title,
      data: null,
      error,
      warning: buildSectionWarning(sectionKey, error, title),
    };
  }
}

const STAFF_NAME_LATERAL_SQL = `
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(
        NULLIF(ae.meta->'after'->>'staff_name', ''),
        NULLIF(ae.meta->>'staff_name', ''),
        NULLIF(ae.meta->'after'->>'staff_display_name', ''),
        NULLIF(ae.meta->>'staff_display_name', '')
      ) AS staff_name
    FROM appointment_events ae
    WHERE ae.appointment_id = a.id
      AND (
        COALESCE(ae.meta->'after', '{}'::jsonb) ? 'staff_name'
        OR ae.meta ? 'staff_name'
        OR COALESCE(ae.meta->'after', '{}'::jsonb) ? 'staff_display_name'
        OR ae.meta ? 'staff_display_name'
      )
      AND COALESCE(
        NULLIF(ae.meta->'after'->>'staff_name', ''),
        NULLIF(ae.meta->>'staff_name', ''),
        NULLIF(ae.meta->'after'->>'staff_display_name', ''),
        NULLIF(ae.meta->>'staff_display_name', '')
      ) IS NOT NULL
    ORDER BY ae.event_at DESC NULLS LAST, ae.id DESC
    LIMIT 1
  ) staff_evt ON true
`;

async function fetchAppointmentOverview(queryFn, { startDate, endDate }) {
  const result = await queryFn(
    `
      SELECT
        COUNT(*)::int AS total_appointments,
        SUM(CASE WHEN LOWER(COALESCE(a.status, '')) = 'completed' THEN 1 ELSE 0 END)::int AS completed_count,
        SUM(
          CASE
            WHEN LOWER(COALESCE(a.status, '')) IN ('cancelled', 'canceled') THEN 1
            ELSE 0
          END
        )::int AS cancelled_count,
        SUM(
          CASE
            WHEN LOWER(COALESCE(a.status, '')) IN ('no_show', 'no-show', 'noshow') THEN 1
            ELSE 0
          END
        )::int AS no_show_count
      FROM appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      WHERE DATE(a.scheduled_at AT TIME ZONE 'Asia/Bangkok') BETWEEN $1 AND $2
        AND NOT (
          COALESCE(c.full_name, '') ~* $3
          OR COALESCE(a.line_user_id, '') ~* $3
        )
    `,
    [startDate, endDate, TEST_RECORD_REGEX_SQL]
  );

  const row = result.rows?.[0] || {};
  const totalAppointments = toInt(row.total_appointments);
  const completedCount = toInt(row.completed_count);
  const cancelledCount = toInt(row.cancelled_count);
  const noShowCount = toInt(row.no_show_count);

  return {
    total_appointments: totalAppointments,
    completed_count: completedCount,
    cancelled_count: cancelledCount,
    no_show_count: noShowCount,
    completion_rate_pct: toRate(completedCount, totalAppointments),
    cancellation_rate_pct: toRate(cancelledCount, totalAppointments),
    no_show_rate_pct: toRate(noShowCount, totalAppointments),
  };
}

async function fetchDailyOutcomeRows(queryFn, { startDate, endDate }) {
  const result = await queryFn(
    `
      SELECT
        TO_CHAR(DATE(a.scheduled_at AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM-DD') AS report_date,
        COUNT(*)::int AS total_appointments,
        SUM(CASE WHEN LOWER(COALESCE(a.status, '')) = 'completed' THEN 1 ELSE 0 END)::int AS completed_count,
        SUM(
          CASE
            WHEN LOWER(COALESCE(a.status, '')) IN ('cancelled', 'canceled') THEN 1
            ELSE 0
          END
        )::int AS cancelled_count,
        SUM(
          CASE
            WHEN LOWER(COALESCE(a.status, '')) IN ('no_show', 'no-show', 'noshow') THEN 1
            ELSE 0
          END
        )::int AS no_show_count
      FROM appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      WHERE DATE(a.scheduled_at AT TIME ZONE 'Asia/Bangkok') BETWEEN $1 AND $2
        AND NOT (
          COALESCE(c.full_name, '') ~* $3
          OR COALESCE(a.line_user_id, '') ~* $3
        )
      GROUP BY DATE(a.scheduled_at AT TIME ZONE 'Asia/Bangkok')
      ORDER BY DATE(a.scheduled_at AT TIME ZONE 'Asia/Bangkok') ASC
    `,
    [startDate, endDate, TEST_RECORD_REGEX_SQL]
  );

  return (result.rows || []).map((row) => ({
    date: normalizeText(row.report_date),
    total_appointments: toInt(row.total_appointments),
    completed_count: toInt(row.completed_count),
    cancelled_count: toInt(row.cancelled_count),
    no_show_count: toInt(row.no_show_count),
  }));
}

async function fetchCourseSalesRows(queryFn, { startDate, endDate }) {
  const result = await queryFn(
    `
      SELECT
        COALESCE(p.price_thb, 0)::int AS price_thb,
        COUNT(*)::int AS sales_count,
        COUNT(DISTINCT cp.customer_id)::int AS buyer_count,
        COALESCE(SUM(COALESCE(p.price_thb, 0)), 0)::int AS revenue_thb
      FROM customer_packages cp
      JOIN packages p ON p.id = cp.package_id
      LEFT JOIN customers c ON c.id = cp.customer_id
      WHERE DATE(cp.purchased_at AT TIME ZONE 'Asia/Bangkok') BETWEEN $1 AND $2
        AND NOT (COALESCE(c.full_name, '') ~* $3)
      GROUP BY COALESCE(p.price_thb, 0)
      ORDER BY COALESCE(p.price_thb, 0) ASC
    `,
    [startDate, endDate, TEST_RECORD_REGEX_SQL]
  );

  const knownBuckets = new Map(
    [399, 999, 2999].map((price) => [
      price,
      {
        bucket: String(price),
        label: `${price.toLocaleString('th-TH')} บาท`,
        price_thb: price,
        sales_count: 0,
        buyer_count: 0,
        revenue_thb: 0,
      },
    ])
  );
  const otherBucket = {
    bucket: 'other',
    label: 'ราคาอื่น',
    price_thb: null,
    sales_count: 0,
    buyer_count: 0,
    revenue_thb: 0,
  };

  for (const row of result.rows || []) {
    const price = toInt(row.price_thb);
    const target = knownBuckets.get(price) || otherBucket;
    target.sales_count += toInt(row.sales_count);
    target.buyer_count += toInt(row.buyer_count);
    target.revenue_thb += toInt(row.revenue_thb);
  }

  const rows = [...knownBuckets.values()];
  if (otherBucket.sales_count > 0 || otherBucket.revenue_thb > 0) {
    rows.push(otherBucket);
  }

  const totals = rows.reduce(
    (acc, row) => {
      acc.sales_count += row.sales_count;
      acc.buyer_count += row.buyer_count;
      acc.revenue_thb += row.revenue_thb;
      return acc;
    },
    { sales_count: 0, buyer_count: 0, revenue_thb: 0 }
  );

  return {
    rows,
    total_sales_count: totals.sales_count,
    total_buyer_count: totals.buyer_count,
    total_revenue_thb: totals.revenue_thb,
  };
}

async function fetchStaffPerformanceRows(queryFn, { startDate, endDate }) {
  const result = await queryFn(
    `
      SELECT
        COALESCE(NULLIF(staff_evt.staff_name, ''), 'ไม่ระบุพนักงาน') AS staff_name,
        COUNT(*)::int AS total_appointments,
        SUM(CASE WHEN LOWER(COALESCE(a.status, '')) = 'completed' THEN 1 ELSE 0 END)::int AS completed_count,
        SUM(
          CASE
            WHEN LOWER(COALESCE(a.status, '')) IN ('cancelled', 'canceled') THEN 1
            ELSE 0
          END
        )::int AS cancelled_count,
        SUM(
          CASE
            WHEN LOWER(COALESCE(a.status, '')) IN ('no_show', 'no-show', 'noshow') THEN 1
            ELSE 0
          END
        )::int AS no_show_count
      FROM appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      ${STAFF_NAME_LATERAL_SQL}
      WHERE DATE(a.scheduled_at AT TIME ZONE 'Asia/Bangkok') BETWEEN $1 AND $2
        AND NOT (
          COALESCE(c.full_name, '') ~* $3
          OR COALESCE(a.line_user_id, '') ~* $3
        )
      GROUP BY COALESCE(NULLIF(staff_evt.staff_name, ''), 'ไม่ระบุพนักงาน')
      ORDER BY completed_count DESC, total_appointments DESC, staff_name ASC
    `,
    [startDate, endDate, TEST_RECORD_REGEX_SQL]
  );

  const totalCompleted = (result.rows || []).reduce((sum, row) => sum + toInt(row.completed_count), 0);

  return (result.rows || []).map((row) => {
    const totalAppointments = toInt(row.total_appointments);
    const completedCount = toInt(row.completed_count);
    const cancelledCount = toInt(row.cancelled_count);
    const noShowCount = toInt(row.no_show_count);
    return {
      staff_name: normalizeText(row.staff_name) || 'ไม่ระบุพนักงาน',
      total_appointments: totalAppointments,
      completed_count: completedCount,
      cancelled_count: cancelledCount,
      no_show_count: noShowCount,
      completion_rate_pct: toRate(completedCount, totalAppointments),
      share_of_completed_pct: toRate(completedCount, totalCompleted),
    };
  });
}

async function fetchCourseRedemptionSummary(queryFn, { startDate, endDate }) {
  const summaryResult = await queryFn(
    `
      SELECT
        COUNT(*)::int AS total_redemptions,
        COUNT(DISTINCT pu.customer_package_id)::int AS packages_used_count,
        SUM(CASE WHEN pu.used_mask IS TRUE THEN 1 ELSE 0 END)::int AS mask_redemptions_count
      FROM package_usages pu
      JOIN customer_packages cp ON cp.id = pu.customer_package_id
      LEFT JOIN customers c ON c.id = cp.customer_id
      WHERE DATE(pu.used_at AT TIME ZONE 'Asia/Bangkok') BETWEEN $1 AND $2
        AND NOT (COALESCE(c.full_name, '') ~* $3)
    `,
    [startDate, endDate, TEST_RECORD_REGEX_SQL]
  );

  const completionResult = await queryFn(
    `
      WITH usage_rollup AS (
        SELECT
          cp.id AS customer_package_id,
          COALESCE(p.sessions_total, 0)::int AS sessions_total,
          COUNT(pu.id)::int AS sessions_used,
          MAX(pu.used_at) AS last_used_at
        FROM customer_packages cp
        JOIN packages p ON p.id = cp.package_id
        LEFT JOIN package_usages pu ON pu.customer_package_id = cp.id
        LEFT JOIN customers c ON c.id = cp.customer_id
        WHERE NOT (COALESCE(c.full_name, '') ~* $3)
        GROUP BY cp.id, COALESCE(p.sessions_total, 0)
      )
      SELECT
        COUNT(*)::int AS packages_completed_count
      FROM usage_rollup ur
      WHERE ur.sessions_total > 0
        AND ur.sessions_used >= ur.sessions_total
        AND ur.last_used_at IS NOT NULL
        AND DATE(ur.last_used_at AT TIME ZONE 'Asia/Bangkok') BETWEEN $1 AND $2
    `,
    [startDate, endDate, TEST_RECORD_REGEX_SQL]
  );

  const topPackagesResult = await queryFn(
    `
      SELECT
        COALESCE(NULLIF(p.title, ''), NULLIF(p.code, ''), 'ไม่ระบุคอร์ส') AS package_label,
        COUNT(*)::int AS redemptions_count,
        COUNT(DISTINCT pu.customer_package_id)::int AS packages_used_count
      FROM package_usages pu
      JOIN customer_packages cp ON cp.id = pu.customer_package_id
      JOIN packages p ON p.id = cp.package_id
      LEFT JOIN customers c ON c.id = cp.customer_id
      WHERE DATE(pu.used_at AT TIME ZONE 'Asia/Bangkok') BETWEEN $1 AND $2
        AND NOT (COALESCE(c.full_name, '') ~* $3)
      GROUP BY COALESCE(NULLIF(p.title, ''), NULLIF(p.code, ''), 'ไม่ระบุคอร์ส')
      ORDER BY redemptions_count DESC, package_label ASC
      LIMIT 5
    `,
    [startDate, endDate, TEST_RECORD_REGEX_SQL]
  );

  const summaryRow = summaryResult.rows?.[0] || {};
  const completionRow = completionResult.rows?.[0] || {};

  return {
    total_redemptions: toInt(summaryRow.total_redemptions),
    packages_used_count: toInt(summaryRow.packages_used_count),
    mask_redemptions_count: toInt(summaryRow.mask_redemptions_count),
    packages_completed_count: toInt(completionRow.packages_completed_count),
    top_packages: (topPackagesResult.rows || []).map((row) => ({
      package_label: normalizeText(row.package_label) || 'ไม่ระบุคอร์ส',
      redemptions_count: toInt(row.redemptions_count),
      packages_used_count: toInt(row.packages_used_count),
    })),
  };
}

async function fetchRepurchaseSummary(queryFn, { startDate, endDate }) {
  const result = await queryFn(
    `
      WITH monthly_buyers AS (
        SELECT DISTINCT cp.customer_id
        FROM customer_packages cp
        LEFT JOIN customers c ON c.id = cp.customer_id
        WHERE DATE(cp.purchased_at AT TIME ZONE 'Asia/Bangkok') BETWEEN $1 AND $2
          AND NOT (COALESCE(c.full_name, '') ~* $3)
      ),
      repeat_buyers AS (
        SELECT mb.customer_id
        FROM monthly_buyers mb
        WHERE EXISTS (
          SELECT 1
          FROM customer_packages cp_prev
          WHERE cp_prev.customer_id = mb.customer_id
            AND DATE(cp_prev.purchased_at AT TIME ZONE 'Asia/Bangkok') < $1
        )
      )
      SELECT
        (SELECT COUNT(*)::int FROM monthly_buyers) AS unique_buyers_count,
        (SELECT COUNT(*)::int FROM repeat_buyers) AS repeat_buyers_count
    `,
    [startDate, endDate, TEST_RECORD_REGEX_SQL]
  );

  const row = result.rows?.[0] || {};
  const uniqueBuyersCount = toInt(row.unique_buyers_count);
  const repeatBuyersCount = toInt(row.repeat_buyers_count);

  return {
    unique_buyers_count: uniqueBuyersCount,
    repeat_buyers_count: repeatBuyersCount,
    first_time_buyers_count: Math.max(uniqueBuyersCount - repeatBuyersCount, 0),
    repurchase_rate_pct: toRate(repeatBuyersCount, uniqueBuyersCount),
  };
}

async function fetchReceiptFallbackSummary(queryFn, { startDate, endDate }) {
  const result = await queryFn(
    `
      SELECT
        COUNT(*)::int AS receipt_count,
        COALESCE(SUM(COALESCE(ar.total_amount_thb, 0)), 0)::numeric(12, 2) AS receipt_total_amount_thb
      FROM appointment_receipts ar
      JOIN appointments a ON a.id = ar.appointment_id
      LEFT JOIN customers c ON c.id = a.customer_id
      WHERE DATE(a.scheduled_at AT TIME ZONE 'Asia/Bangkok') BETWEEN $1 AND $2
        AND NOT (
          COALESCE(c.full_name, '') ~* $3
          OR COALESCE(a.line_user_id, '') ~* $3
        )
    `,
    [startDate, endDate, TEST_RECORD_REGEX_SQL]
  );

  const row = result.rows?.[0] || {};
  return {
    receipt_count: toInt(row.receipt_count),
    receipt_total_amount_thb: toMoney(row.receipt_total_amount_thb),
  };
}

export async function getMonthlyKpiDashboardReport({
  month,
  now = new Date(),
  queryFn,
} = {}) {
  if (typeof queryFn !== 'function') {
    throw new Error('queryFn is required');
  }

  const period = resolveDashboardMonthRange(month, now);
  const [
    appointmentOutcomeResult,
    courseSalesMixResult,
    staffRowsResult,
    courseRedemptionResult,
    repurchaseResult,
    receiptFallbackResult,
  ] = await Promise.all([
    readSectionSafely({
      sectionKey: 'appointment_outcomes',
      title: 'ภาพรวมสถานะนัดหมาย',
      month: period.month,
      run: async () => {
        const [overview, dailyRows] = await Promise.all([
          fetchAppointmentOverview(queryFn, period),
          fetchDailyOutcomeRows(queryFn, period),
        ]);
        return {
          overview,
          daily_rows: dailyRows,
        };
      },
    }),
    readSectionSafely({
      sectionKey: 'course_sales_mix',
      title: 'สัดส่วนยอดขายคอร์ส 399 / 999 / 2999',
      month: period.month,
      run: async () => fetchCourseSalesRows(queryFn, period),
    }),
    readSectionSafely({
      sectionKey: 'staff_utilization',
      title: 'การใช้กำลังคนพนักงาน',
      month: period.month,
      run: async () => fetchStaffPerformanceRows(queryFn, period),
    }),
    readSectionSafely({
      sectionKey: 'course_redemption',
      title: 'การตัดคอร์ส / การปิดคอร์ส',
      month: period.month,
      run: async () => fetchCourseRedemptionSummary(queryFn, period),
    }),
    readSectionSafely({
      sectionKey: 'repurchase',
      title: 'การต่อคอร์ส / ซื้อซ้ำ',
      month: period.month,
      run: async () => fetchRepurchaseSummary(queryFn, period),
    }),
    readSectionSafely({
      sectionKey: 'revenue_mix_receipt_fallback',
      title: 'ข้อมูลทดแทนจากใบเสร็จ',
      month: period.month,
      run: async () => fetchReceiptFallbackSummary(queryFn, period),
    }),
  ]);

  const warnings = [
    appointmentOutcomeResult.warning,
    courseSalesMixResult.warning,
    staffRowsResult.warning,
    courseRedemptionResult.warning,
    repurchaseResult.warning,
    receiptFallbackResult.warning,
  ].filter(Boolean);

  const appointmentOverview = appointmentOutcomeResult.data?.overview || null;
  const dailyOutcomeRows = appointmentOutcomeResult.data?.daily_rows || [];
  const staffRows = staffRowsResult.data || [];
  const receiptFallback = receiptFallbackResult.data || null;

  const appointmentSection = appointmentOutcomeResult.ok
    ? {
        availability: 'available',
        title: appointmentOutcomeResult.title,
        ...appointmentOverview,
        daily_rows: dailyOutcomeRows,
      }
    : buildUnavailableSection({
        title: appointmentOutcomeResult.title,
        ...buildRecoverableSectionReason(appointmentOutcomeResult.error),
      });

  const noShowCancellationSection = appointmentOutcomeResult.ok
    ? {
        availability: 'available',
        title: 'No-show / Cancellation',
        no_show_count: appointmentOverview.no_show_count,
        cancelled_count: appointmentOverview.cancelled_count,
        no_show_rate_pct: appointmentOverview.no_show_rate_pct,
        cancellation_rate_pct: appointmentOverview.cancellation_rate_pct,
      }
    : buildUnavailableSection({
        title: 'No-show / Cancellation',
        ...buildRecoverableSectionReason(appointmentOutcomeResult.error),
      });

  const courseSalesSection = courseSalesMixResult.ok
    ? {
        availability: 'available',
        title: courseSalesMixResult.title,
        ...courseSalesMixResult.data,
      }
    : buildUnavailableSection({
        title: courseSalesMixResult.title,
        ...buildRecoverableSectionReason(courseSalesMixResult.error),
      });

  const staffUtilizationSection = staffRowsResult.ok
    ? {
        availability: 'proxy',
        title: staffRowsResult.title,
        note: 'คำนวณแบบ proxy จากจำนวนเคสที่พนักงานถูกระบุใน appointment_events เพราะระบบยังไม่มีตารางกะงานหรือชั่วโมงทำงานจริง',
        rows: staffRows,
      }
    : buildUnavailableSection({
        title: staffRowsResult.title,
        ...buildRecoverableSectionReason(staffRowsResult.error),
      });

  const courseRedemptionSection = courseRedemptionResult.ok
    ? {
        availability: 'available',
        title: courseRedemptionResult.title,
        ...courseRedemptionResult.data,
      }
    : buildUnavailableSection({
        title: courseRedemptionResult.title,
        ...buildRecoverableSectionReason(courseRedemptionResult.error),
      });

  const repurchaseSection = repurchaseResult.ok
    ? {
        availability: 'available',
        title: repurchaseResult.title,
        ...repurchaseResult.data,
      }
    : buildUnavailableSection({
        title: repurchaseResult.title,
        ...buildRecoverableSectionReason(repurchaseResult.error),
      });

  const revenueMixFallbackNote = receiptFallbackResult.ok
    ? null
    : buildRecoverableSectionReason(receiptFallbackResult.error).reason;

  const summaryCards = [
    appointmentOutcomeResult.ok
      ? buildCard({
          id: 'appointments_total',
          label: 'นัดหมายทั้งหมด',
          value: appointmentOverview.total_appointments,
          unit: 'นัด',
        })
      : buildCard({
          id: 'appointments_total',
          label: 'นัดหมายทั้งหมด',
          availability: 'unavailable',
          reason: buildRecoverableSectionReason(appointmentOutcomeResult.error).reason,
          note: buildRecoverableSectionReason(appointmentOutcomeResult.error).note,
        }),
    appointmentOutcomeResult.ok
      ? buildCard({
          id: 'completion_rate',
          label: 'อัตราเข้ารับบริการสำเร็จ',
          value: appointmentOverview.completion_rate_pct,
          unit: '%',
        })
      : buildCard({
          id: 'completion_rate',
          label: 'อัตราเข้ารับบริการสำเร็จ',
          availability: 'unavailable',
          reason: buildRecoverableSectionReason(appointmentOutcomeResult.error).reason,
          note: buildRecoverableSectionReason(appointmentOutcomeResult.error).note,
        }),
    courseSalesMixResult.ok
      ? buildCard({
          id: 'course_sales_total',
          label: 'ยอดขายคอร์ส',
          value: courseSalesMixResult.data.total_sales_count,
          unit: 'รายการ',
        })
      : buildCard({
          id: 'course_sales_total',
          label: 'ยอดขายคอร์ส',
          availability: 'unavailable',
          reason: buildRecoverableSectionReason(courseSalesMixResult.error).reason,
          note: buildRecoverableSectionReason(courseSalesMixResult.error).note,
        }),
    repurchaseResult.ok
      ? buildCard({
          id: 'repurchase_rate',
          label: 'อัตราซื้อซ้ำ',
          value: repurchaseResult.data.repurchase_rate_pct,
          unit: '%',
        })
      : buildCard({
          id: 'repurchase_rate',
          label: 'อัตราซื้อซ้ำ',
          availability: 'unavailable',
          reason: buildRecoverableSectionReason(repurchaseResult.error).reason,
          note: buildRecoverableSectionReason(repurchaseResult.error).note,
        }),
    courseRedemptionResult.ok
      ? buildCard({
          id: 'redemptions_total',
          label: 'การตัดคอร์ส',
          value: courseRedemptionResult.data.total_redemptions,
          unit: 'ครั้ง',
        })
      : buildCard({
          id: 'redemptions_total',
          label: 'การตัดคอร์ส',
          availability: 'unavailable',
          reason: buildRecoverableSectionReason(courseRedemptionResult.error).reason,
          note: buildRecoverableSectionReason(courseRedemptionResult.error).note,
        }),
    buildCard({
      id: 'free_scan_conversion',
      label: 'แปลงจากสแกนผิวฟรี',
      availability: 'unavailable',
      reason: 'ยังไม่มี field หรือ source ที่ระบุ free facial scan และผลลัพธ์การแปลงได้อย่างเชื่อถือได้ใน schema ปัจจุบัน',
    }),
  ];

  return {
    generated_at: now instanceof Date ? now.toISOString() : new Date().toISOString(),
    period,
    summary_cards: summaryCards,
    sections: {
      appointment_outcomes: appointmentSection,
      course_sales_mix: courseSalesSection,
      staff_utilization: staffUtilizationSection,
      no_show_cancellation: noShowCancellationSection,
      free_scan_conversion: buildNoDataSection({
        title: 'Free facial scan conversion',
        reason:
          'ยังไม่มีตาราง lead/source หรือ field ที่บอกชัดว่า appointment/customer รายใดมาจาก free facial scan จึงยังคำนวณ conversion funnel นี้ไม่ได้อย่างโปร่งใส',
      }),
      upsell_conversion: buildNoDataSection({
        title: 'Upsell conversion to skincare / products',
        reason:
          'ยังไม่มีตารางขายสินค้าแยกรายการหรือ field ที่บอกว่าใบเสร็จนี้มีการ upsell ผลิตภัณฑ์ จึงยังคำนวณ product upsell conversion ไม่ได้',
      }),
      revenue_mix: buildNoDataSection({
        title: 'Revenue mix (service vs product)',
        reason:
          'appointment_receipts มีเพียง total_amount_thb ระดับใบเสร็จ แต่ยังไม่มี itemized split ว่าเป็นรายได้บริการหรือรายได้สินค้า',
        fallback: receiptFallback,
        note: revenueMixFallbackNote,
      }),
      course_redemption: courseRedemptionSection,
      repurchase: repurchaseSection,
    },
    meta: {
      partial: warnings.length > 0,
      warning_count: warnings.length,
      unavailable_sections: warnings.map((warning) => warning.section),
      warnings,
      partial_note:
        warnings.length > 0
          ? 'บาง KPI ยังไม่พร้อมใน production แต่ระบบยังส่งข้อมูลส่วนที่อ่านได้กลับมาเพื่อไม่ให้ dashboard ล้มทั้งหน้า'
          : null,
    },
    assumptions: [
      'แดชบอร์ดนี้อ่านจากตาราง PostgreSQL ปัจจุบันแบบ SELECT-only และไม่เขียนกลับข้อมูลธุรกิจ',
      'การนับนัดหมายอิงเดือนจาก appointments.scheduled_at ตามเวลา Asia/Bangkok',
      'การขายคอร์สอิง customer_packages.purchased_at',
      'การตัดคอร์สอิง package_usages.used_at',
      'อัตราพนักงานเป็น proxy จากจำนวนเคสต่อพนักงาน ไม่ใช่ utilization ตามชั่วโมงทำงานจริง',
      'ตัวเลข test/e2e ถูกตัดออกด้วย pattern เดียวกับ queue/calendar ที่มีอยู่แล้วใน backend',
    ],
  };
}
