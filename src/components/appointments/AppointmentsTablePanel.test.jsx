import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AppointmentsTablePanel from "./AppointmentsTablePanel";

function buildRow(index) {
  return {
    appointmentId: `appointment-${index}`,
    date: `2026-03-${String((index % 28) + 1).padStart(2, "0")}`,
    bookingTime: `${String(9 + (index % 8)).padStart(2, "0")}:00`,
    customerName: `Customer ${index}`,
    phone: `08000000${String(index).padStart(2, "0")}`,
    lineId: "-",
    treatmentDisplay: `Treatment ${index}`,
    staffName: `Staff ${index}`,
  };
}

describe("AppointmentsTablePanel", () => {
  it("shows 10 rows per page and allows moving to the next page", async () => {
    const user = userEvent.setup();
    const onOpenDelete = vi.fn();
    const rows = Array.from({ length: 12 }, (_, index) => buildRow(index + 1));

    const view = render(
      <AppointmentsTablePanel
        loading={false}
        hasLoadedOnce
        error=""
        selectedDate={null}
        activeFilterKey=""
        filteredRows={rows}
        onOpenDelete={onOpenDelete}
      />
    );

    const page = within(view.container);

    expect(page.getByText(/แสดง 1-10 จาก 12 รายการ/i)).toBeInTheDocument();
    expect(page.getByText("Customer 1")).toBeInTheDocument();
    expect(page.getByText("Customer 10")).toBeInTheDocument();
    expect(page.queryByText("Customer 11")).not.toBeInTheDocument();

    await user.click(page.getByRole("button", { name: /ถัดไป/i }));

    expect(page.getByText(/แสดง 11-12 จาก 12 รายการ/i)).toBeInTheDocument();
    expect(page.getByText("Customer 11")).toBeInTheDocument();
    expect(page.queryByText("Customer 1")).not.toBeInTheDocument();

    const row = page.getByText("Customer 11").closest("tr");
    await user.click(within(row).getByRole("button", { name: /ลบ/i }));

    expect(onOpenDelete).toHaveBeenCalledWith(rows[10]);
  });

  it("resets back to page 1 when the active filter changes", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 12 }, (_, index) => buildRow(index + 1));

    const view = render(
      <AppointmentsTablePanel
        key="all"
        loading={false}
        hasLoadedOnce
        error=""
        selectedDate={null}
        activeFilterKey="all"
        filteredRows={rows}
        onOpenDelete={vi.fn()}
      />
    );

    let page = within(view.container);

    await user.click(page.getByRole("button", { name: /ถัดไป/i }));
    expect(page.getByText("Customer 11")).toBeInTheDocument();

    view.rerender(
      <AppointmentsTablePanel
        key="filtered"
        loading={false}
        hasLoadedOnce
        error=""
        selectedDate={new Date("2026-03-26T00:00:00.000Z")}
        activeFilterKey="2026-03-26"
        filteredRows={rows.slice(0, 3)}
        onOpenDelete={vi.fn()}
      />
    );

    page = within(view.container);

    expect(page.getByText(/แสดง 1-3 จาก 3 รายการ/i)).toBeInTheDocument();
    expect(page.getByText("Customer 1")).toBeInTheDocument();
    expect(page.queryByText("Customer 11")).not.toBeInTheDocument();
    expect(page.queryByRole("button", { name: /ถัดไป/i })).not.toBeInTheDocument();
  });
});
