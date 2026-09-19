import { looksLikeNorthernVa } from "../geo";

const DEFAULT_PAGE = 1000;
const MIN_INTERVAL_MS = 500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class ArcgisError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ArcgisError";
  }
}

type QueryOptions = {
  where?: string;
  outFields?: string;
  returnGeometry?: boolean;
  resultRecordCount?: number;
  extra?: Record<string, string>;
};

type GeoJsonFc = GeoJSON.FeatureCollection<GeoJSON.Geometry | null>;

async function fetchWithRetry(url: string, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { Accept: "application/json", ...init?.headers },
      });
      if (res.status >= 502 && res.status <= 504) {
        throw new ArcgisError(`ArcGIS ${res.status}`, res.status);
      }
      return res;
    } catch (err) {
      lastError = err instanceof Error && err.name === "AbortError"
        ? new ArcgisError(`ArcGIS timed out: ${url}`)
        : err;
      await sleep(400 * 2 ** i);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new ArcgisError(String(lastError));
}

function buildQueryUrl(
  serviceUrl: string,
  params: Record<string, string | number | boolean>,
): string {
  const base = serviceUrl.replace(/\/$/, "");
  const queryUrl = base.endsWith("/query") ? base : `${base}/query`;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    search.set(k, String(v));
  }
  return `${queryUrl}?${search.toString()}`;
}

function queryEndpoint(serviceUrl: string): string {
  const base = serviceUrl.replace(/\/$/, "");
  return base.endsWith("/query") ? base : `${base}/query`;
}

