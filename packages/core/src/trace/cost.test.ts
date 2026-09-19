import { describe, expect, it } from "vitest";
import {
  TRACE_DEFAULT_LIMIT,
  creditsToUsd,
  estimateTraceCost,
  formatUsd,
  remainingHitTarget,
  maxTraceLookups,
} from "./cost";

describe("trace cost", () => {
  it("prices the default top-25 run at $2.50", () => {
    expect(estimateTraceCost(TRACE_DEFAULT_LIMIT)).toEqual({
      lookups: 25,
      credits: 125,
      usd: 2.5,
    });
    expect(formatUsd(2.5)).toBe("$2.50");
  });

  it("rounds credits to cents", () => {
    expect(creditsToUsd(1)).toBe(0.02);
    expect(estimateTraceCost(0).usd).toBe(0);
  });
});

describe("fill-to-N hits", () => {
  it("only needs the remaining hits", () => {
    expect(remainingHitTarget(17, 25)).toBe(8);
    expect(remainingHitTarget(25, 25)).toBe(0);
    expect(maxTraceLookups(8)).toBe(32);
    expect(maxTraceLookups(0)).toBe(0);
  });
});
