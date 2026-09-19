import { loadEnv } from "../load-env";
loadEnv();

import { sql } from "drizzle-orm";
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
import { counties } from "../schema";

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

const fips = arg("county") ?? DEMO_COUNTY_FIPS;

const { db, client } = createDirectDb();
const [county] = await db.select().from(counties).where(sql`fips = ${fips}`);
if (!county) {
  console.error(`Unknown county ${fips}. Run corepack pnpm db:seed first.`);
  process.exit(1);
}

if (!county.parcelServiceUrl) {
  console.error(`${county.name} has no parcel layer. Generate leads fetches GIS per storm.`);
  process.exit(1);
}

const fieldMap = county.fieldMap as CountyFieldMap;
const parcelLayer = await describeLayer(county.parcelServiceUrl);
console.log(`Parcels: ${parcelLayer.name} [${parcelLayer.fields.join(", ")}]`);

const addressIndex = county.addressServiceUrl
  ? await loadAddressIndex(county.addressServiceUrl, fieldMap)
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

async function flush(batch: Row[]) {
  if (batch.length === 0) return;
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
          ${county.state},
          ${row.propertyType},
          ${row.yearBuilt},
          ${row.yearRemodeled},
          now(),
          ${row.raw}::jsonb
        )
        ON CONFLICT (county_fips, county_parcel_id) DO UPDATE SET
          geom = EXCLUDED.geom,
          centroid = EXCLUDED.centroid,
          situs_address = EXCLUDED.situs_address,
          situs_city = EXCLUDED.situs_city,
          situs_zip = EXCLUDED.situs_zip,
          property_type = EXCLUDED.property_type,
          year_built = COALESCE(EXCLUDED.year_built, parcels.year_built),
          year_remodeled = COALESCE(EXCLUDED.year_remodeled, parcels.year_remodeled),
          last_synced_at = now(),
          raw = EXCLUDED.raw
      `;
    }
  });
  upserted += batch.length;
}

const batch: Row[] = [];

for await (const page of paginateFeatures(county.parcelServiceUrl)) {
  for (const feature of page) {
    const attrs = (feature.properties ?? {}) as Record<string, unknown>;
    const parcelId = str(attr(attrs, fieldMap.parcelId)) ?? str(attr(attrs, fieldMap.parcelIdAlt));
    const geojson = geometryJson(feature.geometry);
    if (!parcelId || !geojson) {
      skipped += 1;
      continue;
    }
    if (String(attr(attrs, fieldMap.parcelType) ?? "").toUpperCase() === "CONDO") {
      skipped += 1;
      continue;
    }
    const pin = normalizePin(parcelId);
    const joinKey = normalizePin(str(attr(attrs, fieldMap.parcelAddressJoin)));
    const fromLayer = {
      address: str(attr(attrs, fieldMap.address)),
      city: str(attr(attrs, fieldMap.city)),
      zip: normalizeZip(str(attr(attrs, fieldMap.zip))),
    };
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
      situsAddress: fromLayer.address ?? fromAddr?.address ?? null,
      situsCity: fromLayer.city ?? fromAddr?.city ?? null,
      situsZip: fromLayer.zip ?? fromAddr?.zip ?? null,
      propertyType,
      yearBuilt: years?.yearBuilt ?? null,
      yearRemodeled: years?.yearRemodeled ?? null,
      raw: JSON.stringify(attrs),
    });
    if (batch.length >= 50) {
      await flush(batch);
      batch.length = 0;
      process.stdout.write(`\rUpserted ${upserted} parcels (${skipped} skipped)`);
    }
  }
}
await flush(batch);

await client`
  UPDATE counties SET last_synced_at = now() WHERE fips = ${fips}
`;
await client.end();
console.log(`\nDone. ${upserted} parcels for ${county.name}.`);
