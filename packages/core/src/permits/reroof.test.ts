import { describe, expect, it } from "vitest";
import { isReroofText, streetKey, yearFromPermitDate } from "./reroof";

describe("isReroofText", () => {
  it("keeps real reroof language", () => {
    expect(isReroofText("Tear off and reroof existing dwelling")).toBe(true);
    expect(isReroofText("Roof replacement with architectural shingles")).toBe(true);
    expect(isReroofText("Rip and reroof", "solar to be reinstalled")).toBe(true);
  });

  it("drops solar-only and roofing-company noise", () => {
    expect(isReroofText("Install 26 roof mounted solar PV panels")).toBe(false);
    expect(isReroofText("POND ROOFING")).toBe(false);
    expect(isReroofText("Roofed porch over existing stoop")).toBe(false);
    expect(isReroofText("Tear off and replace the floor, railing, and steps")).toBe(false);
  });

  it("keeps county work-type labels", () => {
    expect(isReroofText("Roofing-Shingles & Plywood - Residential")).toBe(true);
    expect(isReroofText("Replace the existing roofing with new roofing material")).toBe(true);
  });
});

describe("permit helpers", () => {
  it("parses soda and epoch dates", () => {
    expect(yearFromPermitDate("2023-04-25T06:04:53.000")).toBe(2023);
    expect(yearFromPermitDate(1687037089000)).toBe(2023);
    expect(yearFromPermitDate("1687037089000")).toBe(2023);
  });

  it("normalizes street keys for matching", () => {
    expect(streetKey("5000 WILD OLIVE CT")).toBe(streetKey("5000 Wild Olive Court"));
  });
});