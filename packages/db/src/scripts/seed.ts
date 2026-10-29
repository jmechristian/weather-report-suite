import { loadEnv } from "../load-env";
loadEnv();

import { sql } from "drizzle-orm";
import { DMV_COUNTIES } from "@storm-leads/core";
import { createDirectDb } from "../client";
import { counties } from "../schema";

function bboxPolygon(west: number, south: number, east: number, north: number): string {
  return JSON.stringify({
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    ],
  });
}

const FALLBACK_BBOX: Record<string, [number, number, number, number]> = {
  "11001": [-77.12, 38.79, -76.91, 38.995],
  "24003": [-76.84, 38.71, -76.39, 39.2],
  "24017": [-77.28, 38.33, -76.75, 38.71],
  "24021": [-77.68, 39.22, -77.16, 39.72],
  "24027": [-77.2, 39.1, -76.7, 39.37],
  "24031": [-77.53, 38.94, -76.89, 39.35],
  "24033": [-77.08, 38.54, -76.67, 39.13],
  "51013": [-77.17, 38.83, -77.03, 38.93],
  "51059": [-77.54, 38.61, -77.03, 39.06],
  "51061": [-78.14, 38.56, -77.57, 38.95],
  "51107": [-77.96, 38.84, -77.32, 39.32],
  "51153": [-77.72, 38.47, -77.2, 38.94],
  "51179": [-77.64, 38.24, -77.28, 38.59],
  "51510": [-77.14, 38.79, -77.04, 38.84],
  "51600": [-77.33, 38.83, -77.28, 38.88],
  "51610": [-77.18, 38.87, -77.15, 38.9],
  "51683": [-77.51, 38.73, -77.45, 38.78],
  "51685": [-77.47, 38.76, -77.43, 38.79],
  "24005": [-76.91, 39.2, -76.3, 39.73],
  "24013": [-77.3, 39.3, -76.85, 39.72],
  "24025": [-76.6, 39.35, -76.05, 39.73],
  "24510": [-76.72, 39.2, -76.53, 39.37],
  "51033": [-77.55, 37.9, -77.15, 38.2],
  "51085": [-77.85, 37.55, -77.2, 37.9],
  "51087": [-77.7, 37.4, -77.2, 37.72],
  "51177": [-77.95, 38.02, -77.35, 38.36],
  "51630": [-77.55, 38.27, -77.43, 38.33],
  "51760": [-77.6, 37.42, -77.35, 37.6],
};

async function fetchCountyGeom(fips: string): Promise<string> {
  const url = new URL(
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query",
  );
  url.searchParams.set("where", `GEOID='${fips}'`);
  url.searchParams.set("outFields", "GEOID,NAME");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "geojson");
  const res = await fetch(url);
  if (res.ok) {
    const body = (await res.json()) as GeoJSON.FeatureCollection;
    const geom = body.features?.[0]?.geometry;
    if (geom && (geom.type === "Polygon" || geom.type === "MultiPolygon")) {
      const multi =
        geom.type === "MultiPolygon"
          ? geom
          : { type: "MultiPolygon" as const, coordinates: [geom.coordinates] };
      return JSON.stringify(multi);
    }
  }
  const bbox = FALLBACK_BBOX[fips];
  if (!bbox) throw new Error(`No geometry for ${fips}`);
  return bboxPolygon(...bbox);
}

const { db, client } = createDirectDb();

for (const row of DMV_COUNTIES) {
  await db
    .insert(counties)
    .values({
      fips: row.fips,
      name: row.name,
      state: row.state,
      parcelServiceUrl: row.parcelServiceUrl,
      addressServiceUrl: row.addressServiceUrl,
      sourceSrid: row.sourceSrid,
      fieldMap: row.fieldMap,
    })
    .onConflictDoUpdate({
      target: counties.fips,
      set: {
        name: row.name,
        state: row.state,
        parcelServiceUrl: row.parcelServiceUrl,
        addressServiceUrl: row.addressServiceUrl,
        sourceSrid: row.sourceSrid,
        fieldMap: row.fieldMap,
      },
    });

  const geojson = await fetchCountyGeom(row.fips);
  await db.execute(sql`
    UPDATE counties
    SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)), 3))
    WHERE fips = ${row.fips}
  `);
  const layer = row.parcelServiceUrl ? "parcel layer" : "boundary only";
  console.log(`Seeded ${row.name} ${row.state} (${row.fips}) — ${layer}`);
}

await client.end();
