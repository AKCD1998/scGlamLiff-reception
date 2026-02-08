import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import WorkbenchPage from "./WorkbenchPage";
import { getAppointmentsQueue, cancelAppointment } from "../utils/appointmentsApi";
import { getMe, logout } from "../utils/authClient";

vi.mock("./Homepage", () => ({
  default: (props) => (
    <div data-testid="homepage">
      Homepage mock | loading: {String(props.loading)} | rows: {props.rows?.length ?? 0}
    </div>
  ),
}));
vi.mock("./Bookingpage", () => ({ default: () => <div data-testid="bookingpage">Booking mock</div> }));
vi.mock("./AdminBackdate", () => ({ default: () => <div data-testid="adminbackdate">Admin mock</div> }));
vi.mock("./AdminEditAppointment", () => ({
  default: () => <div data-testid="adminedit">Admin Edit mock</div>,
}));

vi.mock("../utils/appointmentsApi", () => ({
  getAppointmentsQueue: vi.fn(),
  cancelAppointment: vi.fn(),
}));
vi.mock("../utils/authClient", () => ({
  getMe: vi.fn(),
  logout: vi.fn(),
}));

beforeEach(() => {
  getMe.mockResolvedValue({
    ok: true,
    data: { display_name: "Test", username: "test", role_name: "staff" },
  });
  getAppointmentsQueue.mockResolvedValue({ ok: true, rows: [] });
  cancelAppointment.mockResolvedValue({ ok: true });
  logout.mockResolvedValue({ ok: true });
});

describe("WorkbenchPage", () => {
  it("renders without crashing", async () => {
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: /workbench/i })).toBeInTheDocument();
    expect(await screen.findByTestId("homepage")).toBeInTheDocument();

    await waitFor(() => {
      expect(getMe).toHaveBeenCalled();
      expect(getAppointmentsQueue).toHaveBeenCalled();
    });
  });

  it("defaults to all dates (no date filter) on first load", async () => {
    render(
      <MemoryRouter>
        <WorkbenchPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(getAppointmentsQueue).toHaveBeenCalled();
    });

    const firstCallArgs = getAppointmentsQueue.mock.calls[0]?.[0] || {};
    expect(firstCallArgs.limit).toBe(50);
    expect(firstCallArgs.date).toBeUndefined();
  });
});
