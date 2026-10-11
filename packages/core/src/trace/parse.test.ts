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

  it("keeps DNC, TCPA, line type, mailing, emails, and owner flags", () => {
    const result = parseTracerfyLookup({
      hit: true,
      persons_count: 1,
      credits_deducted: 5,
      persons: [
        {
          full_name: "Paul Gangemi",
          dob: "1940-04",
          age: 66,
          deceased: false,
          property_owner: true,
          litigator: false,
          mailing_address: {
            street: "12124 Mount Albert Rd",
            city: "Ellicott City",
            state: "MD",
            zip: "21042",
          },
          phones: [
            {
              number: "4108632642",
              type: "Mobile",
              dnc: true,
              tcpa: false,
              carrier: "Cellco Partnership dba Verizon Wireless - CA",
              rank: 1,
            },
            {
              number: "7177479989",
              type: "Landline",
              dnc: false,
              tcpa: false,
              carrier: "Verizon North Inc - PA",
              rank: 4,
            },
          ],
          emails: [{ email: "blcnaud@gmail.com", rank: 1 }],
        },
      ],
    });
    expect(result.ownerName).toBe("Paul Gangemi");
    expect(result.ownerAge).toBe(66);
    expect(result.ownerDob).toBe("1940-04");
    expect(result.propertyOwner).toBe(true);
    expect(result.mailingAddressText).toBe("12124 Mount Albert Rd, Ellicott City, MD 21042");
    expect(result.emails).toEqual(["blcnaud@gmail.com"]);
    expect(result.phones[0]).toMatchObject({
      number: "+14108632642",
      lineType: "Mobile",
      dnc: true,
      tcpa: false,
    });
    expect(result.phones[1]).toMatchObject({
      lineType: "Landline",
      dnc: false,
      tcpa: false,
    });
  });
});
