import { describe, expect, it } from "vitest";
import { roofAgeFactor, scoreLead, normalizeHailInches, normalizeWindMph } from "./score";

describe("scoreLead", () => {
  it("scores a severe hail core higher than a weak distant wind event", () => {
    const strong = scoreLead({
      eventType: "hail",
      hailIn: 2.5,
      windMph: 70,
      parcelCentroid: [-77.3, 38.85],
      stormCentroid: [-77.3, 38.85],
      stormRadiusKm: 10,
      lsrPoints: [[-77.301, 38.851]],
      yearBuilt: 1995,
      propertyType: "single_family",
      confidence: 0.8,
      ownerOccupied: true,
    });
    const weak = scoreLead({
      eventType: "wind",
      windMph: 55,
      parcelCentroid: [-77.5, 38.9],
      stormCentroid: [-77.2, 38.7],
      stormRadiusKm: 12,
      yearBuilt: 2022,
      propertyType: "condo",
      confidence: 0.3,
      ownerOccupied: false,
    });
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.breakdown.factors.severity).toBeGreaterThan(0.7);
  });

  it("treats missing home age as a mid factor and 20+ years as full intent", () => {
    expect(roofAgeFactor(null, null)).toBe(0.5);
    expect(roofAgeFactor(1990, null, 2026)).toBe(1);
    expect(roofAgeFactor(2006, null, 2026)).toBe(1);
    expect(roofAgeFactor(2007, null, 2026)).toBe(0.75);
    expect(roofAgeFactor(2024, null, 2026)).toBe(0.15);
  });

  it("treats a recent reroof as low intent even on an old house", () => {
    expect(roofAgeFactor(1970, null, 2026, 2022)).toBe(0.15);
    expect(roofAgeFactor(1970, 2020, 2026, null)).toBe(1);
  });

  it("normalizes wind and hail at the warning thresholds", () => {
    expect(normalizeWindMph(50)).toBe(0);
    expect(normalizeWindMph(80)).toBe(1);
    expect(normalizeHailInches(0.75)).toBe(0);
    expect(normalizeHailInches(2.5)).toBe(1);
  });
});
