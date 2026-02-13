import { describe, expect, it } from "vitest";
import { isE2EName, isTestRecord } from "./isTestRecord";

describe("isE2EName", () => {
  it("matches allowlisted test prefixes only", () => {
    expect(isE2EName("e2e_customer_123")).toBe(true);
    expect(isE2EName("e2e_workflow_403_xxx")).toBe(true);
    expect(isE2EName("verify-staff-abc")).toBe(true);
  });

  it("does not match normal customer names", () => {
    expect(isE2EName("Somchai")).toBe(false);
    expect(isE2EName("Clinic VIP")).toBe(false);
  });
});

describe("isTestRecord", () => {
  it("matches queue/customer row shapes conservatively", () => {
    expect(isTestRecord({ customerName: "e2e_case_1" })).toBe(true);
    expect(isTestRecord({ fullName: "verify-user-1" })).toBe(true);
    expect(isTestRecord({ lineId: "verify-line-99" })).toBe(true);
    expect(isTestRecord({ customerName: "ประวิทย์" })).toBe(false);
  });
});
