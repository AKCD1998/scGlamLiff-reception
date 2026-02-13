import { describe, expect, it } from "vitest";
import { buildCalendarDaySet } from "./appointmentCalendarUtils";

describe("buildCalendarDaySet", () => {
  it("returns a normalized set of date keys", () => {
    const result = buildCalendarDaySet([
      { date: "2026-02-01" },
      { date: "2026-2-2" },
      { date: "bad" },
      null,
    ]);

    expect(Array.from(result)).toEqual(["2026-02-01", "2026-02-02"]);
  });
});