async function postQuery(
  serviceUrl: string,
  params: Record<string, string | number | boolean>,
): Promise<Response> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  return fetchWithRetry(queryEndpoint(serviceUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

export async function describeLayer(serviceUrl: string): Promise<{
  name: string;
  fields: string[];
  maxRecordCount: number;
}> {
  const url = `${serviceUrl.replace(/\/$/, "")}?f=json`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new ArcgisError(`ArcGIS layer metadata failed ${res.status} ${url}`, res.status);
  }
  const body = (await res.json()) as {
    name?: string;
    fields?: Array<{ name: string }>;
    maxRecordCount?: number;
    error?: { message?: string };
  };
  if (body.error?.message) throw new ArcgisError(body.error.message);
  if (!body.fields?.length) {
    throw new ArcgisError(`Not an ArcGIS layer (no fields): ${serviceUrl}`);
  }
  return {
    name: body.name ?? serviceUrl,
    fields: body.fields.map((f) => f.name),
    maxRecordCount: body.maxRecordCount ?? DEFAULT_PAGE,
  };
}

export function envelopeIntersectParams(
  west: number,
  south: number,
  east: number,
  north: number,
): Record<string, string> {
  return {
    geometry: JSON.stringify({
      xmin: west,
      ymin: south,
      xmax: east,
      ymax: north,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
  };
}

export function bufferEnvelope(
  lon: number,
  lat: number,
  deg: number,
): Record<string, string> {
  return envelopeIntersectParams(lon - deg, lat - deg, lon + deg, lat + deg);
}

export async function queryFeaturePage(
  serviceUrl: string,
  offset: number,
  options: QueryOptions = {},
  oidField: "OBJECTID" | "objectid" | null = "OBJECTID",
): Promise<{ features: GeoJSON.Feature<GeoJSON.Geometry | null>[]; exceededTransferLimit: boolean }> {
  const wantGeom = options.returnGeometry ?? true;
  const params: Record<string, string | number | boolean> = {
    where: options.where ?? "1=1",
    outFields: options.outFields ?? "*",
    returnGeometry: wantGeom,
    outSR: 4326,
    f: "geojson",
    resultOffset: offset,
    resultRecordCount: options.resultRecordCount ?? DEFAULT_PAGE,
    ...(oidField ? { orderByFields: oidField } : {}),
    ...options.extra,
  };
  const res = options.extra
    ? await postQuery(serviceUrl, params)
    : await fetchWithRetry(buildQueryUrl(serviceUrl, params));
  const text = await res.text();
  let body: (GeoJsonFc & { exceededTransferLimit?: boolean; error?: { message?: string } }) | null =
    null;
  try {
    body = JSON.parse(text) as GeoJsonFc & {
      exceededTransferLimit?: boolean;
      error?: { message?: string };
    };
  } catch {
    body = null;
  }
  const errMsg = body?.error?.message ?? (!res.ok ? text.slice(0, 240) : "");
  if (!res.ok || body?.error?.message) {
    const oidIssue = /orderBy|OBJECTID|objectid|does not exist/i.test(errMsg);
    if (oidIssue && oidField === "OBJECTID") {
      return queryFeaturePage(serviceUrl, offset, options, "objectid");
    }
    if (oidIssue && oidField === "objectid") {
      return queryFeaturePage(serviceUrl, offset, options, null);
    }
    throw new ArcgisError(errMsg || `ArcGIS query failed ${res.status} ${serviceUrl}`, res.status);
  }
  if (!body) {
    throw new ArcgisError(`ArcGIS query failed ${res.status} ${serviceUrl}`, res.status);
  }
  let features = body.features ?? [];
  if (wantGeom) {
    features = features.filter((f) => f.geometry != null);
  }
  if (wantGeom && features.length > 0) {
    const geom = features[0]?.geometry;
    if (geom && "coordinates" in geom) {
      const sample = sampleCoord(geom);
      if (sample && !looksLikeNorthernVa(sample[0], sample[1])) {
        throw new ArcgisError(
          `Expected EPSG:4326 lon/lat around Northern VA, got ${sample[0]}, ${sample[1]}`,
        );
      }
    }
  }
  return {
    features,
    exceededTransferLimit: Boolean(body.exceededTransferLimit),
  };
}

function sampleCoord(geom: GeoJSON.Geometry): [number, number] | null {
  switch (geom.type) {
    case "Point": {
      const [lon, lat] = geom.coordinates;
      return lon == null || lat == null ? null : [lon, lat];
    }
    case "MultiPoint":
    case "LineString": {
      const first = geom.coordinates[0];
      return first && first[0] != null && first[1] != null ? [first[0], first[1]] : null;
    }
    case "Polygon": {
      const first = geom.coordinates[0]?.[0];
      return first && first[0] != null && first[1] != null ? [first[0], first[1]] : null;
    }
    case "MultiPolygon": {
      const first = geom.coordinates[0]?.[0]?.[0];
      return first && first[0] != null && first[1] != null ? [first[0], first[1]] : null;
    }
    default:
      return null;
  }
}

export async function* paginateFeatures(
  serviceUrl: string,
  options: QueryOptions = {},
): AsyncGenerator<GeoJSON.Feature<GeoJSON.Geometry | null>[]> {
  let offset = 0;
  const pageSize = options.resultRecordCount ?? DEFAULT_PAGE;
  while (true) {
    const started = Date.now();
    const page = await queryFeaturePage(serviceUrl, offset, options);
    if (page.features.length === 0) break;
    yield page.features;
    offset += page.features.length;
    if (!page.exceededTransferLimit && page.features.length < pageSize) break;
    const wait = MIN_INTERVAL_MS - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
}

export async function paginateAttributeRows(
  serviceUrl: string,
  options: QueryOptions = {},
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let offset = 0;
  const pageSize = options.resultRecordCount ?? DEFAULT_PAGE;
  let ordered = true;
  while (true) {
    const started = Date.now();
    const url = buildQueryUrl(serviceUrl, {
      where: options.where ?? "1=1",
      outFields: options.outFields ?? "*",
      returnGeometry: false,
      f: "json",
      resultOffset: offset,
      resultRecordCount: pageSize,
      ...(ordered ? { orderByFields: "OBJECTID" } : {}),
    });
    const res = await fetchWithRetry(url);
    if (!res.ok) throw new ArcgisError(`ArcGIS table query failed ${res.status}`, res.status);
    const body = (await res.json()) as {
      features?: Array<{ attributes: Record<string, unknown> }>;
      exceededTransferLimit?: boolean;
      error?: { message?: string };
    };
    if (body.error?.message) {
      if (ordered && /orderBy/i.test(body.error.message)) {
        ordered = false;
        continue;
      }
      throw new ArcgisError(body.error.message);
    }
    const features = body.features ?? [];
    if (features.length === 0) break;
    for (const f of features) rows.push(f.attributes);
    offset += features.length;
    if (!body.exceededTransferLimit && features.length < pageSize) break;
    const wait = MIN_INTERVAL_MS - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  return rows;
}
