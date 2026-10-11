import type { SkipTraceProvider, TraceInput, TraceResult } from "../types";
import {
  expandStreetSuffix,
  hasStreetAddress,
  parcelLookupBody,
  traceState,
} from "./address";
import { parseTracerfyLookup } from "./parse";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withCredits(result: TraceResult, extra: number): TraceResult {
  if (!extra) return result;
  return { ...result, creditsDeducted: (result.creditsDeducted ?? 0) + extra };
}

export class TracerfyProvider implements SkipTraceProvider {
  name = "tracerfy";

  constructor(private readonly apiKey: string) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async postJson(url: string, body: unknown, attempt = 0): Promise<Response> {
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 2) {
      await sleep(2000 * (attempt + 1));
      return this.postJson(url, body, attempt + 1);
    }
    return res;
  }

  async traceByApn(
    parcelId: string,
    county: string,
    state: string,
  ): Promise<TraceResult | null> {
    const res = await this.postJson("https://tracerfy.com/v1/api/trace/parcel/lookup/", {
      parcel_id: parcelId,
      county,
      state,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tracerfy APN lookup failed ${res.status}: ${text.slice(0, 400)}`);
    }
    return parseTracerfyLookup(await res.json());
  }

  async traceByAddress(input: TraceInput): Promise<TraceResult | null> {
    const res = await this.postJson("https://tracerfy.com/v1/api/trace/lookup/", {
      address: expandStreetSuffix(input.address),
      city: input.city,
      state: traceState(input),
      zip: input.zip,
      find_owner: true,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tracerfy lookup failed ${res.status}: ${text.slice(0, 400)}`);
    }
    return parseTracerfyLookup(await res.json());
  }

  async trace(input: TraceInput): Promise<TraceResult | null> {
    const parcel = parcelLookupBody(input);
    let priorCredits = 0;
    if (parcel) {
      try {
        const byApn = await this.traceByApn(parcel.parcel_id, parcel.county, parcel.state);
        if (byApn?.hit) return byApn;
        priorCredits += byApn?.creditsDeducted ?? 0;
      } catch (err) {
        console.warn("Tracerfy APN lookup skipped", parcel, err);
      }
    }
    if (hasStreetAddress(input)) {
      const byAddress = await this.traceByAddress(input);
      return byAddress ? withCredits(byAddress, priorCredits) : byAddress;
    }
    if (parcel) {
      return { hit: false, phones: [], emails: [], raw: { parcel }, creditsDeducted: priorCredits };
    }
    return { hit: false, phones: [], emails: [], raw: { skipped: "no_parcel_or_address" }, creditsDeducted: 0 };
  }

  async traceBatch(
    inputs: TraceInput[],
    webhookUrl?: string,
  ): Promise<{ jobId: string }> {
    const header = "address,city,state,zip";
    const rows = inputs.map(
      (i) =>
        `"${i.address.replaceAll('"', '""')}","${i.city}","${i.state}","${i.zip}"`,
    );
    const csv = [header, ...rows].join("\n");
    const res = await this.postJson("https://tracerfy.com/v1/api/trace/", {
      csv,
      webhook_url: webhookUrl,
      trace_type: "normal",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tracerfy batch failed ${res.status}: ${text.slice(0, 400)}`);
    }
    const body = (await res.json()) as Record<string, unknown>;
    const jobId = String(body.id ?? body.job_id ?? body.queue_id ?? "");
    if (!jobId) throw new Error("Tracerfy batch did not return a job id");
    return { jobId };
  }
}
