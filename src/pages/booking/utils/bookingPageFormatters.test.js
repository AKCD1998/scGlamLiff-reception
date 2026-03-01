import { describe, expect, it } from "vitest";
import { formatAppointmentStatus, normalizeRow } from "./bookingPageFormatters";

describe("formatAppointmentStatus", () => {
  it("maps completed to Thai success label", () => {
    expect(formatAppointmentStatus("completed")).toBe("ให้บริการแล้ว");
  });

  it("maps no_show variants to Thai no-show label", () => {
    expect(formatAppointmentStatus("no_show")).toBe("ลูกค้าไม่มารับบริการ");
    expect(formatAppointmentStatus("no-show")).toBe("ลูกค้าไม่มารับบริการ");
  });

  it("maps cancelled variants to Thai cancelled label", () => {
    expect(formatAppointmentStatus("cancelled")).toBe("ยกเลิกการจอง");
    expect(formatAppointmentStatus("canceled")).toBe("ยกเลิกการจอง");
  });

  it("keeps explicit labels for other known statuses", () => {
    expect(formatAppointmentStatus("booked")).toBe("จองแล้ว");
    expect(formatAppointmentStatus("pending")).toBe("รอยืนยัน");
    expect(formatAppointmentStatus("confirmed")).toBe("ยืนยันแล้ว");
    expect(formatAppointmentStatus("in_progress")).toBe("กำลังให้บริการ");
    expect(formatAppointmentStatus("rescheduled")).toBe("เลื่อนนัด");
  });

  it("uses unknown fallback with raw status", () => {
    expect(formatAppointmentStatus("mystery_state")).toBe(
      "ไม่ทราบสถานะ (mystery_state)"
    );
  });
});

describe("normalizeRow", () => {
  it("keeps appointment usage package id for service confirmation checks", () => {
    const row = normalizeRow({
      appointment_id: "appt-1",
      smooth_usage_customer_package_id: "pkg-usage-1",
      smooth_sessions_total: 10,
      smooth_sessions_used: 2,
    });

    expect(row.smoothUsageCustomerPackageId).toBe("pkg-usage-1");
    expect(row.smooth_usage_customer_package_id).toBe("pkg-usage-1");
  });
});
