import { describe, expect, it } from "vitest";
import { postalCityForTrace } from "./postal";

describe("postalCityForTrace", () => {
  it("uses Fredericksburg for Stafford 22406 even if GIS says Stafford", () => {
    expect(postalCityForTrace("22406", "STAFFORD")).toBe("Fredericksburg");
    expect(postalCityForTrace("22405-1234", "Stafford")).toBe("Fredericksburg");
  });

  it("uses Stafford for 22554/22556", () => {
    expect(postalCityForTrace("22556", "FREDERICKSBURG")).toBe("Stafford");
    expect(postalCityForTrace("22554-5220", "stafford")).toBe("Stafford");
  });

  it("does not invent Stafford for other DMV cities", () => {
    expect(postalCityForTrace("20814", "BETHESDA")).toBe("Bethesda");
    expect(postalCityForTrace("20001", "")).toBe("");
  });
});
