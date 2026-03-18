import { useEffect, useMemo, useState } from "react";
import { getMonthlyKpiDashboard } from "../utils/reportingApi";
import "./KpiDashboardPage.css";

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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

function metricToneClass(availability) {
  if (availability === "proxy") return "is-proxy";
  if (availability === "unavailable") return "is-unavailable";
  return "is-available";
}

function AvailabilityBadge({ availability = "available" }) {
  const label =
    availability === "proxy"
      ? "ใช้ค่าแทน"
      : availability === "unavailable"
        ? "ยังไม่พร้อม"
        : "พร้อมใช้";
  return <span className={`kpi-badge ${metricToneClass(availability)}`}>{label}</span>;
}

function SummaryCard({ card }) {
  return (
    <article className={`kpi-summary-card ${metricToneClass(card.availability)}`}>
      <div className="kpi-summary-top">
        <p>{card.label}</p>
        <AvailabilityBadge availability={card.availability} />
      </div>
      <strong>{formatCardValue(card)}</strong>
      {card.reason ? <small>{card.reason}</small> : null}
      {card.note ? <small>{card.note}</small> : null}
    </article>
  );
}

function HorizontalBars({ rows, valueField, labelField, formatter = formatNumber, emptyMessage }) {
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
        return (
          <div key={`${row?.[labelField]}-${value}`} className="kpi-bar-row">
            <div className="kpi-bar-labels">
              <span>{row?.[labelField]}</span>
              <strong>{formatter(value)}</strong>
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

function DailyOutcomeChart({ rows }) {
  const maxTotal = useMemo(() => rows.reduce((max, row) => Math.max(max, Number(row.total_appointments) || 0), 0), [rows]);

  if (!rows.length) {
    return <div className="kpi-empty">ยังไม่มีนัดหมายในเดือนที่เลือก</div>;
  }

  return (
    <div className="kpi-daily-grid" role="img" aria-label="กราฟสถานะนัดหมายรายวัน">
      {rows.map((row) => {
        const total = Number(row.total_appointments) || 0;
        const completed = Number(row.completed_count) || 0;
        const cancelled = Number(row.cancelled_count) || 0;
        const noShow = Number(row.no_show_count) || 0;
        const other = Math.max(total - completed - cancelled - noShow, 0);
        const heightPct = maxTotal > 0 ? Math.max((total / maxTotal) * 100, total > 0 ? 8 : 0) : 0;
        const safeTotal = total || 1;

        return (
          <div key={row.date} className="kpi-daily-column">
            <div className="kpi-daily-bars" title={`${row.date}: ${total} นัด`}>
              <div className="kpi-daily-stack" style={{ height: `${heightPct}%` }}>
                <span className="seg-completed" style={{ height: `${(completed / safeTotal) * 100}%` }} />
                <span className="seg-cancelled" style={{ height: `${(cancelled / safeTotal) * 100}%` }} />
                <span className="seg-no-show" style={{ height: `${(noShow / safeTotal) * 100}%` }} />
                <span className="seg-other" style={{ height: `${(other / safeTotal) * 100}%` }} />
              </div>
            </div>
            <strong>{total}</strong>
            <small>{row.date.slice(-2)}</small>
          </div>
        );
      })}
    </div>
  );
}

function UnavailableMetric({ title, section }) {
  return (
    <article className="kpi-unavailable-card">
      <div className="kpi-summary-top">
        <p>{title}</p>
        <AvailabilityBadge availability={section.availability} />
      </div>
      <strong>ยังคำนวณไม่ได้อย่างโปร่งใส</strong>
      <small>{section.reason}</small>
      {section.fallback ? (
        <div className="kpi-fallback-box">
          <span>ข้อมูลทดแทนที่พออ่านได้ตอนนี้</span>
          <div>
            <strong>{formatMoney(section.fallback.receipt_total_amount_thb)}</strong>
            <small>รวมจากใบเสร็จที่บันทึก {formatNumber(section.fallback.receipt_count)} ใบ</small>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function KpiDashboardPage() {
  const [month, setMonth] = useState(() => getCurrentMonthKey());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await getMonthlyKpiDashboard({ month }, controller.signal);
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
  }, [month, reloadToken]);

  const summaryCards = report?.summary_cards || [];
  const sections = report?.sections || {};
  const assumptions = report?.assumptions || [];
  const staffRows = sections.staff_utilization?.rows || [];
  const salesRows = sections.course_sales_mix?.rows || [];
  const redemptionRows = sections.course_redemption?.top_packages || [];
  const showContent = Boolean(report);

  return (
    <section className="workbench-body kpi-dashboard-page" aria-busy={loading ? "true" : undefined}>
      <div className="panel kpi-hero-panel">
        <div className="kpi-hero-copy">
          <div className="panel-title">
            <span>KPI Dashboard</span>
            <strong>อ่านอย่างเดียว</strong>
          </div>
          <h2>สรุปผลรายเดือนสำหรับประชุมทีม</h2>
          <p>
            หน้านี้ดึงข้อมูลแบบอ่านอย่างเดียวจากระบบปัจจุบัน เพื่อสรุปภาพรวมยอดขายคอร์ส,
            สถานะนัดหมาย, การตัดคอร์ส และการซื้อซ้ำ โดยไม่แตะ logic ธุรกิจเดิม
          </p>
        </div>

        <div className="kpi-toolbar">
          <label className="kpi-toolbar-field">
            <span>เลือกเดือน</span>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              max={getCurrentMonthKey()}
            />
          </label>
          <button type="button" className="kpi-refresh-btn" onClick={() => setReloadToken((value) => value + 1)}>
            รีเฟรชข้อมูล
          </button>
          <div className="kpi-toolbar-note">
            <strong>{report?.period?.month_label_th || "กำลังโหลด..."}</strong>
            <small>ข้อมูลอิงเดือนจากเวลา Asia/Bangkok</small>
          </div>
        </div>
      </div>

      {error ? (
        <div className="panel kpi-error-panel" role="alert">
          <div className="panel-title">
            <span>เกิดปัญหาในการโหลดข้อมูล</span>
            <strong>ตรวจสอบได้</strong>
          </div>
          <p>{error}</p>
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
          <div className="kpi-summary-grid">
            {summaryCards.map((card) => (
              <SummaryCard key={card.id} card={card} />
            ))}
          </div>

          <div className="kpi-two-column">
            <article className="panel">
              <div className="panel-title">
                <span>{sections.appointment_outcomes?.title || "ภาพรวมสถานะนัดหมาย"}</span>
                <strong>{report?.period?.month_label_th || month}</strong>
              </div>
              <div className="kpi-mini-stats">
                <div>
                  <small>สำเร็จแล้ว</small>
                  <strong>{formatNumber(sections.appointment_outcomes?.completed_count)}</strong>
                </div>
                <div>
                  <small>No-show</small>
                  <strong>{formatPercent(sections.no_show_cancellation?.no_show_rate_pct)}</strong>
                </div>
                <div>
                  <small>ยกเลิก</small>
                  <strong>{formatPercent(sections.no_show_cancellation?.cancellation_rate_pct)}</strong>
                </div>
              </div>
              <DailyOutcomeChart rows={sections.appointment_outcomes?.daily_rows || []} />
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
                <strong>{formatMoney(sections.course_sales_mix?.total_revenue_thb)}</strong>
              </div>
              <HorizontalBars
                rows={salesRows}
                valueField="sales_count"
                labelField="label"
                formatter={(value) => `${formatNumber(value)} รายการ`}
                emptyMessage="ยังไม่พบการขายคอร์สในเดือนนี้"
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
                        <td>{formatNumber(row.sales_count)}</td>
                        <td>{formatNumber(row.buyer_count)}</td>
                        <td>{formatMoney(row.revenue_thb)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <div className="kpi-two-column">
            <article className="panel">
              <div className="panel-title">
                <span>{sections.staff_utilization?.title || "การใช้กำลังคนพนักงาน"}</span>
                <strong>Proxy</strong>
              </div>
              <p className="kpi-section-note">{sections.staff_utilization?.note}</p>
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
                        <td>{formatNumber(row.total_appointments)}</td>
                        <td>{formatNumber(row.completed_count)}</td>
                        <td>{formatNumber(row.no_show_count)}</td>
                        <td>{formatNumber(row.cancelled_count)}</td>
                        <td>{formatPercent(row.completion_rate_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel">
              <div className="panel-title">
                <span>{sections.course_redemption?.title || "การตัดคอร์ส / การปิดคอร์ส"}</span>
                <strong>{formatNumber(sections.course_redemption?.total_redemptions)} ครั้ง</strong>
              </div>
              <div className="kpi-mini-stats">
                <div>
                  <small>ตัดคอร์สทั้งหมด</small>
                  <strong>{formatNumber(sections.course_redemption?.total_redemptions)}</strong>
                </div>
                <div>
                  <small>ลูกค้าที่ถูกตัดคอร์ส</small>
                  <strong>{formatNumber(sections.course_redemption?.packages_used_count)}</strong>
                </div>
                <div>
                  <small>ปิดคอร์สในเดือนนี้</small>
                  <strong>{formatNumber(sections.course_redemption?.packages_completed_count)}</strong>
                </div>
                <div>
                  <small>ใช้ Mask</small>
                  <strong>{formatNumber(sections.course_redemption?.mask_redemptions_count)}</strong>
                </div>
              </div>
              <HorizontalBars
                rows={redemptionRows}
                valueField="redemptions_count"
                labelField="package_label"
                formatter={(value) => `${formatNumber(value)} ครั้ง`}
                emptyMessage="ยังไม่พบประวัติการตัดคอร์สในเดือนนี้"
              />
            </article>
          </div>

          <div className="kpi-two-column">
            <article className="panel">
              <div className="panel-title">
                <span>{sections.repurchase?.title || "การซื้อซ้ำ"}</span>
                <strong>{formatPercent(sections.repurchase?.repurchase_rate_pct)}</strong>
              </div>
              <div className="kpi-mini-stats">
                <div>
                  <small>ลูกค้าที่ซื้อคอร์สเดือนนี้</small>
                  <strong>{formatNumber(sections.repurchase?.unique_buyers_count)}</strong>
                </div>
                <div>
                  <small>ซื้อซ้ำ / ต่อคอร์ส</small>
                  <strong>{formatNumber(sections.repurchase?.repeat_buyers_count)}</strong>
                </div>
                <div>
                  <small>ลูกค้าใหม่</small>
                  <strong>{formatNumber(sections.repurchase?.first_time_buyers_count)}</strong>
                </div>
              </div>
              <div className="kpi-insight-callout">
                <strong>สรุปอ่านง่าย</strong>
                <p>
                  ในเดือนนี้ ลูกค้าที่ซื้อคอร์สแล้วกลับมาซื้อซ้ำคิดเป็น{" "}
                  <b>{formatPercent(sections.repurchase?.repurchase_rate_pct)}</b> ของผู้ซื้อทั้งหมด
                </p>
              </div>
            </article>

            <article className="panel">
              <div className="panel-title">
                <span>ตัวชี้วัดที่ยังไม่มีข้อมูลพอ</span>
                <strong>แสดงแบบโปร่งใส</strong>
              </div>
              <div className="kpi-unavailable-grid">
                <UnavailableMetric title="แปลงจากสแกนผิวฟรี" section={sections.free_scan_conversion || { availability: "unavailable" }} />
                <UnavailableMetric title="Upsell ผลิตภัณฑ์" section={sections.upsell_conversion || { availability: "unavailable" }} />
                <UnavailableMetric title="Revenue mix บริการ vs สินค้า" section={sections.revenue_mix || { availability: "unavailable" }} />
              </div>
            </article>
          </div>

          <article className="panel">
            <div className="panel-title">
              <span>สมมติฐานการอ่านตัวเลข</span>
              <strong>เพื่อประชุมทีม</strong>
            </div>
            <ul className="kpi-assumption-list">
              {assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </article>
        </>
      )}
    </section>
  );
}
