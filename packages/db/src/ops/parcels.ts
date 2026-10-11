import {
  DMV_COUNTIES,
  SCORE_PARCEL_CAP,
  bufferEnvelope,
  classifyPropertyType,
  envelopeIntersectParams,
  normalizePin,
  paginateFeatures,
  type CountyFieldMap,
} from "@storm-leads/core";
import type { Sql } from "../client";

type CountyRow = {
  fips: string;
  name: string;
  state: string;
  parcel_service_url: string;
  address_service_url: string | null;
  field_map: CountyFieldMap;
};

export type FetchParcelsResult = {
  upserted: number;
  skipped: number;
  counties: string[];
  missingLayers: string[];
};

type MappedParcel = {
  parcelId: string;
  geojson: string;
  situsAddress: string | null;
  situsCity: string | null;
  situsZip: string | null;
  propertyType: string;
  yearBuilt: number | null;
  yearRemodeled: number | null;
  raw: string;
};

function attr(attrs: Record<string, unknown>, key?: string): unknown {
  if (!key) return undefined;
  if (key in attrs) return attrs[key];
  const found = Object.keys(attrs).find((k) => k.toLowerCase() === key.toLowerCase());
  return found ? attrs[found] : undefined;
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function int(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizeZip(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 5) return digits.slice(-5);
  return value;
}

function composeAddress(attrs: Record<string, unknown>, fieldMap: CountyFieldMap): string | null {
  const direct = str(attr(attrs, fieldMap.address));
  if (direct) return direct;
  if (!fieldMap.addressParts?.length) return null;
  const parts = fieldMap.addressParts.map((key) => str(attr(attrs, key))).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function geometryJson(geom: GeoJSON.Geometry | null | undefined): string | null {
  if (!geom) return null;
  if (geom.type === "Polygon") {
    return JSON.stringify({ type: "MultiPolygon", coordinates: [geom.coordinates] });
  }
  if (geom.type === "MultiPolygon") return JSON.stringify(geom);
  return null;
}

function hasParcelLayer(url: string | null | undefined): url is string {
  return Boolean(url && url.startsWith("http"));
}

function yearValue(value: unknown): number | null {
  const n = int(value);
  if (n == null || n < 1800 || n > new Date().getFullYear() + 1) return null;
  return n;
}

function yearFromAttrs(attrs: Record<string, unknown>, fieldMap: CountyFieldMap): {
  yearBuilt: number | null;
  yearRemodeled: number | null;
} {
  return {
    yearBuilt: yearValue(attr(attrs, fieldMap.yearBuilt)) ?? yearValue(attr(attrs, fieldMap.yearBuiltAlt)),
    yearRemodeled: yearValue(attr(attrs, fieldMap.yearRemodeled)),
  };
}

function catalogFieldMap(fips: string, fallback: CountyFieldMap): CountyFieldMap {
  return DMV_COUNTIES.find((c) => c.fips === fips)?.fieldMap ?? fallback;
}

function sqlQuotedList(values: string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",");
}

async function loadYearIndex(
  url: string,
  idField: string,
  fieldMap: CountyFieldMap,
  parcelIds: string[],
): Promise<Map<string, { yearBuilt: number | null; yearRemodeled: number | null }>> {
  const map = new Map<string, { yearBuilt: number | null; yearRemodeled: number | null }>();
  if (!idField || parcelIds.length === 0) return map;
  const chunkSize = 80;
  try {
    for (let i = 0; i < parcelIds.length; i += chunkSize) {
      const chunk = parcelIds.slice(i, i + chunkSize);
      const where = `${idField} IN (${sqlQuotedList(chunk)})`;
      for await (const page of paginateFeatures(url, {
        extra: { where },
        returnGeometry: false,
        resultRecordCount: 500,
        outFields: [idField, fieldMap.yearBuilt, fieldMap.yearRemodeled, fieldMap.yearBuiltAlt]
          .filter(Boolean)
          .join(","),
      })) {
        for (const feature of page) {
          const attrs = (feature.properties ?? {}) as Record<string, unknown>;
          const rawId = str(attr(attrs, idField));
          if (!rawId) continue;
          const years = yearFromAttrs(attrs, fieldMap);
          map.set(normalizePin(rawId), years);
          map.set(rawId, years);
        }
      }
    }
  } catch (err) {
    console.warn("Year layer skipped", url, err);
  }
  return map;
}

async function loadAddressIndex(
  url: string,
  fieldMap: CountyFieldMap,
  extra: Record<string, string>,
): Promise<Map<string, { address: string | null; city: string | null; zip: string | null }>> {
  const map = new Map<string, { address: string | null; city: string | null; zip: string | null }>();
  const joinKey = fieldMap.addressJoin;
  if (!joinKey) return map;
  try {
    for await (const page of paginateFeatures(url, {
      extra,
      returnGeometry: false,
      resultRecordCount: 500,
      outFields: [joinKey, fieldMap.address, fieldMap.city, fieldMap.zip]
        .filter(Boolean)
        .join(","),
    })) {
      for (const feature of page) {
        const attrs = (feature.properties ?? {}) as Record<string, unknown>;
        const key = normalizePin(str(attr(attrs, joinKey)));
        if (!key || map.has(key)) continue;
        map.set(key, {
          address: composeAddress(attrs, fieldMap),
          city: str(attr(attrs, fieldMap.city)),
          zip: normalizeZip(str(attr(attrs, fieldMap.zip))),
        });
      }
    }
  } catch (err) {
    console.warn("Address layer skipped", url, err);
  }
  return map;
}

async function flush(
  client: Sql,
  fips: string,
  state: string,
  batch: MappedParcel[],
): Promise<number> {
  if (batch.length === 0) return 0;
  await client.begin(async (tx) => {
    for (const row of batch) {
      await tx`
        INSERT INTO parcels (
          county_fips, county_parcel_id, geom, centroid,
          situs_address, situs_city, situs_zip, situs_state,
          property_type, year_built, year_remodeled, last_synced_at, raw
        ) VALUES (
          ${fips},
          ${row.parcelId},
          ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${row.geojson}), 4326)), 3)),
          ST_PointOnSurface(
            ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${row.geojson}), 4326)), 3))
          ),
          ${row.situsAddress},
          ${row.situsCity},
          ${row.situsZip},
          ${state},
          ${row.propertyType},
          ${row.yearBuilt},
          ${row.yearRemodeled},
          now(),
          ${row.raw}::jsonb
        )
        ON CONFLICT (county_fips, county_parcel_id) DO UPDATE SET
          geom = EXCLUDED.geom,
          centroid = EXCLUDED.centroid,
          situs_address = COALESCE(EXCLUDED.situs_address, parcels.situs_address),
          situs_city = COALESCE(EXCLUDED.situs_city, parcels.situs_city),
          situs_zip = COALESCE(EXCLUDED.situs_zip, parcels.situs_zip),
          situs_state = EXCLUDED.situs_state,
          property_type = EXCLUDED.property_type,
          year_built = COALESCE(EXCLUDED.year_built, parcels.year_built),
          year_remodeled = COALESCE(EXCLUDED.year_remodeled, parcels.year_remodeled),
          last_synced_at = now(),
          raw = EXCLUDED.raw
      `;
    }
  });
  return batch.length;
}

function queryEnvelopes(
  storm: { west: number; south: number; east: number; north: number; lon: number; lat: number },
  lsrs: Array<{ lon: number; lat: number }>,
): Record<string, string>[] {
  const wide = storm.east - storm.west > 0.12 || storm.north - storm.south > 0.12;
  const extras: Record<string, string>[] = [];
  const seen = new Set<string>();
  const push = (extra: Record<string, string>) => {
    const key = extra.geometry;
    if (seen.has(key)) return;
    seen.add(key);
    extras.push(extra);
  };
  for (const lsr of lsrs.slice(0, 6)) {
    push(bufferEnvelope(lsr.lon, lsr.lat, 0.02));
  }
  push(bufferEnvelope(storm.lon, storm.lat, 0.04));
  if (!wide) {
    push(envelopeIntersectParams(storm.west, storm.south, storm.east, storm.north));
  }
  return extras;
}

export async function fetchStormParcels(
  client: Sql,
  stormId: string,
  options: {
    cap?: number;
    onProgress?: (message: string) => Promise<void>;
  } = {},
): Promise<FetchParcelsResult> {
  const cap = options.cap ?? SCORE_PARCEL_CAP;
  const [storm] = await client<
    {
      west: number;
      south: number;
      east: number;
      north: number;
      lon: number;
      lat: number;
    }[]
  >`
    SELECT
      ST_XMin(geom) AS west,
      ST_YMin(geom) AS south,
      ST_XMax(geom) AS east,
      ST_YMax(geom) AS north,
      ST_X(ST_PointOnSurface(geom)) AS lon,
      ST_Y(ST_PointOnSurface(geom)) AS lat
    FROM storm_events
    WHERE id = ${stormId}::uuid
  `;
  if (!storm) throw new Error("Storm not found");

  const lsrs = await client<{ lon: number; lat: number }[]>`
    SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat
    FROM storm_reports
    WHERE storm_event_id = ${stormId}::uuid
  `;
  const counties = await client<CountyRow[]>`
    SELECT
      c.fips,
      c.name,
      c.state,
      c.parcel_service_url,
      c.address_service_url,
      c.field_map
    FROM counties c
    JOIN storm_events s ON c.geom IS NOT NULL AND ST_Intersects(c.geom, s.geom)
    WHERE s.id = ${stormId}::uuid
  `;

  const extras = queryEnvelopes(
    {
      west: Number(storm.west),
      south: Number(storm.south),
      east: Number(storm.east),
      north: Number(storm.north),
      lon: Number(storm.lon),
      lat: Number(storm.lat),
    },
    lsrs.map((r) => ({ lon: Number(r.lon), lat: Number(r.lat) })),
  );

  let upserted = 0;
  let skipped = 0;
  const touched: string[] = [];
  const missingLayers: string[] = [];

  for (const county of counties) {
    if (upserted >= cap) break;
    if (!hasParcelLayer(county.parcel_service_url)) {
      missingLayers.push(county.name);
      continue;
    }
    const fieldMap = catalogFieldMap(county.fips, county.field_map);
    const dwellingUrl = fieldMap.layers?.dwelling;
    const dwellingId = fieldMap.assessorId ?? fieldMap.parcelId;
    touched.push(county.name);
    await options.onProgress?.(
      `Fetching ${county.name} homes inside the warning (cap ${cap.toLocaleString()})…`,
    );
    try {
      for (const extra of extras) {
        if (upserted >= cap) break;
        const addresses =
          hasParcelLayer(county.address_service_url) && fieldMap.addressJoin
            ? await loadAddressIndex(county.address_service_url, fieldMap, extra)
            : new Map();
        const batch: MappedParcel[] = [];
        for await (const page of paginateFeatures(county.parcel_service_url, {
          extra,
          resultRecordCount: 500,
        })) {
          const candidates: Array<{
            parcelId: string;
            geojson: string;
            attrs: Record<string, unknown>;
            propertyType: string;
          }> = [];
          for (const feature of page) {
            if (upserted + batch.length + candidates.length >= cap) break;
            const attrs = (feature.properties ?? {}) as Record<string, unknown>;
            const parcelId = str(attr(attrs, fieldMap.parcelId)) ?? str(attr(attrs, fieldMap.parcelIdAlt));
            const geojson = geometryJson(feature.geometry);
            if (!parcelId || !geojson) {
              skipped += 1;
              continue;
            }
            if (String(attr(attrs, "UNDERLIES_CONDO") ?? "").toUpperCase() === "Y") {
              skipped += 1;
              continue;
            }
            const propertyType = classifyPropertyType({
              landUse: attr(attrs, fieldMap.landUse),
              parcelType: attr(attrs, fieldMap.parcelType),
              singleFamilyCodes: fieldMap.singleFamilyCodes,
              attachedCodes: fieldMap.attachedCodes,
              condoCodes: fieldMap.condoCodes,
            });
            if (propertyType !== "single_family") {
              skipped += 1;
              continue;
            }
            candidates.push({ parcelId, geojson, attrs, propertyType });
          }
          const years =
            dwellingUrl && dwellingId
              ? await loadYearIndex(
                  dwellingUrl,
                  dwellingId,
                  fieldMap,
                  candidates.map((c) => c.parcelId),
                )
              : new Map();
          for (const row of candidates) {
            const pin = normalizePin(row.parcelId);
            const fromAddr = addresses.get(pin);
            const fromParcel = yearFromAttrs(row.attrs, fieldMap);
            const fromTable = years.get(pin) ?? years.get(row.parcelId);
            batch.push({
              parcelId: row.parcelId,
              geojson: row.geojson,
              situsAddress: composeAddress(row.attrs, fieldMap) ?? fromAddr?.address ?? null,
              situsCity:
                str(attr(row.attrs, fieldMap.city)) ?? fromAddr?.city ?? fieldMap.cityFallback ?? null,
              situsZip: normalizeZip(str(attr(row.attrs, fieldMap.zip)) ?? fromAddr?.zip ?? null),
              propertyType: row.propertyType,
              yearBuilt: fromParcel.yearBuilt ?? fromTable?.yearBuilt ?? null,
              yearRemodeled: fromParcel.yearRemodeled ?? fromTable?.yearRemodeled ?? null,
              raw: JSON.stringify(row.attrs),
            });
            if (batch.length >= 40) {
              upserted += await flush(client, county.fips, county.state, batch);
              batch.length = 0;
              await options.onProgress?.(
                `Cached ${upserted.toLocaleString()} homes from ${county.name}…`,
              );
            }
          }
          if (upserted + batch.length >= cap) break;
        }
        upserted += await flush(client, county.fips, county.state, batch);
      }
    } catch (err) {
      console.warn(`Parcel fetch failed for ${county.name}`, err);
      missingLayers.push(county.name);
    }
  }

  return { upserted, skipped, counties: touched, missingLayers };
}
