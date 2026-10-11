import { describe, expect, it } from "vitest";
import {
  autocompleteQuery,
  expandStreetSuffix,
  formatParcelIdForTrace,
  formatStaffordApn,
  parcelLookupBody,
  pickCountyMatch,
  pickStaffordMatch,
  resolveFromMatch,
  tracerfyCountyName,
} from "./address";

describe("address resolve", () => {
  it("expands a trailing street suffix", () => {
    expect(expandStreetSuffix("81 WHISPERING PINES LN")).toBe("81 WHISPERING PINES Lane");
    expect(expandStreetSuffix("61 COUNTRY MANOR DR")).toBe("61 COUNTRY MANOR Drive");
  });

  it("prefers the requested county FIPS in autocomplete results", () => {
    const match = pickCountyMatch(
      [
        { street_address: "81 Whispering Pines Lane", city: "Fredericksburg", fips: "51630" },
        { street_address: "81 Whispering Pines Lane", city: "Stafford", fips: "51179" },
      ],
      "51179",
    );
    expect(match?.fips).toBe("51179");
    expect(match?.city).toBe("Stafford");
  });

  it("keeps pickStaffordMatch as a FIPS-specific alias", () => {
    const match = pickStaffordMatch([
      { street_address: "81 Whispering Pines Lane", city: "Fredericksburg", fips: "51630" },
      { street_address: "81 Whispering Pines Lane", city: "Stafford", fips: "51179" },
    ]);
    expect(match?.fips).toBe("51179");
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

  it("collapses DC SSL spaces and title-cases county names for parcel lookup", () => {
    expect(
      formatParcelIdForTrace({ countyFips: "11001", parcelId: "3648    0959" }),
    ).toBe("3648 0959");
    expect(
      formatParcelIdForTrace({ countyFips: "51179", parcelId: " 19D2 9   109" }),
    ).toBe("19D2-9-109");
    expect(tracerfyCountyName("District of Columbia")).toBe("District Of Columbia");
    expect(tracerfyCountyName("Prince George's County")).toBe("Prince George's");
    expect(
      parcelLookupBody({
        address: "48 FLORIDA AVE NE",
        city: "Washington",
        state: "DC",
        zip: "20002",
        countyFips: "11001",
        countyName: "District of Columbia",
        parcelId: "0204    0844",
      }),
    ).toEqual({
      parcel_id: "0204 0844",
      county: "District Of Columbia",
      state: "DC",
    });
  });

  it("uses the canonical street from autocomplete", () => {
    const resolved = resolveFromMatch(
      { address: "81 WHISPERING PINES LN", city: "Stafford", state: "VA", zip: "22556" },
      { street_address: "81 Whispering Pines Lane", city: "Stafford", state: "VA", zip: "22556" },
    );
    expect(resolved.address).toBe("81 Whispering Pines Lane");
  });
});
