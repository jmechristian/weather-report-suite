import { loadEnv } from "../load-env";
loadEnv();

import {
  DEMO_COUNTY_FIPS,
  classifyPropertyType,
  describeLayer,
  normalizePin,
  paginateAttributeRows,
  paginateFeatures,
  type CountyFieldMap,
} from "@storm-leads/core";
import { createDirectDb } from "../client";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

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
  if (digits.length >= 5) return digits.slice(0, 5);
  return value;
}

async function loadAddressIndex(
  url: string,
  fieldMap: CountyFieldMap,
): Promise<Map<string, { address: string | null; city: string | null; zip: string | null }>> {
  const map = new Map<string, { address: string | null; city: string | null; zip: string | null }>();
  const joinKey = fieldMap.addressJoin;
  if (!joinKey) return map;
  const info = await describeLayer(url);
  console.log(`Loading addresses from ${info.name} (${info.fields.length} fields)`);
  const outFields = [
    joinKey,
    fieldMap.address,
    fieldMap.city,
    fieldMap.zip,
    "FullAdd",
    "FULLADD",
    "FULL_ADDRESS",
  ]
    .filter((v, i, all): v is string => Boolean(v) && all.indexOf(v) === i)
    .filter((name) => info.fields.some((f) => f.toLowerCase() === name.toLowerCase()))
    .join(",");
  const rows = await paginateAttributeRows(url, {
    outFields: outFields || "*",
    resultRecordCount: Math.min(2000, info.maxRecordCount || 1000),
  });
  for (const row of rows) {
    const key = normalizePin(str(attr(row, joinKey)));
    if (!key || map.has(key)) continue;
    map.set(key, {
      address: str(attr(row, fieldMap.address)) ?? str(attr(row, "FullAdd")) ?? str(attr(row, "FULL_ADDRESS")),
      city: str(attr(row, fieldMap.city)),
      zip: normalizeZip(str(attr(row, fieldMap.zip))),
    });
  }
  console.log(`  ${map.size} address rows`);
  return map;
}

async function loadAssessor(
  fieldMap: CountyFieldMap,
): Promise<{
  landUse: Map<string, string>;
  years: Map<string, { yearBuilt: number | null; yearRemodeled: number | null }>;
}> {
  const landUse = new Map<string, string>();
  const years = new Map<string, { yearBuilt: number | null; yearRemodeled: number | null }>();
  const parcelUrl = fieldMap.layers?.assessorParcel;
  const dwellingUrl = fieldMap.layers?.dwelling;
  const idKey = fieldMap.assessorId ?? "PARID";
  if (parcelUrl) {
    const info = await describeLayer(parcelUrl);
    console.log(`Loading assessor parcel table (${info.name})`);
    const rows = await paginateAttributeRows(parcelUrl, {
      outFields: [idKey, fieldMap.landUse].filter(Boolean).join(","),
    });
    for (const row of rows) {
      const key = normalizePin(str(attr(row, idKey)));
      if (!key) continue;
      const luc = str(attr(row, fieldMap.landUse));
      if (luc) landUse.set(key, luc);
    }
    console.log(`  ${landUse.size} land-use rows`);
  }
  if (dwellingUrl) {
    const info = await describeLayer(dwellingUrl);
    console.log(`Loading dwelling table (${info.name})`);
    const rows = await paginateAttributeRows(dwellingUrl, {
      outFields: [idKey, fieldMap.yearBuilt, fieldMap.yearRemodeled].filter(Boolean).join(","),
    });
    for (const row of rows) {
      const key = normalizePin(str(attr(row, idKey)));
      if (!key) continue;
      const built = int(attr(row, fieldMap.yearBuilt));
      const remodeled = int(attr(row, fieldMap.yearRemodeled));
      const prev = years.get(key);
      if (!prev || (built && (!prev.yearBuilt || built < prev.yearBuilt))) {
        years.set(key, { yearBuilt: built, yearRemodeled: remodeled ?? prev?.yearRemodeled ?? null });
      }
    }
    console.log(`  ${years.size} dwelling rows`);
  }
  return { landUse, years };
}

