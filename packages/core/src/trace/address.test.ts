import { describe, expect, it } from "vitest";
import {
  autocompleteQuery,
  expandStreetSuffix,
  pickStaffordMatch,
  resolveFromMatch,
  formatStaffordApn,
} from "./address";

describe("address resolve", () => {
  it("expands a trailing street suffix", () => {
    expect(expandStreetSuffix("81 WHISPERING PINES LN")).toBe("81 WHISPERING PINES Lane");
    expect(expandStreetSuffix("61 COUNTRY MANOR DR")).toBe("61 COUNTRY MANOR Drive");
  });

  it("prefers a Stafford County autocomplete hit", () => {
    const match = pickStaffordMatch([
      { street_address: "81 Whispering Pines Lane", city: "Fredericksburg", fips: "51630" },
      { street_address: "81 Whispering Pines Lane", city: "Stafford", fips: "51179" },
    ]);
    expect(match?.fips).toBe("51179");
    expect(match?.city).toBe("Stafford");
  });

  it("builds a lookup line Tracerfy can resolve", () => {
    expect(
      autocompleteQuery({
        address: "81 WHISPERING PINES LN",
        city: "Stafford",
        state: "VA",
        zip: "22556",
      }),
    ).toBe("81 WHISPERING PINES Lane, Stafford, VA, 22556");
  });

  it("hyphenates Stafford PRCLID map-insert-section-lot, not page-lot", () => {
    expect(formatStaffordApn({ parcelId: " 19        18E" })).toBe("19-18E");
    expect(formatStaffordApn({ parcelId: " 19H       15" })).toBe("19H-15");
    expect(formatStaffordApn({ parcelId: " 28        2J" })).toBe("28-2J");
    expect(
      formatStaffordApn({
        pageNum: "19",
        captLot: "8",
        parcelId: " 19H  1     8",
      }),
    ).toBe("19H-1-8");
    expect(
      formatStaffordApn({
        pageNum: "19",
        captLot: "109",
        parcelId: " 19D2 9   109",
      }),
    ).toBe("19D2-9-109");
    expect(
      formatStaffordApn({
        pageNum: "19",
        insNum: "H",
        sectNum: "1",
        captLot: "8",
      }),
    ).toBe("19H-1-8");
    expect(formatStaffordApn({ parcelIdAlt: "19-18E" })).toBe("19-18E");
  });

  it("uses the canonical street from autocomplete", () => {
    const resolved = resolveFromMatch(
      { address: "81 WHISPERING PINES LN", city: "Stafford", state: "VA", zip: "22556" },
      { street_address: "81 Whispering Pines Lane", city: "Stafford", state: "VA", zip: "22556" },
    );
    expect(resolved.address).toBe("81 Whispering Pines Lane");
  });
});
