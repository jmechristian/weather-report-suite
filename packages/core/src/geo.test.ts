import { describe, expect, it } from "vitest";
import { classifyPropertyType, looksLikeNorthernVa } from "./geo";

describe("classifyPropertyType", () => {
  it("maps Stafford APA codes", () => {
    expect(
      classifyPropertyType({ landUse: 1110, singleFamilyCodes: [1110], attachedCodes: [1120], condoCodes: [1130] }),
    ).toBe("single_family");
    expect(
      classifyPropertyType({ landUse: 1120, singleFamilyCodes: [1110], attachedCodes: [1120], condoCodes: [1130] }),
    ).toBe("attached");
  });

  it("treats Fairfax CONDO / ORDINARY", () => {
    expect(classifyPropertyType({ parcelType: "CONDO" })).toBe("condo");
    expect(classifyPropertyType({ parcelType: "ORDINARY" })).toBe("single_family");
  });

  it("does not drop short Loudoun PA_TYPE codes", () => {
    expect(classifyPropertyType({ parcelType: "B" })).toBe("single_family");
    expect(classifyPropertyType({ parcelType: "A" })).toBe("single_family");
  });

  it("treats MD DESCLU Residential as single family", () => {
    expect(classifyPropertyType({ landUse: "Residential" })).toBe("single_family");
  });

  it("treats Frederick TAXPARCELTYPE Parcel - Base as single family", () => {
    expect(classifyPropertyType({ landUse: "Parcel - Base" })).toBe("single_family");
    expect(classifyPropertyType({ parcelType: "Parcel" })).toBe("single_family");
  });

  it("still marks commercial parcels as commercial", () => {
    expect(classifyPropertyType({ landUse: "Commercial Parcel" })).toBe("commercial");
  });

  it("treats a town house label as attached", () => {
    expect(classifyPropertyType({ landUse: "Town House" })).toBe("attached");
  });
});

describe("looksLikeNorthernVa", () => {
  it("accepts the coverage from Baltimore through Richmond", () => {
    expect(looksLikeNorthernVa(-76.49, 38.97)).toBe(true);
    expect(looksLikeNorthernVa(-77.7, 39.1)).toBe(true);
    expect(looksLikeNorthernVa(-77.03, 38.9)).toBe(true);
    expect(looksLikeNorthernVa(-76.61, 39.29)).toBe(true);
    expect(looksLikeNorthernVa(-77.46, 37.54)).toBe(true);
    expect(looksLikeNorthernVa(-77.46, 36.85)).toBe(false);
  });
});
