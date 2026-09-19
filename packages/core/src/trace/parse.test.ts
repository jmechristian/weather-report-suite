import { describe, expect, it } from "vitest";
import { parseTracerfyLookup } from "./parse";

describe("parseTracerfyLookup", () => {
  it("reads persons[].phones and treats body.hit as a hit", () => {
    const result = parseTracerfyLookup({
      hit: true,
      persons_count: 1,
      credits_deducted: 5,
      persons: [
        {
          first_name: "Jane",
          last_name: "Doe",
          full_name: "Jane Doe",
          property_owner: true,
          phones: [{ number: "5405550100", type: "Mobile", rank: 1, dnc: false }],
        },
      ],
    });
    expect(result.hit).toBe(true);
    expect(result.ownerName).toBe("Jane Doe");
    expect(result.phones[0]?.number).toBe("+15405550100");
    expect(result.creditsDeducted).toBe(5);
  });

  it("counts a named owner with no phones as a hit", () => {
    const result = parseTracerfyLookup({
      hit: true,
      persons_count: 1,
      credits_deducted: 5,
      persons: [
        {
          first_name: "Alex",
          last_name: "Owner",
          full_name: "Alex Owner",
          property_owner: true,
          phones: [],
        },
      ],
    });
    expect(result.hit).toBe(true);
    expect(result.ownerName).toBe("Alex Owner");
    expect(result.phones).toEqual([]);
  });

  it("does not bill a miss", () => {
    const result = parseTracerfyLookup({
      hit: false,
      persons_count: 0,
      credits_deducted: 0,
      persons: [],
    });
    expect(result.hit).toBe(false);
    expect(result.creditsDeducted).toBe(0);
  });
});
