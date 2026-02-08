import { describe, expect, it } from "vitest";
import { buildActivePackages } from "./ServiceConfirmationModal";

describe("buildActivePackages", () => {
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
