import { describe, expect, it } from "vitest";
import { estimateUsageCost } from "./costEstimate";

const month = {
  textsPerDay: 1000,
  segments: 1,
  newLookupsPerDay: 200,
  replyPercent: 10,
  sendDays: 30,
  currentMonthlyUsd: 10_000,
};

describe("usage cost estimate", () => {
  it("prices a month of texts against $10,000 to buy leads and contact them", () => {
    const estimate = estimateUsageCost(month);
    expect(estimate.outboundUsd).toBe(375);
    expect(estimate.inboundUsd).toBe(31.5);
    expect(estimate.lookupsUsd).toBe(600);
    expect(estimate.fixedUsd).toBe(2.65);
    expect(estimate.suiteUsd).toBe(1009.15);
    expect(estimate.currentUsd).toBe(10_000);
    expect(estimate.differenceUsd).toBe(8990.85);
  });

  it("drops the lookup line when those homes are already in the index", () => {
    const estimate = estimateUsageCost({ ...month, newLookupsPerDay: 0 });
    expect(estimate.lookupsUsd).toBe(0);
    expect(estimate.suiteUsd).toBe(409.15);
  });

  it("doubles the text line on a second segment", () => {
    const one = estimateUsageCost(month);
    const two = estimateUsageCost({ ...month, segments: 2 });
    expect(two.outboundUsd).toBe(one.outboundUsd * 2);
    expect(two.suiteUsd).toBe(1384.15);
  });
});
