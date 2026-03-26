import { useEffect, useMemo, useRef, useState } from "react";
import { getMonthlyKpiDashboard } from "../utils/reportingApi";
import "./KpiDashboardPage.css";

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getCurrentYearKey() {
  return String(new Date().getFullYear());
}

const KPI_SCOPE_OPTIONS = [
  { value: "month", label: "รายเดือน" },
  { value: "year", label: "ปี" },
  { value: "all", label: "ภาพรวมทั้งหมด" },
];
const REPORT_EXPORT_OPTIONS = [
  {
    value: "pdf",
    label: "PDF (.pdf)",
    previewNote: "ไฟล์ PDF จะสร้างจากหน้า preview นี้ในขนาด A4 แนวนอน",
  },
  {
    value: "pptx",
    label: "Microsoft PowerPoint (.pptx)",
    previewNote: "ไฟล์ PowerPoint จะสร้างจากหน้า preview นี้เป็นสไลด์ภาษาไทยพร้อมนำเสนอ",
  },
];
const KPI_COMPARE_CACHE_TTL_MS = 60 * 1000;
const KPI_REPORT_CACHE = new Map();
const EMPTY_LIST = [];

function isMonthKey(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

function shiftMonthKey(monthKey, offset) {
  if (!isMonthKey(monthKey)) return "";
  const [yearText, monthText] = String(monthKey).split("-");
  const shifted = new Date(Number(yearText), Number(monthText) - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function formatThaiMonthScopeLabel(monthKey) {
  if (!isMonthKey(monthKey)) return monthKey;
  const [yearText, monthText] = String(monthKey).split("-");
  return new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" }).format(
    new Date(Number(yearText), Number(monthText) - 1, 1)
  );
}

function formatThaiYearScopeLabel(yearKey) {
  const parsed = Number(yearKey);
  if (!Number.isFinite(parsed)) return String(yearKey || "");
  return `ปี ${parsed + 543}`;
}

function buildReportRequestParams({ scope, month, year }) {
  const params = { scope };
  if (scope === "month" && month) {
    params.month = month;
  }
  if (scope === "year" && year) {
    params.year = year;
  }
  return params;
}

function buildReportCacheKey(params = {}) {
  return JSON.stringify({
    scope: params.scope || "month",
    month: params.month || "",
    year: params.year || "",
  });
}

async function loadCachedKpiReport(params, signal, { force = false } = {}) {
  const cacheKey = buildReportCacheKey(params);
  const cached = KPI_REPORT_CACHE.get(cacheKey);
  if (!force && cached && Date.now() - cached.fetchedAt < KPI_COMPARE_CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await getMonthlyKpiDashboard(params, signal);
  KPI_REPORT_CACHE.set(cacheKey, {
    data,
    fetchedAt: Date.now(),
  });
  return data;
}

function buildComparisonOptions({ scope, month, year }) {
  if (scope === "month" && isMonthKey(month)) {
    const previousMonth = shiftMonthKey(month, -1);
    const previousLabel = formatThaiMonthScopeLabel(previousMonth);
    return [
      {
        value: "previous_period",
        label: `เดือนก่อนหน้า (${previousLabel})`,
        emptyMessage: `ยังไม่มีข้อมูลใน ${previousLabel}`,
        params: {
          scope: "month",
          month: previousMonth,
        },
      },
    ];
  }

  if (scope === "year" && /^\d{4}$/.test(String(year || ""))) {
    const previousYear = String(Number(year) - 1);
    const previousLabel = formatThaiYearScopeLabel(previousYear);
    return [
      {
        value: "previous_period",
        label: `ปีก่อนหน้า (${previousLabel})`,
        emptyMessage: `ยังไม่มีข้อมูลใน ${previousLabel}`,
        params: {
          scope: "year",
          year: previousYear,
        },
      },
    ];
  }

  return [];
}

function hasReportActivity(report) {
  if (!report) return false;
  const summaryCards = Array.isArray(report.summary_cards) ? report.summary_cards : [];
  if (summaryCards.some((card) => card?.availability === "available" && Number(card?.value) > 0)) {
    return true;
  }

  return Boolean(
    Number(report?.sections?.appointment_outcomes?.total_appointments) > 0 ||
      Number(report?.sections?.course_sales_mix?.total_sales_count) > 0 ||
      Number(report?.sections?.course_redemption?.total_redemptions) > 0 ||
      Number(report?.sections?.repurchase?.unique_buyers_count) > 0
  );
}

function buildRowLookup(rows = [], keyField) {
  return new Map(
    rows
      .map((row) => [String(row?.[keyField] ?? ""), row])
      .filter(([key]) => key)
  );
}

function calculateComparisonDelta(currentValue, previousValue) {
  const current = Number(currentValue);
  const previous = Number(previousValue);

  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;

  if (previous === 0) {
    if (current === 0) {
      return { direction: "flat", label: "0%" };
    }
    return {
      direction: current > 0 ? "up" : "down",
      label: "ใหม่",
    };
  }

  const deltaPct = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(deltaPct)) return null;

  const rounded = Math.round(Math.abs(deltaPct) * 10) / 10;
  if (rounded === 0) {
    return { direction: "flat", label: "0%" };
  }

  return {
    direction: deltaPct > 0 ? "up" : "down",
    label: `${rounded.toLocaleString("th-TH", {
      minimumFractionDigits: rounded % 1 === 0 ? 0 : 1,
      maximumFractionDigits: 1,
    })}%`,
  };
}

function chunkRows(rows = [], size = 8) {
  if (!Array.isArray(rows) || !rows.length) {
    return [[]];
  }

  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function formatGeneratedAtLabel(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function buildReportFilename(report, format = "pdf") {
  const period = report?.period || {};
  const suffix =
    period.scope === "year"
      ? `year-${period.year || "report"}`
      : period.scope === "all"
        ? "all-time"
        : period.month || "monthly";
  return `kpi-dashboard-${suffix}.${format}`;
}

function getReportExportOption(format) {
  return REPORT_EXPORT_OPTIONS.find((option) => option.value === format) || REPORT_EXPORT_OPTIONS[0];
}

function fitContentWithinBox(sourceWidth, sourceHeight, maxWidth, maxHeight) {
  const ratio = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: sourceWidth * ratio,
    height: sourceHeight * ratio,
  };
}

async function capturePreviewPages(container) {
  const pageNodes = Array.from(container?.querySelectorAll?.("[data-kpi-report-page='true']") || []);
  if (!pageNodes.length) {
    throw new Error("ไม่พบหน้ารายงานสำหรับสร้างไฟล์");
  }

  const { default: html2canvas } = await import("html2canvas");
  const pages = [];

  for (const pageNode of pageNodes) {
    const canvas = await html2canvas(pageNode, {
      backgroundColor: "#f3ebe2",
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: pageNode.scrollWidth,
      windowHeight: pageNode.scrollHeight,
    });

    pages.push({
      canvas,
      imageData: canvas.toDataURL("image/png"),
    });
  }

  return pages;
}

async function exportPreviewPagesToPdf(container, filename) {
  const pages = await capturePreviewPages(container);
  const { jsPDF } = await import("jspdf");

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;

  for (const [index, page] of pages.entries()) {
    const renderSize = fitContentWithinBox(
      page.canvas.width,
      page.canvas.height,
      pageWidth - margin * 2,
      pageHeight - margin * 2
    );
    const renderWidth = renderSize.width;
    const renderHeight = renderSize.height;
    const offsetX = (pageWidth - renderWidth) / 2;
    const offsetY = (pageHeight - renderHeight) / 2;

    if (index > 0) {
      pdf.addPage("a4", "landscape");
    }

    pdf.addImage(page.imageData, "PNG", offsetX, offsetY, renderWidth, renderHeight, undefined, "FAST");
  }

  pdf.save(filename);
}

async function exportPreviewPagesToPowerPoint(container, filename) {
  const pages = await capturePreviewPages(container);
  const { default: PptxGenJS } = await import("pptxgenjs");

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "KPI_A4_LANDSCAPE", width: 11.69, height: 8.27 });
  pptx.layout = "KPI_A4_LANDSCAPE";
  pptx.author = "scGlamLiff KPI Dashboard";
  pptx.company = "scGlamLiff";
  pptx.subject = "KPI Dashboard Report";
  pptx.title = filename.replace(/\.pptx$/i, "");
  pptx.lang = "th-TH";

  const pageWidth = 11.69;
  const pageHeight = 8.27;
  const margin = 0.18;

  for (const page of pages) {
    const slide = pptx.addSlide();
    slide.background = { color: "F3EBE2" };
    const renderSize = fitContentWithinBox(
      page.canvas.width,
      page.canvas.height,
      pageWidth - margin * 2,
      pageHeight - margin * 2
    );
    const offsetX = (pageWidth - renderSize.width) / 2;
    const offsetY = (pageHeight - renderSize.height) / 2;

    slide.addImage({
      data: page.imageData,
      x: offsetX,
      y: offsetY,
      w: renderSize.width,
      h: renderSize.height,
    });
  }

  await pptx.writeFile({ fileName: filename });
}

function formatNumber(value) {
  return new Intl.NumberFormat("th-TH").format(Number(value) || 0);
}

function formatMoney(value) {
  return `${new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)} บาท`;
}

function formatPercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0%";
  return `${parsed.toLocaleString("th-TH", {
    minimumFractionDigits: parsed % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatCardValue(card) {
  if (card.availability !== "available" || card.value === null || card.value === undefined) {
    return "ยังไม่มีข้อมูล";
  }
  if (card.unit === "%") return formatPercent(card.value);
  return `${formatNumber(card.value)}${card.unit ? ` ${card.unit}` : ""}`;
}

function formatSectionValue(section, value, formatter, emptyLabel = "ยังไม่มีข้อมูล") {
  if (section?.availability === "unavailable" || value === null || value === undefined) {
    return emptyLabel;
  }
  return formatter(value);
}

function metricToneClass(availability) {
  if (availability === "proxy") return "is-proxy";
  if (availability === "fallback") return "is-proxy";
  if (availability === "unavailable") return "is-unavailable";
  return "is-available";
}

function AvailabilityBadge({ availability = "available" }) {
  const label =
    availability === "proxy"
      ? "ใช้ค่าแทน"
      : availability === "fallback"
        ? "มีข้อมูลทดแทน"
      : availability === "unavailable"
        ? "ยังไม่พร้อม"
        : "พร้อมใช้";
  return <span className={`kpi-badge ${metricToneClass(availability)}`}>{label}</span>;
}

function ComparisonArrow({ direction }) {
  if (direction === "flat") return null;
  return (
    <svg
      className={`kpi-delta-arrow is-${direction}`}
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 1 11 6H8v5H4V6H1z" />
    </svg>
  );
}

function ComparisonDelta({ enabled = false, currentValue, previousValue, compact = false }) {
  if (!enabled) return null;
  const delta = calculateComparisonDelta(currentValue, previousValue);
  if (!delta) return null;

  return (
    <span className={`kpi-delta is-${delta.direction} ${compact ? "is-compact" : ""}`}>
      <ComparisonArrow direction={delta.direction} />
      <span>{delta.label}</span>
    </span>
  );
}

function MetricWithComparison({
  enabled = false,
  currentValue,
  previousValue,
  compact = false,
  className = "",
  children,
}) {
  if (!enabled) return children;

  const delta = (
    <ComparisonDelta
      enabled={enabled}
      currentValue={currentValue}
      previousValue={previousValue}
      compact={compact}
    />
  );

  if (!delta) return children;

  return <span className={`kpi-metric-with-delta ${className}`.trim()}>{children}{delta}</span>;
}

function SummaryCard({ card, comparisonCard, compareEnabled = false }) {
  return (
    <article className={`kpi-summary-card ${metricToneClass(card.availability)}`}>
      <div className="kpi-summary-top">
        <p>{card.label}</p>
        <AvailabilityBadge availability={card.availability} />
      </div>
      <MetricWithComparison
        enabled={compareEnabled && card.availability === "available"}
        currentValue={card.value}
        previousValue={comparisonCard?.availability === "available" ? comparisonCard?.value : null}
        className="kpi-summary-metric"
      >
        <strong>{formatCardValue(card)}</strong>
      </MetricWithComparison>
      {card.reason ? <small>{card.reason}</small> : null}
      {card.note ? <small>{card.note}</small> : null}
    </article>
  );
}

function MiniStatValue({ valueText, currentValue, previousValue, compareEnabled = false }) {
  return (
    <MetricWithComparison
      enabled={compareEnabled}
      currentValue={currentValue}
      previousValue={previousValue}
      className="kpi-mini-stat-metric"
    >
      <strong>{valueText}</strong>
    </MetricWithComparison>
  );
}

function TableMetricValue({ valueText, currentValue, previousValue, compareEnabled = false }) {
  return (
    <MetricWithComparison
      enabled={compareEnabled}
      currentValue={currentValue}
      previousValue={previousValue}
      compact
      className="kpi-table-metric"
    >
      <span>{valueText}</span>
    </MetricWithComparison>
  );
}

function PanelTitleMetric({ valueText, currentValue, previousValue, compareEnabled = false }) {
  return (
    <MetricWithComparison
      enabled={compareEnabled}
      currentValue={currentValue}
      previousValue={previousValue}
      className="kpi-panel-title-metric"
    >
      <strong>{valueText}</strong>
    </MetricWithComparison>
  );
}

function ReportPageShell({
  pageNumber,
  totalPages,
  periodLabel,
  periodNote,
  generatedAtText,
  comparisonLabel,
  children,
}) {
  return (
    <section className="kpi-report-preview-page" data-kpi-report-page="true">
      <div className="kpi-report-page-header">
        <div className="kpi-report-page-title-block">
          <span>KPI Dashboard</span>
          <h3>รายงานสรุปสำหรับผู้บริหาร</h3>
          <p>{periodNote}</p>
        </div>
        <div className="kpi-report-page-meta">
          <strong>{periodLabel}</strong>
          <small>{comparisonLabel || "ไม่แสดงข้อมูลเปรียบเทียบ"}</small>
          <small>สร้างเมื่อ {generatedAtText}</small>
        </div>
      </div>

      <div className="kpi-report-page-body">{children}</div>

      <div className="kpi-report-page-footer">
        <span>A4 Landscape Export</span>
        <strong>หน้า {pageNumber} / {totalPages}</strong>
      </div>
    </section>
  );
}

function KpiReportPreviewModal({
  open,
  exportFormatLabel,
  exportPreviewNote,
  report,
  reportMeta,
  sections,
  comparisonSections,
  headlineSummaryCards,
  comparisonCardLookup,
  comparisonSalesLookup,
  comparisonStaffLookup,
  comparisonRedemptionLookup,
  salesRows,
  staffChunks,
  redemptionChunks,
  periodLabel,
  periodNote,
  timelineGranularity,
  comparisonActive,
  comparisonLabel,
  generatedAtText,
  previewRef,
  onClose,
  onConfirm,
  downloading,
  exportError,
}) {
  if (!open || !report) return null;

  const totalPages = 1 + staffChunks.length + redemptionChunks.length;
  const comparisonAppointmentOutcomes = comparisonSections?.appointment_outcomes;
  const comparisonNoShowCancellation = comparisonSections?.no_show_cancellation;
  const comparisonCourseSalesMix = comparisonSections?.course_sales_mix;
  const comparisonCourseRedemption = comparisonSections?.course_redemption;
  const comparisonRepurchase = comparisonSections?.repurchase;
  const partialWarnings = Array.isArray(reportMeta?.warnings) ? reportMeta.warnings : [];

  return (
    <div className="kpi-report-modal-backdrop" onClick={onClose}>
      <div
        className="kpi-report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kpi-report-preview-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="kpi-report-modal-header">
          <div>
            <strong id="kpi-report-preview-title">ตัวอย่างรายงานก่อนดาวน์โหลด</strong>
            <small>{exportPreviewNote}</small>
          </div>
          <button type="button" className="kpi-report-modal-close" onClick={onClose}>
            ปิด
          </button>
        </div>

        <div className="kpi-report-preview-shell" ref={previewRef}>
          <ReportPageShell
            pageNumber={1}
            totalPages={totalPages}
            periodLabel={periodLabel}
            periodNote={periodNote}
            generatedAtText={generatedAtText}
            comparisonLabel={comparisonLabel}
          >
            {reportMeta?.partial ? (
              <article className="panel" role="status" aria-live="polite">
                <div className="panel-title">
                  <span>บาง KPI ยังอ่านได้ไม่ครบ</span>
                  <strong>{reportMeta.warning_count || partialWarnings.length} ส่วน</strong>
                </div>
                <p className="kpi-section-note">{reportMeta.partial_note || "ระบบกำลังแสดงเฉพาะส่วนที่อ่านได้ก่อน"}</p>
                {partialWarnings.length ? (
                  <ul className="kpi-assumption-list">
                    {partialWarnings.map((warning) => (
                      <li key={`${warning.section}-${warning.reason}`}>
                        <strong>{warning.title || warning.section}</strong> {warning.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ) : null}

            <div className="kpi-summary-grid kpi-summary-grid--report" aria-label="KPI summary cards">
              {headlineSummaryCards.map((card) => (
                <SummaryCard
                  key={`report-${card.id}`}
                  card={card}
                  comparisonCard={comparisonCardLookup.get(card.id)}
                  compareEnabled={comparisonActive}
                />
              ))}
            </div>

            <div className="kpi-report-two-column kpi-report-two-column--equal">
              <article className="panel kpi-report-panel">
                <div className="panel-title">
                  <span>{sections.appointment_outcomes?.title || "ภาพรวมสถานะนัดหมาย"}</span>
                  <strong>{periodLabel}</strong>
                </div>
                <SectionStatusNote section={sections.appointment_outcomes} />
                <div className="kpi-mini-stats">
                  <div>
                    <small>สำเร็จแล้ว</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.appointment_outcomes,
                        sections.appointment_outcomes?.completed_count,
                        formatNumber
                      )}
                      currentValue={sections.appointment_outcomes?.completed_count}
                      previousValue={comparisonAppointmentOutcomes?.completed_count}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                  <div>
                    <small>No-show</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.no_show_cancellation,
                        sections.no_show_cancellation?.no_show_rate_pct,
                        formatPercent
                      )}
                      currentValue={sections.no_show_cancellation?.no_show_rate_pct}
                      previousValue={comparisonNoShowCancellation?.no_show_rate_pct}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                  <div>
                    <small>ยกเลิก</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.no_show_cancellation,
                        sections.no_show_cancellation?.cancellation_rate_pct,
                        formatPercent
                      )}
                      currentValue={sections.no_show_cancellation?.cancellation_rate_pct}
                      previousValue={comparisonNoShowCancellation?.cancellation_rate_pct}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                </div>
                <DailyOutcomeChart
                  rows={sections.appointment_outcomes?.daily_rows || []}
                  granularity={timelineGranularity}
                  emptyMessage={sections.appointment_outcomes?.reason || "ยังไม่มีนัดหมายในช่วงที่เลือก"}
                />
                <div className="kpi-legend">
                  <span><i className="seg-completed" /> สำเร็จ</span>
                  <span><i className="seg-cancelled" /> ยกเลิก</span>
                  <span><i className="seg-no-show" /> No-show</span>
                  <span><i className="seg-other" /> สถานะอื่น</span>
                </div>
              </article>

              <article className="panel kpi-report-panel">
                <div className="panel-title">
                  <span>{sections.course_sales_mix?.title || "สัดส่วนยอดขายคอร์ส"}</span>
                  <PanelTitleMetric
                    valueText={formatSectionValue(
                      sections.course_sales_mix,
                      sections.course_sales_mix?.total_revenue_thb,
                      formatMoney
                    )}
                    currentValue={sections.course_sales_mix?.total_revenue_thb}
                    previousValue={comparisonCourseSalesMix?.total_revenue_thb}
                    compareEnabled={comparisonActive}
                  />
                </div>
                <SectionStatusNote section={sections.course_sales_mix} />
                <HorizontalBars
                  rows={salesRows}
                  valueField="sales_count"
                  labelField="label"
                  rowKeyField="bucket"
                  formatter={(value) => `${formatNumber(value)} รายการ`}
                  emptyMessage={sections.course_sales_mix?.reason || "ยังไม่พบการขายคอร์สในช่วงที่เลือก"}
                  compareEnabled={comparisonActive}
                  comparisonLookup={comparisonSalesLookup}
                />
                <div className="kpi-simple-table-wrap">
                  <table className="kpi-simple-table">
                    <thead>
                      <tr>
                        <th>ราคา</th>
                        <th>ขายได้</th>
                        <th>ผู้ซื้อ</th>
                        <th>ยอดรวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesRows.map((row) => (
                        <tr key={`report-sales-${row.bucket}`}>
                          <td>{row.label}</td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.sales_count)}
                              currentValue={row.sales_count}
                              previousValue={comparisonSalesLookup.get(row.bucket)?.sales_count}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.buyer_count)}
                              currentValue={row.buyer_count}
                              previousValue={comparisonSalesLookup.get(row.bucket)?.buyer_count}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatMoney(row.revenue_thb)}
                              currentValue={row.revenue_thb}
                              previousValue={comparisonSalesLookup.get(row.bucket)?.revenue_thb}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          </ReportPageShell>

          {staffChunks.map((staffChunk, index) => (
            <ReportPageShell
              key={`staff-page-${index}`}
              pageNumber={index + 2}
              totalPages={totalPages}
              periodLabel={periodLabel}
              periodNote={periodNote}
              generatedAtText={generatedAtText}
              comparisonLabel={comparisonLabel}
            >
              <article className="panel">
                <div className="panel-title">
                  <span>{sections.staff_utilization?.title || "การใช้กำลังคนพนักงาน"}</span>
                  <strong>
                    {staffChunks.length > 1
                      ? `ชุด ${index + 1}/${staffChunks.length}`
                      : sections.staff_utilization?.availability === "proxy"
                        ? "Proxy"
                        : "พร้อมใช้"}
                  </strong>
                </div>
                <SectionStatusNote section={sections.staff_utilization} />
                <div className="kpi-simple-table-wrap">
                  <table className="kpi-simple-table">
                    <thead>
                      <tr>
                        <th>พนักงาน</th>
                        <th>เคสทั้งหมด</th>
                        <th>สำเร็จ</th>
                        <th>No-show</th>
                        <th>ยกเลิก</th>
                        <th>อัตราสำเร็จ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffChunk.map((row) => (
                        <tr key={`report-staff-${index}-${row.staff_name}`}>
                          <td>{row.staff_name}</td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.total_appointments)}
                              currentValue={row.total_appointments}
                              previousValue={comparisonStaffLookup.get(row.staff_name)?.total_appointments}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.completed_count)}
                              currentValue={row.completed_count}
                              previousValue={comparisonStaffLookup.get(row.staff_name)?.completed_count}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.no_show_count)}
                              currentValue={row.no_show_count}
                              previousValue={comparisonStaffLookup.get(row.staff_name)?.no_show_count}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.cancelled_count)}
                              currentValue={row.cancelled_count}
                              previousValue={comparisonStaffLookup.get(row.staff_name)?.cancelled_count}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatPercent(row.completion_rate_pct)}
                              currentValue={row.completion_rate_pct}
                              previousValue={comparisonStaffLookup.get(row.staff_name)?.completion_rate_pct}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </ReportPageShell>
          ))}

          {redemptionChunks.map((redemptionChunk, index) => {
            const isLastRedemptionPage = index === redemptionChunks.length - 1;
            const pageNumber = staffChunks.length + index + 2;

            return (
              <ReportPageShell
                key={`redemption-page-${index}`}
                pageNumber={pageNumber}
                totalPages={totalPages}
                periodLabel={periodLabel}
                periodNote={periodNote}
                generatedAtText={generatedAtText}
                comparisonLabel={comparisonLabel}
              >
                <div
                  className={`kpi-report-two-column kpi-report-two-column--equal ${isLastRedemptionPage ? "" : "is-single-column"}`.trim()}
                >
                  <article className="panel kpi-report-panel">
                    <div className="panel-title">
                      <span>{sections.course_redemption?.title || "การตัดคอร์ส / การปิดคอร์ส"}</span>
                      <PanelTitleMetric
                        valueText={formatSectionValue(
                          sections.course_redemption,
                          sections.course_redemption?.total_redemptions,
                          (value) => `${formatNumber(value)} ครั้ง`
                        )}
                        currentValue={sections.course_redemption?.total_redemptions}
                        previousValue={comparisonCourseRedemption?.total_redemptions}
                        compareEnabled={comparisonActive}
                      />
                    </div>
                    <SectionStatusNote section={sections.course_redemption} />
                    <div className="kpi-mini-stats">
                      <div>
                        <small>ตัดคอร์สทั้งหมด</small>
                        <MiniStatValue
                          valueText={formatSectionValue(
                            sections.course_redemption,
                            sections.course_redemption?.total_redemptions,
                            formatNumber
                          )}
                          currentValue={sections.course_redemption?.total_redemptions}
                          previousValue={comparisonCourseRedemption?.total_redemptions}
                          compareEnabled={comparisonActive}
                        />
                      </div>
                      <div>
                        <small>ลูกค้าที่ถูกตัดคอร์ส</small>
                        <MiniStatValue
                          valueText={formatSectionValue(
                            sections.course_redemption,
                            sections.course_redemption?.packages_used_count,
                            formatNumber
                          )}
                          currentValue={sections.course_redemption?.packages_used_count}
                          previousValue={comparisonCourseRedemption?.packages_used_count}
                          compareEnabled={comparisonActive}
                        />
                      </div>
                      <div>
                        <small>ปิดคอร์สในเดือนนี้</small>
                        <MiniStatValue
                          valueText={formatSectionValue(
                            sections.course_redemption,
                            sections.course_redemption?.packages_completed_count,
                            formatNumber
                          )}
                          currentValue={sections.course_redemption?.packages_completed_count}
                          previousValue={comparisonCourseRedemption?.packages_completed_count}
                          compareEnabled={comparisonActive}
                        />
                      </div>
                      <div>
                        <small>ใช้ Mask</small>
                        <MiniStatValue
                          valueText={formatSectionValue(
                            sections.course_redemption,
                            sections.course_redemption?.mask_redemptions_count,
                            formatNumber
                          )}
                          currentValue={sections.course_redemption?.mask_redemptions_count}
                          previousValue={comparisonCourseRedemption?.mask_redemptions_count}
                          compareEnabled={comparisonActive}
                        />
                      </div>
                    </div>
                    <HorizontalBars
                      rows={redemptionChunk}
                      valueField="redemptions_count"
                      labelField="package_label"
                      formatter={(value) => `${formatNumber(value)} ครั้ง`}
                      emptyMessage={sections.course_redemption?.reason || "ยังไม่พบประวัติการตัดคอร์สในช่วงที่เลือก"}
                      compareEnabled={comparisonActive}
                      comparisonLookup={comparisonRedemptionLookup}
                    />
                  </article>

                  {isLastRedemptionPage ? (
                    <article className="panel kpi-report-panel">
                      <div className="panel-title">
                        <span>{sections.repurchase?.title || "การซื้อซ้ำ"}</span>
                        <PanelTitleMetric
                          valueText={formatSectionValue(
                            sections.repurchase,
                            sections.repurchase?.repurchase_rate_pct,
                            formatPercent
                          )}
                          currentValue={sections.repurchase?.repurchase_rate_pct}
                          previousValue={comparisonRepurchase?.repurchase_rate_pct}
                          compareEnabled={comparisonActive}
                        />
                      </div>
                      <SectionStatusNote section={sections.repurchase} />
                      <div className="kpi-mini-stats">
                        <div>
                          <small>ลูกค้าที่ซื้อคอร์สเดือนนี้</small>
                          <MiniStatValue
                            valueText={formatSectionValue(
                              sections.repurchase,
                              sections.repurchase?.unique_buyers_count,
                              formatNumber
                            )}
                            currentValue={sections.repurchase?.unique_buyers_count}
                            previousValue={comparisonRepurchase?.unique_buyers_count}
                            compareEnabled={comparisonActive}
                          />
                        </div>
                        <div>
                          <small>ซื้อซ้ำ / ต่อคอร์ส</small>
                          <MiniStatValue
                            valueText={formatSectionValue(
                              sections.repurchase,
                              sections.repurchase?.repeat_buyers_count,
                              formatNumber
                            )}
                            currentValue={sections.repurchase?.repeat_buyers_count}
                            previousValue={comparisonRepurchase?.repeat_buyers_count}
                            compareEnabled={comparisonActive}
                          />
                        </div>
                        <div>
                          <small>ลูกค้าใหม่</small>
                          <MiniStatValue
                            valueText={formatSectionValue(
                              sections.repurchase,
                              sections.repurchase?.first_time_buyers_count,
                              formatNumber
                            )}
                            currentValue={sections.repurchase?.first_time_buyers_count}
                            previousValue={comparisonRepurchase?.first_time_buyers_count}
                            compareEnabled={comparisonActive}
                          />
                        </div>
                      </div>
                      <div className="kpi-insight-callout">
                        <strong>สรุปอ่านง่าย</strong>
                        <p>
                          {sections.repurchase?.availability === "unavailable" ? (
                            <span>{sections.repurchase?.reason || "ยังไม่มีข้อมูลซื้อซ้ำที่คำนวณได้อย่างโปร่งใส"}</span>
                          ) : (
                            <>
                              ในช่วงนี้ ลูกค้าที่ซื้อคอร์สแล้วกลับมาซื้อซ้ำคิดเป็น{" "}
                              <b>{formatPercent(sections.repurchase?.repurchase_rate_pct)}</b> ของผู้ซื้อทั้งหมด
                            </>
                          )}
                        </p>
                      </div>
                    </article>
                  ) : null}
                </div>
              </ReportPageShell>
            );
          })}
        </div>

        {exportError ? <p className="kpi-report-modal-error">{exportError}</p> : null}

        <div className="kpi-report-modal-actions">
          <button type="button" className="kpi-report-modal-btn" onClick={onClose} disabled={downloading}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="kpi-report-modal-btn is-primary"
            onClick={onConfirm}
            disabled={downloading}
          >
            {downloading ? `กำลังสร้าง ${exportFormatLabel}...` : `ยืนยันดาวน์โหลด ${exportFormatLabel}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionStatusNote({ section }) {
  if (!section) return null;

  const messages = [section.reason, section.note].filter(Boolean);
  if (!messages.length) return null;

  return (
    <div className="kpi-section-note">
      {messages.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  );
}

function HorizontalBars({
  rows,
  valueField,
  labelField,
  rowKeyField = labelField,
  formatter = formatNumber,
  emptyMessage,
  compareEnabled = false,
  comparisonLookup = null,
}) {
  const maxValue = useMemo(() => {
    return rows.reduce((max, row) => Math.max(max, Number(row?.[valueField]) || 0), 0);
  }, [rows, valueField]);

  if (!rows.length) {
    return <div className="kpi-empty">{emptyMessage}</div>;
  }

  return (
    <div className="kpi-bars">
      {rows.map((row) => {
        const value = Number(row?.[valueField]) || 0;
        const widthPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
        const comparisonRow = comparisonLookup?.get(String(row?.[rowKeyField] ?? ""));
        return (
          <div key={`${row?.[rowKeyField] ?? row?.[labelField]}-${value}`} className="kpi-bar-row">
            <div className="kpi-bar-labels">
              <span>{row?.[labelField]}</span>
              <MetricWithComparison
                enabled={compareEnabled}
                currentValue={row?.[valueField]}
                previousValue={comparisonRow?.[valueField]}
                compact
                className="kpi-bar-metric"
              >
                <strong>{formatter(value)}</strong>
              </MetricWithComparison>
            </div>
            <div className="kpi-bar-track">
              <span className="kpi-bar-fill" style={{ width: `${widthPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DailyOutcomeChart({
  rows,
  granularity = "day",
  emptyMessage = "ยังไม่มีนัดหมายในช่วงที่เลือก",
}) {
  const maxTotal = useMemo(() => rows.reduce((max, row) => Math.max(max, Number(row.total_appointments) || 0), 0), [rows]);

  if (!rows.length) {
    return <div className="kpi-empty">{emptyMessage}</div>;
  }

  return (
    <div
      className="kpi-daily-grid"
      role="img"
      aria-label={granularity === "month" ? "กราฟสถานะนัดหมายรายเดือน" : "กราฟสถานะนัดหมายรายวัน"}
    >
      {rows.map((row) => {
        const total = Number(row.total_appointments) || 0;
        const completed = Number(row.completed_count) || 0;
        const cancelled = Number(row.cancelled_count) || 0;
        const noShow = Number(row.no_show_count) || 0;
        const other = Math.max(total - completed - cancelled - noShow, 0);
        const heightPct = maxTotal > 0 ? Math.max((total / maxTotal) * 100, total > 0 ? 8 : 0) : 0;
        const safeTotal = total || 1;
        const rowLabel = row.label || (granularity === "month" ? row.date?.slice(5) : row.date?.slice(-2));

        return (
          <div key={row.date} className="kpi-daily-column">
            <div className="kpi-daily-bars" title={`${rowLabel || row.date}: ${total} นัด`}>
              <div className="kpi-daily-stack" style={{ height: `${heightPct}%` }}>
                <span className="seg-completed" style={{ height: `${(completed / safeTotal) * 100}%` }} />
                <span className="seg-cancelled" style={{ height: `${(cancelled / safeTotal) * 100}%` }} />
                <span className="seg-no-show" style={{ height: `${(noShow / safeTotal) * 100}%` }} />
                <span className="seg-other" style={{ height: `${(other / safeTotal) * 100}%` }} />
              </div>
            </div>
            <strong>{total}</strong>
            <small>{rowLabel}</small>
          </div>
        );
      })}
    </div>
  );
}

export default function KpiDashboardPage() {
  const [scope, setScope] = useState("month");
  const [month, setMonth] = useState(() => getCurrentMonthKey());
  const [year, setYear] = useState(() => getCurrentYearKey());
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [compareChoice, setCompareChoice] = useState("previous_period");
  const [comparisonReport, setComparisonReport] = useState(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  const [reportExportFormat, setReportExportFormat] = useState("pdf");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewOpenedAt, setPreviewOpenedAt] = useState(null);
  const [exportingReport, setExportingReport] = useState(false);
  const [exportError, setExportError] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const previewRef = useRef(null);
  const yearInputValid = /^\d{4}$/.test(year);
  const currentParams = useMemo(
    () => buildReportRequestParams({ scope, month, year }),
    [scope, month, year]
  );
  const comparisonOptions = useMemo(
    () => buildComparisonOptions({ scope, month, year }),
    [scope, month, year]
  );
  const selectedComparisonOption = useMemo(
    () => comparisonOptions.find((option) => option.value === compareChoice) || comparisonOptions[0] || null,
    [compareChoice, comparisonOptions]
  );

  useEffect(() => {
    if (scope === "year" && !yearInputValid) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let alive = true;

    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getMonthlyKpiDashboard(currentParams, controller.signal);
        if (!alive) return;
        setReport(data.report || null);
      } catch (err) {
        if (!alive || err?.name === "AbortError") return;
        setError(err?.message || "โหลด KPI dashboard ไม่สำเร็จ");
        setReport(null);
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [currentParams, scope, yearInputValid, reloadToken]);

  useEffect(() => {
    setCompareEnabled(false);
    setCompareChoice(comparisonOptions[0]?.value || "previous_period");
  }, [scope, month, year, comparisonOptions]);

  useEffect(() => {
    if (!selectedComparisonOption?.params) {
      setComparisonReport(null);
      setComparisonLoading(false);
      setComparisonError("");
      return undefined;
    }

    const controller = new AbortController();
    let alive = true;

    const run = async () => {
      setComparisonLoading(true);
      setComparisonError("");
      try {
        const data = await loadCachedKpiReport(selectedComparisonOption.params, controller.signal, {
          force: reloadToken > 0,
        });
        if (!alive) return;
        setComparisonReport(data.report || null);
      } catch (err) {
        if (!alive || err?.name === "AbortError") return;
        setComparisonError(err?.message || "โหลดข้อมูลเปรียบเทียบไม่สำเร็จ");
        setComparisonReport(null);
      } finally {
        if (alive) {
          setComparisonLoading(false);
        }
      }
    };

    void run();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [selectedComparisonOption, reloadToken]);

  const summaryCards = report?.summary_cards || EMPTY_LIST;
  const sections = report?.sections || {};
  const comparisonSections = comparisonReport?.sections;
  const comparisonAppointmentOutcomes = comparisonSections?.appointment_outcomes;
  const comparisonNoShowCancellation = comparisonSections?.no_show_cancellation;
  const comparisonCourseSalesMix = comparisonSections?.course_sales_mix;
  const comparisonCourseRedemption = comparisonSections?.course_redemption;
  const comparisonRepurchase = comparisonSections?.repurchase;
  const reportMeta = report?.meta || {};
  const staffRows = sections.staff_utilization?.rows || EMPTY_LIST;
  const salesRows = sections.course_sales_mix?.rows || EMPTY_LIST;
  const redemptionRows = sections.course_redemption?.top_packages || EMPTY_LIST;
  const partialWarnings = Array.isArray(reportMeta.warnings) ? reportMeta.warnings : [];
  const headlineSummaryCards = summaryCards.filter((card) => card.id !== "free_scan_conversion");
  const showContent = Boolean(report);
  const comparisonCardLookup = useMemo(
    () => buildRowLookup(comparisonReport?.summary_cards || [], "id"),
    [comparisonReport]
  );
  const comparisonSalesLookup = useMemo(
    () => buildRowLookup(comparisonSections?.course_sales_mix?.rows || [], "bucket"),
    [comparisonSections]
  );
  const comparisonStaffLookup = useMemo(
    () => buildRowLookup(comparisonSections?.staff_utilization?.rows || [], "staff_name"),
    [comparisonSections]
  );
  const comparisonRedemptionLookup = useMemo(
    () => buildRowLookup(comparisonSections?.course_redemption?.top_packages || [], "package_label"),
    [comparisonSections]
  );
  const staffPreviewChunks = useMemo(() => chunkRows(staffRows, 8), [staffRows]);
  const redemptionPreviewChunks = useMemo(() => chunkRows(redemptionRows, 6), [redemptionRows]);
  const periodLabel =
    report?.period?.label_th ||
    report?.period?.month_label_th ||
    (scope === "year" ? `ปี ${Number(year || 0) + 543}` : scope === "all" ? "ภาพรวมทั้งหมด" : month);
  const periodNote =
    report?.period?.note_th ||
    (scope === "year"
      ? "ข้อมูลรวมทั้งปีจากเวลา Asia/Bangkok"
      : scope === "all"
        ? "ข้อมูลตั้งแต่เริ่มโครงการตามเวลา Asia/Bangkok"
        : "ข้อมูลอิงเดือนจากเวลา Asia/Bangkok");
  const timelineGranularity = report?.period?.timeline_granularity || (scope === "month" ? "day" : "month");
  const displayError = error || (scope === "year" && !yearInputValid ? "ปีต้องเป็นรูปแบบ YYYY" : "");
  const comparisonHasActivity = hasReportActivity(comparisonReport);
  const comparisonSelectable = Boolean(selectedComparisonOption?.params) && !comparisonLoading && !comparisonError && comparisonHasActivity;
  const comparisonActive = compareEnabled && comparisonSelectable;
  const comparisonNote = !selectedComparisonOption?.params
    ? "ภาพรวมทั้งหมดไม่มีช่วงก่อนหน้าที่มีความยาวเท่ากันให้เปรียบเทียบ"
    : comparisonLoading
      ? "กำลังเตรียมข้อมูลเปรียบเทียบ..."
      : comparisonError
        ? comparisonError
        : comparisonHasActivity
          ? `พร้อมเทียบกับ ${selectedComparisonOption.label}`
          : selectedComparisonOption.emptyMessage;

  useEffect(() => {
    if (!comparisonSelectable && compareEnabled) {
      setCompareEnabled(false);
    }
  }, [compareEnabled, comparisonSelectable]);

  useEffect(() => {
    setPreviewOpen(false);
    setPreviewOpenedAt(null);
    setExportError("");
  }, [scope, month, year, reloadToken]);

  const comparisonLabel = comparisonActive && selectedComparisonOption
    ? `เทียบกับ ${selectedComparisonOption.label}`
    : "";
  const selectedExportOption = getReportExportOption(reportExportFormat);
  const generatedAtText = formatGeneratedAtLabel(previewOpenedAt || new Date());

  const openPreviewModal = () => {
    if (!report || loading || displayError) return;
    setExportError("");
    setPreviewOpenedAt(new Date());
    setPreviewOpen(true);
  };

  const closePreviewModal = () => {
    if (exportingReport) return;
    setPreviewOpen(false);
    setExportError("");
  };

  const handleConfirmDownload = async () => {
    if (!report) return;
    setExportError("");
    setExportingReport(true);
    try {
      const filename = buildReportFilename(report, reportExportFormat);
      if (reportExportFormat === "pptx") {
        await exportPreviewPagesToPowerPoint(previewRef.current, filename);
      } else {
        await exportPreviewPagesToPdf(previewRef.current, filename);
      }
      setPreviewOpen(false);
    } catch (err) {
      setExportError(err?.message || "สร้างไฟล์รายงานไม่สำเร็จ");
    } finally {
      setExportingReport(false);
    }
  };

  return (
    <section className="workbench-body kpi-dashboard-page" aria-busy={loading ? "true" : undefined}>
      <div className="kpi-dashboard-stack">
      <div className="panel kpi-hero-panel">
        <div className="kpi-hero-copy">
          <div className="panel-title">
            <span>KPI Dashboard</span>
            <strong>อ่านอย่างเดียว</strong>
          </div>
          <h2>สรุปผลตามช่วงเวลาสำหรับประชุมทีม</h2>
          <p>
            หน้านี้ดึงข้อมูลแบบอ่านอย่างเดียวจากระบบปัจจุบัน เพื่อสรุปภาพรวมยอดขายคอร์ส,
            สถานะนัดหมาย, การตัดคอร์ส และการซื้อซ้ำ แบบรายเดือน รายปี หรือภาพรวมทั้งหมด
            โดยไม่แตะ logic ธุรกิจเดิม
          </p>
          <div className="kpi-export-controls">
            <label className="kpi-export-field">
              <span>รูปแบบรายงาน</span>
              <select
                value={reportExportFormat}
                onChange={(event) => setReportExportFormat(event.target.value)}
                disabled={loading || !report}
              >
                {REPORT_EXPORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="kpi-export-btn"
              onClick={openPreviewModal}
              disabled={loading || !report || Boolean(displayError)}
            >
              ดาวน์โหลดรายงาน
            </button>
          </div>
        </div>

        <div className="kpi-toolbar">
          <div className="kpi-scope-switch" role="tablist" aria-label="ขอบเขตเวลา KPI">
            {KPI_SCOPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`kpi-scope-btn ${scope === option.value ? "is-active" : ""}`}
                onClick={() => setScope(option.value)}
                aria-pressed={scope === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>

          {scope === "month" ? (
            <label className="kpi-toolbar-field">
              <span>เลือกเดือน</span>
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                max={getCurrentMonthKey()}
              />
            </label>
          ) : null}

          {scope === "year" ? (
            <label className="kpi-toolbar-field">
              <span>เลือกปี</span>
              <input
                type="number"
                inputMode="numeric"
                min="2000"
                max={getCurrentYearKey()}
                value={year}
                onChange={(event) => setYear(event.target.value.replace(/\D+/g, "").slice(0, 4))}
              />
            </label>
          ) : null}

          {scope === "all" ? (
            <div className="kpi-toolbar-field">
              <span>ขอบเขตเวลา</span>
              <div className="kpi-toolbar-static">ตั้งแต่เริ่มโครงการ</div>
            </div>
          ) : null}

          <button type="button" className="kpi-refresh-btn" onClick={() => setReloadToken((value) => value + 1)}>
            รีเฟรชข้อมูล
          </button>
          <div className="kpi-toolbar-note">
            <strong>{periodLabel || "กำลังโหลด..."}</strong>
            <small>{periodNote}</small>
          </div>

          <div className="kpi-compare-row" aria-live="polite">
            <label className={`kpi-compare-toggle ${comparisonSelectable ? "" : "is-disabled"}`.trim()}>
              <input
                type="checkbox"
                checked={comparisonActive}
                disabled={!comparisonSelectable}
                onChange={(event) => setCompareEnabled(event.target.checked)}
              />
              <span>เปรียบเทียบกับช่วงก่อนหน้า</span>
            </label>

            <label className="kpi-compare-select-field">
              <span>ตัวเลือกเปรียบเทียบ</span>
              <select
                value={selectedComparisonOption?.value || ""}
                disabled={!comparisonSelectable}
                onChange={(event) => setCompareChoice(event.target.value)}
              >
                {comparisonOptions.length ? (
                  comparisonOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                ) : (
                  <option value="">ไม่มีช่วงเปรียบเทียบ</option>
                )}
              </select>
            </label>

            <small className={`kpi-compare-note ${comparisonSelectable ? "is-ready" : ""}`.trim()}>
              {comparisonNote}
            </small>
          </div>
        </div>
      </div>

      {displayError ? (
        <div className="panel kpi-error-panel" role="alert">
          <div className="panel-title">
            <span>เกิดปัญหาในการโหลดข้อมูล</span>
            <strong>ตรวจสอบได้</strong>
          </div>
          <p>{displayError}</p>
        </div>
      ) : null}

      {!showContent ? (
        <article className="panel">
          <div className="panel-title">
            <span>กำลังโหลด KPI dashboard</span>
            <strong>โปรดรอสักครู่</strong>
          </div>
          <div className="kpi-empty">ระบบกำลังสรุปข้อมูลรายเดือนแบบอ่านอย่างเดียว</div>
        </article>
      ) : (
        <>
          <div className="kpi-dashboard-main">
            {reportMeta.partial ? (
              <article className="panel" role="status" aria-live="polite">
                <div className="panel-title">
                  <span>บาง KPI ยังอ่านได้ไม่ครบ</span>
                  <strong>{reportMeta.warning_count || partialWarnings.length} ส่วน</strong>
                </div>
                <p className="kpi-section-note">{reportMeta.partial_note || "ระบบกำลังแสดงเฉพาะส่วนที่อ่านได้ก่อน"}</p>
                {partialWarnings.length ? (
                  <ul className="kpi-assumption-list">
                    {partialWarnings.map((warning) => (
                      <li key={`${warning.section}-${warning.reason}`}>
                        <strong>{warning.title || warning.section}</strong> {warning.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ) : null}

            {headlineSummaryCards.length ? (
              <div className="kpi-summary-grid" aria-label="KPI summary cards">
                {headlineSummaryCards.map((card) => (
                  <SummaryCard
                    key={card.id}
                    card={card}
                    comparisonCard={comparisonCardLookup.get(card.id)}
                    compareEnabled={comparisonActive}
                  />
                ))}
              </div>
            ) : null}

            <div className="kpi-two-column kpi-overview-sales-row">
              <article className="panel">
                <div className="panel-title">
                  <span>{sections.appointment_outcomes?.title || "ภาพรวมสถานะนัดหมาย"}</span>
                  <strong>{periodLabel}</strong>
                </div>
                <SectionStatusNote section={sections.appointment_outcomes} />
                <div className="kpi-mini-stats">
                  <div>
                    <small>สำเร็จแล้ว</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.appointment_outcomes,
                        sections.appointment_outcomes?.completed_count,
                        formatNumber
                      )}
                      currentValue={sections.appointment_outcomes?.completed_count}
                      previousValue={comparisonAppointmentOutcomes?.completed_count}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                  <div>
                    <small>No-show</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.no_show_cancellation,
                        sections.no_show_cancellation?.no_show_rate_pct,
                        formatPercent
                      )}
                      currentValue={sections.no_show_cancellation?.no_show_rate_pct}
                      previousValue={comparisonNoShowCancellation?.no_show_rate_pct}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                  <div>
                    <small>ยกเลิก</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.no_show_cancellation,
                        sections.no_show_cancellation?.cancellation_rate_pct,
                        formatPercent
                      )}
                      currentValue={sections.no_show_cancellation?.cancellation_rate_pct}
                      previousValue={comparisonNoShowCancellation?.cancellation_rate_pct}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                </div>
                <DailyOutcomeChart
                  rows={sections.appointment_outcomes?.daily_rows || []}
                  granularity={timelineGranularity}
                  emptyMessage={sections.appointment_outcomes?.reason || "ยังไม่มีนัดหมายในช่วงที่เลือก"}
                />
                <div className="kpi-legend">
                  <span><i className="seg-completed" /> สำเร็จ</span>
                  <span><i className="seg-cancelled" /> ยกเลิก</span>
                  <span><i className="seg-no-show" /> No-show</span>
                  <span><i className="seg-other" /> สถานะอื่น</span>
                </div>
              </article>

              <article className="panel">
                <div className="panel-title">
                  <span>{sections.course_sales_mix?.title || "สัดส่วนยอดขายคอร์ส"}</span>
                  <PanelTitleMetric
                    valueText={formatSectionValue(
                      sections.course_sales_mix,
                      sections.course_sales_mix?.total_revenue_thb,
                      formatMoney
                    )}
                    currentValue={sections.course_sales_mix?.total_revenue_thb}
                    previousValue={comparisonCourseSalesMix?.total_revenue_thb}
                    compareEnabled={comparisonActive}
                  />
                </div>
                <SectionStatusNote section={sections.course_sales_mix} />
                <HorizontalBars
                  rows={salesRows}
                  valueField="sales_count"
                  labelField="label"
                  rowKeyField="bucket"
                  formatter={(value) => `${formatNumber(value)} รายการ`}
                  emptyMessage={sections.course_sales_mix?.reason || "ยังไม่พบการขายคอร์สในเดือนนี้"}
                  compareEnabled={comparisonActive}
                  comparisonLookup={comparisonSalesLookup}
                />
                <div className="kpi-simple-table-wrap">
                  <table className="kpi-simple-table">
                    <thead>
                      <tr>
                        <th>ราคา</th>
                        <th>ขายได้</th>
                        <th>ผู้ซื้อ</th>
                        <th>ยอดรวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {salesRows.map((row) => (
                        <tr key={row.bucket}>
                          <td>{row.label}</td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.sales_count)}
                              currentValue={row.sales_count}
                              previousValue={comparisonSalesLookup.get(row.bucket)?.sales_count}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.buyer_count)}
                              currentValue={row.buyer_count}
                              previousValue={comparisonSalesLookup.get(row.bucket)?.buyer_count}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatMoney(row.revenue_thb)}
                              currentValue={row.revenue_thb}
                              previousValue={comparisonSalesLookup.get(row.bucket)?.revenue_thb}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>

            <div className="kpi-two-column kpi-staff-redemption-row">
              <article className="panel">
                <div className="panel-title">
                  <span>{sections.staff_utilization?.title || "การใช้กำลังคนพนักงาน"}</span>
                  <strong>
                    {sections.staff_utilization?.availability === "unavailable"
                      ? "ยังไม่มีข้อมูล"
                      : sections.staff_utilization?.availability === "proxy"
                        ? "Proxy"
                        : "พร้อมใช้"}
                  </strong>
                </div>
                <SectionStatusNote section={sections.staff_utilization} />
                <div className="kpi-simple-table-wrap">
                  <table className="kpi-simple-table">
                    <thead>
                      <tr>
                        <th>พนักงาน</th>
                        <th>เคสทั้งหมด</th>
                        <th>สำเร็จ</th>
                        <th>No-show</th>
                        <th>ยกเลิก</th>
                        <th>อัตราสำเร็จ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffRows.map((row) => (
                        <tr key={row.staff_name}>
                          <td>{row.staff_name}</td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.total_appointments)}
                              currentValue={row.total_appointments}
                              previousValue={comparisonStaffLookup.get(row.staff_name)?.total_appointments}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.completed_count)}
                              currentValue={row.completed_count}
                              previousValue={comparisonStaffLookup.get(row.staff_name)?.completed_count}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.no_show_count)}
                              currentValue={row.no_show_count}
                              previousValue={comparisonStaffLookup.get(row.staff_name)?.no_show_count}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatNumber(row.cancelled_count)}
                              currentValue={row.cancelled_count}
                              previousValue={comparisonStaffLookup.get(row.staff_name)?.cancelled_count}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                          <td>
                            <TableMetricValue
                              valueText={formatPercent(row.completion_rate_pct)}
                              currentValue={row.completion_rate_pct}
                              previousValue={comparisonStaffLookup.get(row.staff_name)?.completion_rate_pct}
                              compareEnabled={comparisonActive}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="panel">
                <div className="panel-title">
                  <span>{sections.course_redemption?.title || "การตัดคอร์ส / การปิดคอร์ส"}</span>
                  <PanelTitleMetric
                    valueText={formatSectionValue(
                      sections.course_redemption,
                      sections.course_redemption?.total_redemptions,
                      (value) => `${formatNumber(value)} ครั้ง`
                    )}
                    currentValue={sections.course_redemption?.total_redemptions}
                    previousValue={comparisonCourseRedemption?.total_redemptions}
                    compareEnabled={comparisonActive}
                  />
                </div>
                <SectionStatusNote section={sections.course_redemption} />
                <div className="kpi-mini-stats">
                  <div>
                    <small>ตัดคอร์สทั้งหมด</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.course_redemption,
                        sections.course_redemption?.total_redemptions,
                        formatNumber
                      )}
                      currentValue={sections.course_redemption?.total_redemptions}
                      previousValue={comparisonCourseRedemption?.total_redemptions}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                  <div>
                    <small>ลูกค้าที่ถูกตัดคอร์ส</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.course_redemption,
                        sections.course_redemption?.packages_used_count,
                        formatNumber
                      )}
                      currentValue={sections.course_redemption?.packages_used_count}
                      previousValue={comparisonCourseRedemption?.packages_used_count}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                  <div>
                    <small>ปิดคอร์สในเดือนนี้</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.course_redemption,
                        sections.course_redemption?.packages_completed_count,
                        formatNumber
                      )}
                      currentValue={sections.course_redemption?.packages_completed_count}
                      previousValue={comparisonCourseRedemption?.packages_completed_count}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                  <div>
                    <small>ใช้ Mask</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.course_redemption,
                        sections.course_redemption?.mask_redemptions_count,
                        formatNumber
                      )}
                      currentValue={sections.course_redemption?.mask_redemptions_count}
                      previousValue={comparisonCourseRedemption?.mask_redemptions_count}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                </div>
                <HorizontalBars
                  rows={redemptionRows}
                  valueField="redemptions_count"
                  labelField="package_label"
                  formatter={(value) => `${formatNumber(value)} ครั้ง`}
                  emptyMessage={sections.course_redemption?.reason || "ยังไม่พบประวัติการตัดคอร์สในเดือนนี้"}
                  compareEnabled={comparisonActive}
                  comparisonLookup={comparisonRedemptionLookup}
                />
              </article>
            </div>

            <div className="kpi-two-column kpi-two-column--retention-unavailable">
              <article className="panel">
                <div className="panel-title">
                  <span>{sections.repurchase?.title || "การซื้อซ้ำ"}</span>
                  <PanelTitleMetric
                    valueText={formatSectionValue(
                      sections.repurchase,
                      sections.repurchase?.repurchase_rate_pct,
                      formatPercent
                    )}
                    currentValue={sections.repurchase?.repurchase_rate_pct}
                    previousValue={comparisonRepurchase?.repurchase_rate_pct}
                    compareEnabled={comparisonActive}
                  />
                </div>
                <SectionStatusNote section={sections.repurchase} />
                <div className="kpi-mini-stats">
                  <div>
                    <small>ลูกค้าที่ซื้อคอร์สเดือนนี้</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.repurchase,
                        sections.repurchase?.unique_buyers_count,
                        formatNumber
                      )}
                      currentValue={sections.repurchase?.unique_buyers_count}
                      previousValue={comparisonRepurchase?.unique_buyers_count}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                  <div>
                    <small>ซื้อซ้ำ / ต่อคอร์ส</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.repurchase,
                        sections.repurchase?.repeat_buyers_count,
                        formatNumber
                      )}
                      currentValue={sections.repurchase?.repeat_buyers_count}
                      previousValue={comparisonRepurchase?.repeat_buyers_count}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                  <div>
                    <small>ลูกค้าใหม่</small>
                    <MiniStatValue
                      valueText={formatSectionValue(
                        sections.repurchase,
                        sections.repurchase?.first_time_buyers_count,
                        formatNumber
                      )}
                      currentValue={sections.repurchase?.first_time_buyers_count}
                      previousValue={comparisonRepurchase?.first_time_buyers_count}
                      compareEnabled={comparisonActive}
                    />
                  </div>
                </div>
                <div className="kpi-insight-callout">
                  <strong>สรุปอ่านง่าย</strong>
                  <p>
                    {sections.repurchase?.availability === "unavailable" ? (
                      <span>{sections.repurchase?.reason || "ยังไม่มีข้อมูลซื้อซ้ำที่คำนวณได้อย่างโปร่งใส"}</span>
                    ) : (
                      <>
                        ในเดือนนี้ ลูกค้าที่ซื้อคอร์สแล้วกลับมาซื้อซ้ำคิดเป็น{" "}
                        <b>{formatPercent(sections.repurchase?.repurchase_rate_pct)}</b> ของผู้ซื้อทั้งหมด
                      </>
                    )}
                  </p>
                </div>
              </article>
            </div>
          </div>
        </>
      )}
      </div>

      <KpiReportPreviewModal
        open={previewOpen}
        exportFormatLabel={selectedExportOption.label}
        exportPreviewNote={selectedExportOption.previewNote}
        report={report}
        reportMeta={reportMeta}
        sections={sections}
        comparisonSections={comparisonSections}
        headlineSummaryCards={headlineSummaryCards}
        comparisonCardLookup={comparisonCardLookup}
        comparisonSalesLookup={comparisonSalesLookup}
        comparisonStaffLookup={comparisonStaffLookup}
        comparisonRedemptionLookup={comparisonRedemptionLookup}
        salesRows={salesRows}
        staffChunks={staffPreviewChunks}
        redemptionChunks={redemptionPreviewChunks}
        periodLabel={periodLabel}
        periodNote={periodNote}
        timelineGranularity={timelineGranularity}
        comparisonActive={comparisonActive}
        comparisonLabel={comparisonLabel}
        generatedAtText={generatedAtText}
        previewRef={previewRef}
        onClose={closePreviewModal}
        onConfirm={handleConfirmDownload}
        downloading={exportingReport}
        exportError={exportError}
      />
    </section>
  );
}
