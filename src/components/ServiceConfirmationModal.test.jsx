import { describe, expect, it } from "vitest";
import {
  buildActivePackages,
  isRevertableStatus,
} from "./ServiceConfirmationModal";

describe("buildActivePackages", () => {
  it("keeps both 1-session and 3-session packages when both have remaining sessions", () => {
    const packages = [
      {
        customer_package_id: "pkg-1",
        status: "active",
        purchased_at: "2026-02-08T10:00:00.000Z",
        package: {
          sessions_total: 1,
          mask_total: 0,
        },
        usage: {
          sessions_used: 0,
          sessions_remaining: 1,
          mask_used: 0,
          mask_remaining: 0,
        },
      },
      {
        customer_package_id: "pkg-3",
        status: "active",
        purchased_at: "2026-02-07T10:00:00.000Z",
        package: {
          sessions_total: 3,
          mask_total: 1,
        },
        usage: {
          sessions_used: 1,
          sessions_remaining: 2,
          mask_used: 0,
          mask_remaining: 1,
        },
      },
    ];

    const result = buildActivePackages(packages);

    expect(result).toHaveLength(2);
    expect(result.map((pkg) => pkg.customer_package_id)).toEqual(["pkg-3", "pkg-1"]);
  });

  it("keeps 1-session package when remaining > 0", () => {
    const packages = [
      {
        customer_package_id: "pkg-1",
        status: "active",
        package: {
          sessions_total: 1,
          mask_total: 0,
        },
        usage: {
          sessions_used: 0,
          sessions_remaining: 1,
          mask_used: 0,
          mask_remaining: 0,
        },
      },
    ];

    const result = buildActivePackages(packages);

    expect(result).toHaveLength(1);
    expect(result[0].customer_package_id).toBe("pkg-1");
    expect(result[0]._computed.sessionsRemaining).toBe(1);
  });

  it("drops exhausted packages (remaining <= 0)", () => {
    const packages = [
      {
        customer_package_id: "pkg-exhausted",
        status: "active",
        package: {
          sessions_total: 1,
          mask_total: 0,
        },
        usage: {
          sessions_used: 1,
          sessions_remaining: 0,
          mask_used: 0,
          mask_remaining: 0,
        },
      },
    ];

    const result = buildActivePackages(packages);
    expect(result).toHaveLength(0);
  });
});

describe("isRevertableStatus", () => {
  it("allows revert from completed/no_show/cancelled/canceled", () => {
    expect(isRevertableStatus("completed")).toBe(true);
    expect(isRevertableStatus("no_show")).toBe(true);
    expect(isRevertableStatus("cancelled")).toBe(true);
    expect(isRevertableStatus("canceled")).toBe(true);
  });

  it("rejects non-terminal statuses", () => {
    expect(isRevertableStatus("booked")).toBe(false);
    expect(isRevertableStatus("ensured")).toBe(false);
    expect(isRevertableStatus("rescheduled")).toBe(false);
  });
});
