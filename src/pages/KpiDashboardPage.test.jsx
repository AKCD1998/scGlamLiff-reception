import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import KpiDashboardPage from "./KpiDashboardPage";
import { getMonthlyKpiDashboard } from "../utils/reportingApi";

vi.mock("../utils/reportingApi", () => ({
  getMonthlyKpiDashboard: vi.fn(),
}));

const mockReport = {
  period: {
    month: "2026-03",
    month_label_th: "มีนาคม 2569",
  },
  meta: {
    partial: false,
    warning_count: 0,
    warnings: [],
    partial_note: null,
  },
  summary_cards: [
    { id: "appointments_total", label: "นัดหมายทั้งหมด", value: 20, unit: "นัด", availability: "available" },
    { id: "free_scan_conversion", label: "แปลงจากสแกนผิวฟรี", value: null, unit: "", availability: "unavailable", reason: "ไม่มี field scan" },
  ],
  sections: {
    appointment_outcomes: {
      title: "ภาพรวมสถานะนัดหมาย",
      completed_count: 12,
      daily_rows: [{ date: "2026-03-01", total_appointments: 20, completed_count: 12, cancelled_count: 4, no_show_count: 2 }],
    },
    no_show_cancellation: {
      no_show_rate_pct: 10,
      cancellation_rate_pct: 20,
    },
    course_sales_mix: {
      title: "สัดส่วนยอดขายคอร์ส 399 / 999 / 2999",
      total_revenue_thb: 7191,
      rows: [
        { bucket: "399", label: "399 บาท", sales_count: 5, buyer_count: 5, revenue_thb: 1995 },
      ],
    },
    staff_utilization: {
      title: "การใช้กำลังคนพนักงาน",
      note: "proxy",
      rows: [
        {
          staff_name: "พนักงานเอ",
          total_appointments: 10,
          completed_count: 7,
          no_show_count: 1,
          cancelled_count: 2,
          completion_rate_pct: 70,
        },
      ],
    },
    course_redemption: {
      title: "การตัดคอร์ส / การปิดคอร์ส",
      total_redemptions: 11,
      packages_used_count: 6,
      packages_completed_count: 3,
      mask_redemptions_count: 4,
      top_packages: [
        { package_label: "Smooth 3 ครั้ง 999", redemptions_count: 6, packages_used_count: 3 },
      ],
    },
    repurchase: {
      title: "การต่อคอร์ส / ซื้อซ้ำ",
      unique_buyers_count: 8,
      repeat_buyers_count: 3,
      first_time_buyers_count: 5,
      repurchase_rate_pct: 37.5,
    },
    free_scan_conversion: {
      availability: "unavailable",
      reason: "ไม่มีข้อมูล scan",
    },
    upsell_conversion: {
      availability: "unavailable",
      reason: "ไม่มีข้อมูล upsell",
    },
    revenue_mix: {
      availability: "unavailable",
      reason: "ไม่มี itemized split",
      fallback: {
        receipt_count: 4,
        receipt_total_amount_thb: 4396.5,
      },
    },
  },
  assumptions: ["อ่านอย่างเดียว", "ใช้เวลา Asia/Bangkok"],
};

describe("KpiDashboardPage", () => {
  beforeEach(() => {
    getMonthlyKpiDashboard.mockResolvedValue({ ok: true, report: mockReport });
  });

  it("loads and renders monthly KPI data", async () => {
    const { container } = render(<KpiDashboardPage />);

    expect(screen.getByText(/สรุปผลรายเดือนสำหรับประชุมทีม/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(getMonthlyKpiDashboard).toHaveBeenCalled();
    });

    expect(await screen.findByText("20 นัด")).toBeInTheDocument();
    expect(screen.getAllByText(/มีนาคม 2569/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Smooth 3 ครั้ง 999/i)).toBeInTheDocument();
    expect(screen.getAllByText(/37.5%/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/ไม่มีข้อมูล scan/i)).toBeInTheDocument();
    expect(screen.getByText(/ไม่มีข้อมูล upsell/i)).toBeInTheDocument();
    expect(screen.getByText(/ไม่มี itemized split/i)).toBeInTheDocument();
    expect(container.querySelectorAll(".kpi-summary-grid .kpi-summary-card")).toHaveLength(1);
    expect(container.querySelector(".kpi-dashboard-footer .kpi-assumptions-panel")).not.toBeNull();
    expect(screen.getAllByText(/แปลงจากสแกนผิวฟรี/i)).toHaveLength(1);
  });

  it("shows API error message when load fails", async () => {
    getMonthlyKpiDashboard.mockRejectedValueOnce(new Error("โหลดข้อมูลไม่สำเร็จ"));

    render(<KpiDashboardPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดข้อมูลไม่สำเร็จ");
  });

  it("renders partial warning details when backend returns a partial report", async () => {
    getMonthlyKpiDashboard.mockResolvedValueOnce({
      ok: true,
      report: {
        ...mockReport,
        meta: {
          partial: true,
          warning_count: 1,
          partial_note: "บาง KPI ยังไม่พร้อมใน production แต่ระบบยังส่งข้อมูลส่วนที่อ่านได้กลับมา",
          warnings: [
            {
              section: "course_sales_mix",
              title: "สัดส่วนยอดขายคอร์ส 399 / 999 / 2999",
              reason: "ยังอ่านข้อมูลส่วนนี้ไม่ได้ เพราะ schema production ยังขาดคอลัมน์ที่ KPI นี้ต้องใช้",
            },
          ],
        },
        sections: {
          ...mockReport.sections,
          course_sales_mix: {
            title: "สัดส่วนยอดขายคอร์ส 399 / 999 / 2999",
            availability: "unavailable",
            reason: "ยังอ่านข้อมูลส่วนนี้ไม่ได้ เพราะ schema production ยังขาดคอลัมน์ที่ KPI นี้ต้องใช้",
            note: "ระบบยังคงแสดง KPI ส่วนอื่นต่อได้",
            rows: [],
            total_revenue_thb: null,
          },
        },
      },
    });

    render(<KpiDashboardPage />);

    expect(await screen.findByText(/บาง KPI ยังอ่านได้ไม่ครบ/i)).toBeInTheDocument();
    expect(screen.getByText(/บาง KPI ยังไม่พร้อมใน production/i)).toBeInTheDocument();
    expect(screen.getAllByText(/schema production ยังขาดคอลัมน์/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ยังไม่มีข้อมูล/i).length).toBeGreaterThan(0);
  });
});