function geometryJson(geom: GeoJSON.Geometry | null | undefined): string | null {
  if (!geom) return null;
  if (geom.type === "Polygon") {
    return JSON.stringify({ type: "MultiPolygon", coordinates: [geom.coordinates] });
  }
  if (geom.type === "MultiPolygon") return JSON.stringify(geom);
  return null;
}

function yearValue(value: unknown): number | null {
  const n = int(value);
  if (n == null || n < 1800 || n > new Date().getFullYear() + 1) return null;
  return n;
}

function composeAddress(attrs: Record<string, unknown>, fieldMap: CountyFieldMap): string | null {
  const direct = str(attr(attrs, fieldMap.address));
  if (direct) return direct;
  if (!fieldMap.addressParts?.length) return null;
  const parts = fieldMap.addressParts.map((key) => str(attr(attrs, key))).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function outFieldList(fieldMap: CountyFieldMap, available: string[]): string {
  const wanted = [
    fieldMap.parcelId,
    fieldMap.parcelIdAlt,
    fieldMap.parcelType,
    fieldMap.address,
    ...(fieldMap.addressParts ?? []),
    fieldMap.city,
    fieldMap.zip,
    fieldMap.landUse,
    fieldMap.yearBuilt,
    fieldMap.yearBuiltAlt,
    fieldMap.yearRemodeled,
  ].filter((name): name is string => Boolean(name));
  const known = new Set(available.map((name) => name.toLowerCase()));
  const fields = wanted.filter((name, index) => wanted.indexOf(name) === index && known.has(name.toLowerCase()));
  return fields.length ? fields.join(",") : "*";
}

const fips = arg("county") ?? DEMO_COUNTY_FIPS;
const addressesOnly = process.argv.includes("--addresses-only");

const { client } = createDirectDb({ max: 1 });
await client.unsafe("SET default_transaction_read_only = off");
const [county] = await client<
  {
    name: string;
    state: string;
    parcel_service_url: string | null;
    address_service_url: string | null;
    field_map: CountyFieldMap;
  }[]
>`
  SELECT name, state, parcel_service_url, address_service_url, field_map
  FROM counties
  WHERE fips = ${fips}
`;
if (!county) {
  console.error(`Unknown county ${fips}. Run corepack pnpm db:seed first.`);
  throw new Error(`Unknown county ${fips}`);
}

if (!county.parcel_service_url) {
  console.error(`${county.name} has no parcel layer. Generate leads fetches GIS per storm.`);
  throw new Error(`${county.name} has no parcel layer`);
}

const fieldMap = county.field_map;
const countyName = county.name;
const countyState = county.state;
const parcelLayer = await describeLayer(county.parcel_service_url);
console.log(`Parcels: ${parcelLayer.name} [${parcelLayer.fields.join(", ")}]`);

const addressIndex = county.address_service_url
  ? await loadAddressIndex(county.address_service_url, fieldMap)
  : new Map();
const assessor = await loadAssessor(fieldMap);

let upserted = 0;
let skipped = 0;

type Row = {
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

async function insertBatch(batch: Row[]) {
  const payload = JSON.stringify(
    batch.map((row) => ({
      parcel_id: row.parcelId,
      geojson: row.geojson,
      situs_address: row.situsAddress,
      situs_city: row.situsCity,
      situs_zip: row.situsZip,
      property_type: row.propertyType,
      year_built: row.yearBuilt,
      year_remodeled: row.yearRemodeled,
      raw: JSON.parse(row.raw) as unknown,
    })),
  );
  await client`
    INSERT INTO parcels (
      county_fips, county_parcel_id, geom, centroid,
      situs_address, situs_city, situs_zip, situs_state,
      property_type, year_built, year_remodeled, last_synced_at, raw
    )
    SELECT
      ${fips},
      x.parcel_id,
      g.geom,
      ST_PointOnSurface(g.geom),
      NULLIF(x.situs_address, ''),
      NULLIF(x.situs_city, ''),
      NULLIF(x.situs_zip, ''),
      ${countyState},
      x.property_type,
      x.year_built,
      x.year_remodeled,
      now(),
      x.raw
    FROM jsonb_to_recordset(${payload}::jsonb) AS x(
      parcel_id text,
      geojson text,
      situs_address text,
      situs_city text,
      situs_zip text,
      property_type text,
      year_built int,
      year_remodeled int,
      raw jsonb
    )
    CROSS JOIN LATERAL (
      SELECT ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(x.geojson), 4326)),
          3
        )
      ) AS geom
    ) g
    WHERE g.geom IS NOT NULL AND NOT ST_IsEmpty(g.geom)
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

async function flush(batch: Row[]) {
  if (batch.length === 0) return;
  const unique = new Map<string, Row>();
  for (const row of batch) unique.set(row.parcelId, row);
  const rows = [...unique.values()];
  try {
    await insertBatch(rows);
    upserted += rows.length;
    return;
  } catch (err) {
    console.warn("\nBatch insert failed, retrying one parcel at a time", err instanceof Error ? err.message : err);
  }
  for (const row of rows) {
    try {
      await insertBatch([row]);
      upserted += 1;
    } catch (err) {
      skipped += 1;
      console.warn("Skipped parcel", row.parcelId, err instanceof Error ? err.message : err);
    }
  }
}

async function attachSpatialAddresses() {
  const spatial = fieldMap.spatialAddress;
  if (!spatial) return;
  console.log(`\nLoading address points for ${countyName}`);
  const sql = await client.reserve();
  try {
    await sql`SET statement_timeout = 0`;
    await sql`CREATE TEMP TABLE addr_pts (label text, zip text, geom geometry(Point, 4326))`;
    const points = await paginateAttributeRows(spatial.url, {
      outFields: [spatial.label, spatial.zip, spatial.latitude, spatial.longitude].filter(Boolean).join(","),
      resultRecordCount: 2000,
    });
    const chunk: Array<{ label: string; zip: string | null; lon: number; lat: number }> = [];
    let loaded = 0;
    async function flushPoints() {
      if (chunk.length === 0) return;
      const payload = JSON.stringify(chunk);
      await sql`
        INSERT INTO addr_pts (label, zip, geom)
        SELECT x.label, NULLIF(x.zip, ''), ST_SetSRID(ST_MakePoint(x.lon, x.lat), 4326)
        FROM jsonb_to_recordset(${payload}::jsonb) AS x(label text, zip text, lon float8, lat float8)
      `;
      loaded += chunk.length;
      chunk.length = 0;
      process.stdout.write(`\r  ${loaded.toLocaleString()} address points`);
    }
    for (const row of points) {
      const label = str(attr(row, spatial.label));
      const lat = Number(attr(row, spatial.latitude));
      const lon = Number(attr(row, spatial.longitude));
      if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      chunk.push({ label, zip: normalizeZip(str(attr(row, spatial.zip))), lon, lat });
      if (chunk.length >= 2000) await flushPoints();
    }
    await flushPoints();
    console.log("");
    await sql`CREATE INDEX ON addr_pts USING gist (geom)`;
    await sql`ANALYZE addr_pts`;

    let lastId = "00000000-0000-0000-0000-000000000000";
    let attached = 0;
    for (;;) {
      const page = await sql<{ id: string }[]>`
        SELECT id FROM parcels
        WHERE county_fips = ${fips} AND id > ${lastId}::uuid
        ORDER BY id
        LIMIT 400
      `;
      if (page.length === 0) break;
      lastId = page[page.length - 1]!.id;
      const ids = page.map((row) => row.id);
      const [updated] = await sql<{ n: number }[]>`
        WITH done AS (
          UPDATE parcels p
          SET situs_address = hit.label,
              situs_zip = COALESCE(p.situs_zip, hit.zip),
              situs_city = COALESCE(p.situs_city, ${fieldMap.cityFallback ?? null})
          FROM (
            SELECT p2.id, a.label, a.zip
            FROM parcels p2
            CROSS JOIN LATERAL (
              SELECT label, zip
              FROM addr_pts
              WHERE ST_Intersects(p2.geom, geom)
              ORDER BY length(label)
              LIMIT 1
            ) a
            WHERE p2.id = ANY(${ids}::uuid[])
          ) hit
          WHERE p.id = hit.id
          RETURNING 1
        )
        SELECT count(*)::int AS n FROM done
      `;
      attached += Number(updated?.n ?? 0);
      process.stdout.write(`\r  attached ${attached.toLocaleString()} addresses`);
    }
    console.log(`\n  attached addresses to ${attached.toLocaleString()} parcels`);
  } finally {
    sql.release();
  }
}

const batch: Row[] = [];

if (!addressesOnly) for await (const page of paginateFeatures(county.parcel_service_url, {
  where: fieldMap.parcelWhere,
  outFields: outFieldList(fieldMap, parcelLayer.fields),
  resultRecordCount: 500,
})) {
  for (const feature of page) {
    const attrs = (feature.properties ?? {}) as Record<string, unknown>;
    const parcelId = str(attr(attrs, fieldMap.parcelId)) ?? str(attr(attrs, fieldMap.parcelIdAlt));
    const geojson = geometryJson(feature.geometry);
    if (!parcelId || parcelId.toUpperCase() === "ROW" || !geojson) {
      skipped += 1;
      continue;
    }
    if (String(attr(attrs, fieldMap.parcelType) ?? "").toUpperCase() === "CONDO") {
      skipped += 1;
      continue;
    }
    const pin = normalizePin(parcelId);
    const joinKey = normalizePin(str(attr(attrs, fieldMap.parcelAddressJoin)));
    const fromAddr =
      addressIndex.get(pin) ?? addressIndex.get(parcelId) ?? (joinKey ? addressIndex.get(joinKey) : undefined);
    const landUse = assessor.landUse.get(pin) ?? attr(attrs, fieldMap.landUse);
    const years = assessor.years.get(pin);
    const propertyType = classifyPropertyType({
      landUse,
      parcelType: attr(attrs, fieldMap.parcelType),
      singleFamilyCodes: fieldMap.singleFamilyCodes,
      attachedCodes: fieldMap.attachedCodes,
      condoCodes: fieldMap.condoCodes,
    });
    if (propertyType === "condo" || propertyType === "commercial") {
      skipped += 1;
      continue;
    }
    batch.push({
      parcelId,
      geojson,
      situsAddress: composeAddress(attrs, fieldMap) ?? fromAddr?.address ?? null,
      situsCity: str(attr(attrs, fieldMap.city)) ?? fromAddr?.city ?? fieldMap.cityFallback ?? null,
      situsZip: normalizeZip(str(attr(attrs, fieldMap.zip)) ?? fromAddr?.zip ?? null),
      propertyType,
      yearBuilt: years?.yearBuilt ?? yearValue(attr(attrs, fieldMap.yearBuilt)) ?? yearValue(attr(attrs, fieldMap.yearBuiltAlt)),
      yearRemodeled: years?.yearRemodeled ?? yearValue(attr(attrs, fieldMap.yearRemodeled)),
      raw: JSON.stringify(attrs),
    });
    if (batch.length >= 40) {
      await flush(batch);
      batch.length = 0;
      process.stdout.write(`\rUpserted ${upserted} parcels (${skipped} skipped)`);
    }
  }
}
await flush(batch);
await attachSpatialAddresses();

await client`
  UPDATE counties SET last_synced_at = now() WHERE fips = ${fips}
`;
await client.end();
console.log(`\nDone. ${upserted} parcels for ${countyName}.`);
