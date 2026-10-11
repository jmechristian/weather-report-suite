import { afterEach, describe, expect, it, vi } from "vitest";
import { TracerfyProvider } from "./tracerfy";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hit(name: string) {
  return {
    hit: true,
    credits_deducted: 5,
    persons: [
      {
        full_name: name,
        property_owner: true,
        phones: [{ number: "2025550100", type: "Mobile", rank: 1 }],
      },
    ],
  };
}

const miss = { hit: false, credits_deducted: 0, persons: [], persons_count: 0 };

const dcInput = {
  address: "48 FLORIDA AVE NE",
  city: "Washington",
  state: "DC",
  zip: "20002",
  countyFips: "11001",
  countyName: "District of Columbia",
  parcelId: "0204    0844",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TracerfyProvider.trace", () => {
  it("looks up any county by APN and skips address when parcel hits", async () => {
    let parcelBody: unknown;
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/trace/parcel/lookup/")) {
        parcelBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse(hit("Parcel Owner"));
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tracer = new TracerfyProvider("test-key");
    const result = await tracer.trace(dcInput);

    expect(result?.hit).toBe(true);
    expect(result?.ownerName).toBe("Parcel Owner");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(parcelBody).toEqual({
      parcel_id: "0204 0844",
      county: "District Of Columbia",
      state: "DC",
    });
  });

  it("falls back to address when parcel misses", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/trace/parcel/lookup/")) return jsonResponse(miss);
      if (url.includes("/trace/lookup/")) return jsonResponse(hit("Address Owner"));
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tracer = new TracerfyProvider("test-key");
    const result = await tracer.trace({
      ...dcInput,
      countyFips: "24027",
      countyName: "Howard",
      state: "MD",
      city: "Ellicott City",
      zip: "21042",
      parcelId: "14-1234567890",
    });

    expect(result?.hit).toBe(true);
    expect(result?.ownerName).toBe("Address Owner");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain("/trace/parcel/lookup/");
    expect(urls[1]).toContain("/trace/lookup/");
  });

  it("falls back to address when parcel lookup errors", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/trace/parcel/lookup/")) return jsonResponse({ error: "nope" }, 400);
      if (url.includes("/trace/lookup/")) return jsonResponse(hit("Address Owner"));
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const tracer = new TracerfyProvider("test-key");
    const result = await tracer.trace(dcInput);

    expect(result?.hit).toBe(true);
    expect(result?.ownerName).toBe("Address Owner");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not call address when there is no street", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/trace/parcel/lookup/")) return jsonResponse(miss);
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const tracer = new TracerfyProvider("test-key");
    const result = await tracer.trace({ ...dcInput, address: "  " });

    expect(result?.hit).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
