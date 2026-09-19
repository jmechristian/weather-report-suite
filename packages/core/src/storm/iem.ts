import { pickEventType } from "../scoring/score";
import { toMultiPolygon } from "../geo";
import type { StormEventInput, StormReportInput } from "../types";

type IemFeature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;

const IEM_PAGE_CAP = 10000;
const MIN_SPLIT_MS = 6 * 60 * 60 * 1000;

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseIemDate(value: unknown): Date {
  const s = String(value ?? "");
  if (!s) return new Date();
  const iso = s.endsWith("Z") || s.includes("+") ? s : `${s}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(s) : d;
}

function iemStamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function fetchGeoJson(url: URL): Promise<GeoJSON.FeatureCollection> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "storm-leads (local-dev)",
      },
    });
    if (!res.ok) throw new Error(`IEM fetch failed ${res.status} ${url}`);
    return (await res.json()) as GeoJSON.FeatureCollection;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeaturesSplit(
  buildUrl: (from: Date, to: Date) => URL[],
  from: Date,
  to: Date,
): Promise<IemFeature[]> {
  let body: GeoJSON.FeatureCollection | null = null;
  let lastErr: unknown;
  for (const url of buildUrl(from, to)) {
    try {
      body = await fetchGeoJson(url);
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!body) throw lastErr instanceof Error ? lastErr : new Error("IEM fetch failed");
  const features = (body.features ?? []) as IemFeature[];
  if (features.length >= IEM_PAGE_CAP && to.getTime() - from.getTime() > MIN_SPLIT_MS) {
    const mid = new Date((from.getTime() + to.getTime()) / 2);
    const left = await fetchFeaturesSplit(buildUrl, from, mid);
    const right = await fetchFeaturesSplit(buildUrl, mid, to);
    return [...left, ...right];
  }
  return features;
}

function dateChunks(from: Date, to: Date, days: number): Array<[Date, Date]> {
  const step = days * 24 * 60 * 60 * 1000;
  const chunks: Array<[Date, Date]> = [];
  let cursor = from.getTime();
  const end = to.getTime();
  while (cursor < end) {
    const next = Math.min(end, cursor + step);
    chunks.push([new Date(cursor), new Date(next)]);
    cursor = next;
  }
  return chunks;
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function sbwUrls(from: Date, to: Date, wfo: string): URL[] {
  return [
    "https://mesonet.agron.iastate.edu/geojson/sbw.geojson",
    "https://mesonet.agron.iastate.edu/geojson/sbw.py",
  ].map((raw) => {
    const url = new URL(raw);
    url.searchParams.set("sts", iemStamp(from));
    url.searchParams.set("ets", iemStamp(to));
    url.searchParams.set("wfo", wfo);
    return url;
  });
}

function lsrUrls(from: Date, to: Date, wfo: string): URL[] {
  return [
    "https://mesonet.agron.iastate.edu/geojson/lsr.py",
    "https://mesonet.agron.iastate.edu/geojson/lsr.geojson",
  ].map((raw) => {
    const url = new URL(raw);
    url.searchParams.set("sts", iemStamp(from));
    url.searchParams.set("ets", iemStamp(to));
    url.searchParams.set("wfo", wfo);
    return url;
  });
}

export async function fetchIemSbw(from: Date, to: Date, wfo = "LWX"): Promise<StormEventInput[]> {
  const features: IemFeature[] = [];
  const chunks = dateChunks(from, to, 30);
  for (let i = 0; i < chunks.length; i++) {
    const [start, end] = chunks[i]!;
    console.log(`IEM SBW ${wfo} ${i + 1}/${chunks.length} ${start.toISOString().slice(0, 10)}`);
    features.push(...(await fetchFeaturesSplit((a, b) => sbwUrls(a, b, wfo), start, end)));
  }
  const out: StormEventInput[] = [];
  for (const feat of features) {
    const p = feat.properties ?? {};
    const phenomena = String(p.phenomena ?? p.ps ?? "").slice(0, 2).toUpperCase();
    const significance = String(p.significance ?? "W").slice(0, 1).toUpperCase();
    if (!["SV", "TO"].includes(phenomena) || significance !== "W") continue;
    if (!feat.geometry || (feat.geometry.type !== "Polygon" && feat.geometry.type !== "MultiPolygon")) {
      continue;
    }
    const windMph = num(p.max_windtag ?? p.windtag);
    const hailIn = num(p.max_hailtag ?? p.hailtag);
    const eventType = phenomena === "TO" ? "tornado" : pickEventType(windMph, hailIn);
    const issue = String(p.issue ?? p.utc_issue ?? p.issued ?? "");
    const wfoId = String(p.wfo ?? wfo);
    const etn = String(p.eventid ?? p.etn ?? p.href ?? "");
    out.push({
      externalId: `${wfoId}-${phenomena}-${significance}-${etn}-${issue}`,
      eventType,
      occurredAt: parseIemDate(p.issue ?? p.utc_issue ?? p.issued),
      expiresAt: p.expire || p.utc_expire ? parseIemDate(p.expire ?? p.utc_expire) : null,
      geometry: toMultiPolygon(feat.geometry),
      windMph,
      hailIn,
      source: "iem_sbw",
      confidence: 0.35,
      raw: p,
    });
  }
  return dedupe(out, (e) => `${e.source}:${e.externalId}`);
}

const LSR_KEEP = new Set([
  "HAIL",
  "TSTM WND GST",
  "TSTM WND DMG",
  "THUNDERSTORM WIND",
  "NON-TSTM WND GST",
  "NON-TSTM WND DMG",
  "TORNADO",
]);

export async function fetchIemLsr(from: Date, to: Date, wfo = "LWX"): Promise<StormReportInput[]> {
  const features: IemFeature[] = [];
  const chunks = dateChunks(from, to, 14);
  for (let i = 0; i < chunks.length; i++) {
    const [start, end] = chunks[i]!;
    console.log(`IEM LSR ${wfo} ${i + 1}/${chunks.length} ${start.toISOString().slice(0, 10)}`);
    features.push(...(await fetchFeaturesSplit((a, b) => lsrUrls(a, b, wfo), start, end)));
  }
  const out: StormReportInput[] = [];
  for (const feat of features) {
    const p = feat.properties ?? {};
    const type = String(p.typetext ?? p.type ?? "").toUpperCase();
    if (!LSR_KEEP.has(type) && !type.includes("HAIL") && !type.includes("WND") && type !== "TORNADO") {
      continue;
    }
    if (feat.geometry?.type !== "Point") continue;
    const lon = feat.geometry.coordinates[0];
    const lat = feat.geometry.coordinates[1];
    if (lon == null || lat == null) continue;
    const mag = num(p.magnitude ?? p.magf ?? p.mag);
    let reportType: StormReportInput["reportType"] = "other";
    if (type.includes("HAIL")) reportType = "hail";
    else if (type.includes("TORNADO")) reportType = "tornado";
    else if (type.includes("DMG")) reportType = "wind_damage";
    else if (type.includes("WND") || type.includes("WIND")) reportType = "wind";
    const valid = String(p.valid ?? p.utc_valid ?? p.product_issued ?? "");
    out.push({
      externalId: `${p.wfo ?? wfo}-${valid}-${lon}-${lat}-${type}`,
      reportType,
      occurredAt: parseIemDate(p.valid ?? p.utc_valid),
      longitude: lon,
      latitude: lat,
      magnitude: mag,
      magnitudeUnit: reportType === "hail" ? "in" : "mph",
      source: "iem_lsr",
      raw: p,
    });
  }
  return dedupe(out, (r) => `${r.source}:${r.externalId}`);
}

export async function fetchNwsAlerts(
  userAgent: string,
  areas: string[] = ["VA", "MD", "DC"],
): Promise<StormEventInput[]> {
  const collections = await Promise.all(
    areas.map(async (area) => {
      const res = await fetch(`https://api.weather.gov/alerts?area=${area}&status=actual`, {
        headers: {
          "User-Agent": userAgent,
          Accept: "application/geo+json",
        },
      });
      if (!res.ok) {
        console.warn(`NWS alerts skipped ${res.status} (${area})`);
        return { type: "FeatureCollection" as const, features: [] };
      }
      return (await res.json()) as GeoJSON.FeatureCollection;
    }),
  );
  const body: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: collections.flatMap((c) => c.features ?? []),
  };
  const keep = new Set(["Severe Thunderstorm Warning", "Tornado Warning"]);
  const out: StormEventInput[] = [];
  for (const f of body.features ?? []) {
    const feat = f as IemFeature;
    const p = feat.properties ?? {};
    if (!keep.has(String(p.event))) continue;
    if (!feat.geometry || (feat.geometry.type !== "Polygon" && feat.geometry.type !== "MultiPolygon")) {
      continue;
    }
    const eventType = String(p.event).includes("Tornado") ? "tornado" : "wind";
    out.push({
      externalId: String(p.id ?? p["@id"] ?? crypto.randomUUID()),
      eventType,
      occurredAt: new Date(String(p.onset ?? p.effective ?? p.sent)),
      expiresAt: p.ends || p.expires ? new Date(String(p.ends ?? p.expires)) : null,
      geometry: toMultiPolygon(feat.geometry),
      windMph: null,
      hailIn: null,
      source: "nws_warning",
      confidence: 0.3,
      raw: p,
    });
  }
  return dedupe(out, (e) => `${e.source}:${e.externalId}`);
}
