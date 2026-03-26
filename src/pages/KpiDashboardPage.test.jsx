import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import KpiDashboardPage from "./KpiDashboardPage";
import { getMonthlyKpiDashboard } from "../utils/reportingApi";

vi.mock("../utils/reportingApi", () => ({
  getMonthlyKpiDashboard: vi.fn(),
}));

const mockReport = {
  period: {
    scope: "month",
    month: "2026-03",
    month_label_th: "มีนาคม 2569",
    label_th: "มีนาคม 2569",
    note_th: "ข้อมูลอิงเดือนจากเวลา Asia/Bangkok",
    timeline_granularity: "day",
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
};

const previousMonthReport = {
  ...mockReport,
  period: {
    ...mockReport.period,
    month: "2026-02",
    month_label_th: "กุมภาพันธ์ 2569",
    label_th: "กุมภาพันธ์ 2569",
  },
  summary_cards: [
    { id: "appointments_total", label: "นัดหมายทั้งหมด", value: 10, unit: "นัด", availability: "available" },
    { id: "free_scan_conversion", label: "แปลงจากสแกนผิวฟรี", value: null, unit: "", availability: "unavailable", reason: "ไม่มี field scan" },
  ],
  sections: {
    ...mockReport.sections,
    appointment_outcomes: {
      ...mockReport.sections.appointment_outcomes,
      completed_count: 6,
      daily_rows: [{ date: "2026-02-01", total_appointments: 10, completed_count: 6, cancelled_count: 2, no_show_count: 1 }],
    },
    no_show_cancellation: {
      no_show_rate_pct: 5,
      cancellation_rate_pct: 10,
    },
    course_sales_mix: {
      ...mockReport.sections.course_sales_mix,
      total_revenue_thb: 2997,
      rows: [
        { bucket: "399", label: "399 บาท", sales_count: 2, buyer_count: 2, revenue_thb: 798 },
      ],
    },
    staff_utilization: {
      ...mockReport.sections.staff_utilization,
      rows: [
        {
          staff_name: "พนักงานเอ",
          total_appointments: 5,
          completed_count: 3,
          no_show_count: 1,
          cancelled_count: 1,
          completion_rate_pct: 60,
        },
      ],
    },
    course_redemption: {
      ...mockReport.sections.course_redemption,
      total_redemptions: 5,
      packages_used_count: 3,
      packages_completed_count: 1,
      mask_redemptions_count: 2,
      top_packages: [
        { package_label: "Smooth 3 ครั้ง 999", redemptions_count: 3, packages_used_count: 2 },
      ],
    },
    repurchase: {
      ...mockReport.sections.repurchase,
      unique_buyers_count: 4,
      repeat_buyers_count: 1,
      first_time_buyers_count: 3,
      repurchase_rate_pct: 25,
    },
  },
};

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonthKey(monthKey, offset) {
  const [yearText, monthText] = String(monthKey).split("-");
  const shifted = new Date(Number(yearText), Number(monthText) - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

describe("KpiDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const currentMonthKey = getCurrentMonthKey();
    const previousMonthKey = shiftMonthKey(currentMonthKey, -1);
    getMonthlyKpiDashboard.mockImplementation((params = {}) => {
      if (params.scope === "month" && params.month === previousMonthKey) {
        return Promise.resolve({ ok: true, report: previousMonthReport });
      }

      if (params.scope === "year") {
        return Promise.resolve({
          ok: true,
          report: {
            ...mockReport,
            period: {
              ...mockReport.period,
              scope: "year",
              year: params.year,
              label_th: `ปี ${Number(params.year) + 543}`,
              note_th: "ข้อมูลรวมทั้งปีจากเวลา Asia/Bangkok",
              timeline_granularity: "month",
            },
          },
        });
      }

      if (params.scope === "all") {
        return Promise.resolve({
          ok: true,
          report: {
            ...mockReport,
            period: {
              ...mockReport.period,
              scope: "all",
              label_th: "ภาพรวมทั้งหมด",
              note_th: "ข้อมูลตั้งแต่เริ่มโครงการตามเวลา Asia/Bangkok",
              timeline_granularity: "month",
            },
          },
        });
      }

      return Promise.resolve({ ok: true, report: mockReport });
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads and renders monthly KPI data", async () => {
    const { container } = render(<KpiDashboardPage />);
    const currentMonthKey = getCurrentMonthKey();
    const previousMonthKey = shiftMonthKey(currentMonthKey, -1);

    expect(screen.getByText(/สรุปผลตามช่วงเวลาสำหรับประชุมทีม/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(getMonthlyKpiDashboard).toHaveBeenCalled();
    });

    expect(
      getMonthlyKpiDashboard.mock.calls.some(([params]) => params.scope === "month" && params.month === currentMonthKey)
    ).toBe(true);
    expect(
      getMonthlyKpiDashboard.mock.calls.some(([params]) => params.scope === "month" && params.month === previousMonthKey)
    ).toBe(true);
    expect(await screen.findByText("20 นัด")).toBeInTheDocument();
    expect(screen.getAllByText(/มีนาคม 2569/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Smooth 3 ครั้ง 999/i)).toBeInTheDocument();
    expect(screen.getAllByText(/37.5%/i).length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".kpi-summary-grid .kpi-summary-card")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /เปรียบเทียบกับช่วงก่อนหน้า/i })).toBeEnabled();
    expect(screen.getByRole("option", { name: /Microsoft PowerPoint \(.pptx\)/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ดาวน์โหลดรายงาน/i })).toBeEnabled();
    expect(screen.queryByText(/หัวข้อ KPI เพิ่มเติม/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/สมมติฐานการอ่านตัวเลข/i)).not.toBeInTheDocument();
  });

  it("switches to year scope and refetches KPI with selected year", async () => {
    render(<KpiDashboardPage />);

    await waitFor(() => {
      expect(getMonthlyKpiDashboard).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "ปี" })[0]);
    fireEvent.change(screen.getByLabelText("เลือกปี"), { target: { value: "2025" } });

    await waitFor(() => {
      expect(
        getMonthlyKpiDashboard.mock.calls.some(
          ([params]) => params.scope === "year" && params.year === "2025"
        )
      ).toBe(true);
    });
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

  it("renders comparison deltas when compare mode is enabled", async () => {
    const { container } = render(<KpiDashboardPage />);

    const compareCheckbox = await screen.findByRole("checkbox", { name: /เปรียบเทียบกับช่วงก่อนหน้า/i });
    await waitFor(() => {
      expect(compareCheckbox).toBeEnabled();
    });

    fireEvent.click(compareCheckbox);

    await waitFor(() => {
      expect(container.querySelectorAll(".kpi-delta").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    expect(screen.getByText(/พร้อมเทียบกับ เดือนก่อนหน้า/i)).toBeInTheDocument();
  });

  it("disables compare controls when scope has no previous-equivalent window", async () => {
    render(<KpiDashboardPage />);

    await waitFor(() => {
      expect(getMonthlyKpiDashboard).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByRole("button", { name: "ภาพรวมทั้งหมด" })[0]);

    const compareCheckbox = await screen.findByRole("checkbox", { name: /เปรียบเทียบกับช่วงก่อนหน้า/i });
    const compareSelect = screen.getByLabelText("ตัวเลือกเปรียบเทียบ");

    await waitFor(() => {
      expect(compareCheckbox).toBeDisabled();
      expect(compareSelect).toBeDisabled();
    });

    expect(screen.getByText(/ภาพรวมทั้งหมดไม่มีช่วงก่อนหน้าที่มีความยาวเท่ากันให้เปรียบเทียบ/i)).toBeInTheDocument();
  });

  it("opens and closes the report preview modal from export controls", async () => {
    render(<KpiDashboardPage />);

    expect(await screen.findByText("20 นัด")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ดาวน์โหลดรายงาน/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/ตัวอย่างรายงานก่อนดาวน์โหลด/i);
    expect(within(dialog).getByText(/ไฟล์ PDF จะสร้างจากหน้า preview นี้ในขนาด A4 แนวนอน/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /ยืนยันดาวน์โหลด/i })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /ยกเลิก/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("updates preview copy when powerpoint format is selected", async () => {
    render(<KpiDashboardPage />);

    expect(await screen.findByText("20 นัด")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("รูปแบบรายงาน"), {
      target: { value: "pptx" },
    });
    fireEvent.click(screen.getByRole("button", { name: /ดาวน์โหลดรายงาน/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/ไฟล์ PowerPoint จะสร้างจากหน้า preview นี้เป็นสไลด์ภาษาไทยพร้อมนำเสนอ/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /ยืนยันดาวน์โหลด Microsoft PowerPoint/i })).toBeInTheDocument();
  });
});
