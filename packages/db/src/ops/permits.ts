import {
  envelopeIntersectParams,
  isReroofText,
  normalizePin,
  paginateFeatures,
  permitSourcesForFips,
  roofSqlWhere,
  sodaRoofWhere,
  streetKey,
  yearFromPermitDate,
  type PermitSource,
} from "@storm-leads/core";
import type { Sql } from "../client";

type ParcelHit = {
  id: string;
  county_fips: string;
  county_parcel_id: string;
  situs_address: string | null;
};

type PermitHit = {
  fips: string;
  parcelId: string | null;
  address: string | null;
  year: number | null;
};

function attr(row: Record<string, unknown>, key?: string): string | null {
  if (!key) return null;
  const found = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
  const value = found ? row[found] : row[key];
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function textBlob(row: Record<string, unknown>, fields: string[]): string {
  return fields.map((f) => attr(row, f) ?? "").join(" ");
}

const PERMIT_FEATURE_CAP = 2000;

async function fetchArcgisPermits(
  source: PermitSource,
  extra: Record<string, string>,
): Promise<PermitHit[]> {
  const urls = (source.layers?.length ? source.layers : [null]).map((layer) =>
    layer == null ? source.url : `${source.url.replace(/\/$/, "")}/${layer}`,
  );
  const out: PermitHit[] = [];
  for (const url of urls) {
    try {
      for await (const page of paginateFeatures(url, {
        extra: { ...extra, where: roofSqlWhere(source.textFields) },
        returnGeometry: false,
        resultRecordCount: 500,
        outFields: [...source.textFields, source.dateField, source.parcelIdField, source.addressField]
          .filter(Boolean)
          .join(","),
      })) {
        for (const feature of page) {
          const row = (feature.properties ?? {}) as Record<string, unknown>;
          if (!isReroofText(textBlob(row, source.textFields))) continue;
          out.push({
            fips: source.fips,
            parcelId: attr(row, source.parcelIdField),
            address: attr(row, source.addressField),
            year: yearFromPermitDate(row[source.dateField] ?? attr(row, source.dateField)),
          });
        }
        if (out.length >= PERMIT_FEATURE_CAP) return out;
      }
    } catch (err) {
      console.warn(`Permit layer skipped ${source.name}`, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

async function fetchSodaPermits(
  source: PermitSource,
  bbox: { west: number; south: number; east: number; north: number },
): Promise<PermitHit[]> {
  const since = `${new Date().getFullYear() - 16}-01-01T00:00:00.000`;
  const where = [
    sodaRoofWhere(source.textFields),
    `issueddate > '${since}'`,
    `within_box(location,${bbox.north},${bbox.west},${bbox.south},${bbox.east})`,
  ].join(" AND ");
  const out: PermitHit[] = [];
  const pageSize = 1000;
  const cap = source.sodaLimit ?? 4000;
  for (let offset = 0; offset < cap; offset += pageSize) {
    const url = new URL(source.url);
    url.searchParams.set("$where", where);
    url.searchParams.set("$limit", String(pageSize));
    url.searchParams.set("$offset", String(offset));
    url.searchParams.set("$order", "issueddate DESC");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/json", "User-Agent": "storm-leads (local-dev)" },
      });
      if (!res.ok) {
        console.warn(`SODA permits ${source.name} ${res.status}`);
        break;
      }
      const rows = (await res.json()) as Record<string, unknown>[];
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        if (!isReroofText(textBlob(row, source.textFields))) continue;
        const parts = (source.addressParts ?? []).map((k) => attr(row, k)).filter(Boolean);
        out.push({
          fips: source.fips,
          parcelId: attr(row, source.parcelIdField),
          address: parts.length ? parts.join(" ") : attr(row, source.addressField),
          year: yearFromPermitDate(row[source.dateField] ?? attr(row, source.dateField)),
        });
      }
      if (rows.length < pageSize) break;
      if (out.length >= (source.sodaLimit ?? PERMIT_FEATURE_CAP)) break;
    } catch (err) {
      console.warn(`SODA permits skipped ${source.name}`, err instanceof Error ? err.message : err);
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

export async function applyReroofPermits(
  client: Sql,
  stormId: string,
  onProgress?: (message: string) => Promise<void>,
): Promise<number> {
  const [storm] = await client<
    { west: number; south: number; east: number; north: number }[]
  >`
    SELECT
      ST_XMin(geom) AS west,
      ST_YMin(geom) AS south,
      ST_XMax(geom) AS east,
      ST_YMax(geom) AS north
    FROM storm_events
    WHERE id = ${stormId}::uuid
  `;
  if (!storm) return 0;

  const counties = await client<{ fips: string; name: string }[]>`
    SELECT c.fips, c.name
    FROM counties c
    JOIN storm_events s ON c.geom IS NOT NULL AND ST_Intersects(c.geom, s.geom)
    WHERE s.id = ${stormId}::uuid
  `;
  const sources = permitSourcesForFips(counties.map((c) => c.fips));
  if (sources.length === 0) return 0;

  await onProgress?.(
    `Checking public roof permits in ${sources.map((s) => s.name).join(", ")}…`,
  );

  const extra = envelopeIntersectParams(
    Number(storm.west),
    Number(storm.south),
    Number(storm.east),
    Number(storm.north),
  );
  const bbox = {
    west: Number(storm.west),
    south: Number(storm.south),
    east: Number(storm.east),
    north: Number(storm.north),
  };

  const permits: PermitHit[] = [];
  for (const source of sources) {
    await onProgress?.(`Checking ${source.name} roof permits…`);
    if (source.kind === "soda") {
      permits.push(...(await fetchSodaPermits(source, bbox)));
    } else {
      permits.push(...(await fetchArcgisPermits(source, extra)));
    }
  }
  if (permits.length === 0) return 0;

  const parcels = await client<ParcelHit[]>`
    SELECT p.id, p.county_fips, p.county_parcel_id, p.situs_address
    FROM parcels p
    JOIN storm_events s ON p.centroid IS NOT NULL AND ST_Intersects(p.centroid, s.geom)
    WHERE s.id = ${stormId}::uuid
  `;
  const byPin = new Map<string, ParcelHit[]>();
  const byStreet = new Map<string, ParcelHit[]>();
  for (const parcel of parcels) {
    const pin = `${parcel.county_fips}:${normalizePin(parcel.county_parcel_id)}`;
    const list = byPin.get(pin) ?? [];
    list.push(parcel);
    byPin.set(pin, list);
    const street = streetKey(parcel.situs_address);
    if (!street) continue;
    const sList = byStreet.get(`${parcel.county_fips}:${street}`) ?? [];
    sList.push(parcel);
    byStreet.set(`${parcel.county_fips}:${street}`, sList);
  }

  const years = new Map<string, number>();
  for (const permit of permits) {
    if (permit.year == null) continue;
    const matches: ParcelHit[] = [];
    if (permit.parcelId) {
      matches.push(...(byPin.get(`${permit.fips}:${normalizePin(permit.parcelId)}`) ?? []));
    }
    const street = streetKey(permit.address);
    if (street && matches.length === 0) {
      matches.push(...(byStreet.get(`${permit.fips}:${street}`) ?? []));
    }
    for (const parcel of matches) {
      const prev = years.get(parcel.id);
      if (prev == null || permit.year > prev) years.set(parcel.id, permit.year);
    }
  }

  if (years.size === 0) return 0;
  const ids = [...years.keys()];
  const yrs = ids.map((id) => years.get(id)!);
  const updated = await client<{ id: string }[]>`
    UPDATE parcels AS p
    SET last_reroof_year = v.year
    FROM unnest(${ids}::uuid[], ${yrs}::int[]) AS v(id, year)
    WHERE p.id = v.id
      AND (p.last_reroof_year IS NULL OR p.last_reroof_year < v.year)
    RETURNING p.id
  `;
  return updated.length;
}