import { describe, expect, it } from "vitest";
import { isSmsEligiblePhone } from "./smsEligible";

describe("isSmsEligiblePhone", () => {
  const clean = {
    lineType: "Mobile",
    dnc: false,
    tcpa: false,
    suppressed: false,
    ownerDeceased: false,
    ownerLitigator: false,
  };

  it("allows a clean mobile", () => {
    expect(isSmsEligiblePhone(clean)).toBe(true);
  });

  it("blocks DNC, TCPA, STOP, landline, and deceased/litigator owners", () => {
    expect(isSmsEligiblePhone({ ...clean, dnc: true })).toBe(false);
    expect(isSmsEligiblePhone({ ...clean, tcpa: true })).toBe(false);
    expect(isSmsEligiblePhone({ ...clean, suppressed: true })).toBe(false);
    expect(isSmsEligiblePhone({ ...clean, lineType: "Landline" })).toBe(false);
    expect(isSmsEligiblePhone({ ...clean, ownerDeceased: true })).toBe(false);
    expect(isSmsEligiblePhone({ ...clean, ownerLitigator: true })).toBe(false);
  });
});
