import { sql } from "drizzle-orm";
import {
  STORM_SYNC_OVERLAP_HOURS,
  fetchIemLsr,
  fetchIemSbw,
  fetchNwsAlerts,
  getNwsUserAgent,
  looksLikeNorthernVa,
  type StormEventInput,
} from "@storm-leads/core";
import type { Database, Sql } from "../client";

export type IngestStormsOptions = {
  months?: number;
  full?: boolean;
  since?: Date;
  includeNws?: boolean;
};

export type IngestStormsResult = {
  mode: "incremental" | "full";
  from: string;
  to: string;
  eventsFetched: number;
  eventsStored: number;
  reportsStored: number;
  skipped?: boolean;
};

let ingestRunning = false;

export async function latestStormOccurredAt(client: Sql): Promise<Date | null> {
  const [row] = await client<{ t: Date | string | null }[]>`
    SELECT max(occurred_at) AS t FROM storm_events
  `;
  return row?.t ? new Date(row.t) : null;
}

function resolveWindow(
  latest: Date | null,
  options: IngestStormsOptions,
): { from: Date; to: Date; mode: "incremental" | "full" } {
  const to = new Date();
  if (options.since) {
    return { from: options.since, to, mode: "incremental" };
  }
  if (options.full || options.months != null) {
    const months = options.months ?? 12;
    return {
      from: new Date(to.getTime() - months * 30 * 24 * 60 * 60 * 1000),
      to,
      mode: "full",
    };
  }
  if (latest) {
    const overlapMs = STORM_SYNC_OVERLAP_HOURS * 60 * 60 * 1000;
    return { from: new Date(latest.getTime() - overlapMs), to, mode: "incremental" };
  }
  return {
    from: new Date(to.getTime() - 12 * 30 * 24 * 60 * 60 * 1000),
    to,
    mode: "full",
  };
}

export async function ingestStorms(
  db: Database,
  client: Sql,
  options: IngestStormsOptions = {},
): Promise<IngestStormsResult> {
  if (ingestRunning) {
    const latest = await latestStormOccurredAt(client);
    const now = new Date();
    return {
      mode: "incremental",
      from: (latest ?? now).toISOString(),
      to: now.toISOString(),
      eventsFetched: 0,
      eventsStored: 0,
      reportsStored: 0,
      skipped: true,
    };
  }
  ingestRunning = true;
  try {
    return await runIngestStorms(db, client, options);
  } finally {
    ingestRunning = false;
  }
}

async function runIngestStorms(
  db: Database,
  client: Sql,
  options: IngestStormsOptions,
): Promise<IngestStormsResult> {
  const latest = await latestStormOccurredAt(client);
  const { from, to, mode } = resolveWindow(latest, options);
  console.log(
    `Fetching IEM SBW ${mode} ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`,
  );
  const events = await fetchIemSbw(from, to, "LWX");
  try {
    events.push(...(await fetchIemSbw(from, to, "AKQ")));
  } catch (err) {
    console.warn("IEM AKQ warnings skipped:", err instanceof Error ? err.message : err);
  }
  if (options.includeNws !== false) {
    try {
      events.push(...(await fetchNwsAlerts(getNwsUserAgent())));
    } catch (err) {
      console.warn("NWS live alerts skipped:", err instanceof Error ? err.message : err);
    }
  }

  await client`
    DELETE FROM storm_events s
    WHERE NOT EXISTS (
      SELECT 1 FROM counties c
      WHERE c.geom IS NOT NULL
        AND ST_Intersects(s.geom, c.geom)
    )
  `;

  const [aoi] = await client<{ g: string }[]>`
    SELECT ST_AsGeoJSON(ST_Multi(ST_Union(geom))) AS g
    FROM counties
    WHERE geom IS NOT NULL
  `;
  const aoiGeojson = aoi?.g;
  if (!aoiGeojson) {
    throw new Error("No county geometries seeded");
  }

  console.log(`Clipping ${events.length} warnings to the DMV county union`);
  let stored = 0;
  for (const event of events) {
    if (await clipAndInsert(client, event, aoiGeojson)) stored += 1;
  }

  const reports = (await fetchIemLsr(from, to, "LWX")).filter((r) =>
    looksLikeNorthernVa(r.longitude, r.latitude),
  );
  console.log(`Inserting ${reports.length} LWX storm reports in the DMV`);
  let reportCount = 0;
  for (const report of reports) {
    const inserted = await client<{ id: string }[]>`
      INSERT INTO storm_reports (
        external_id, report_type, occurred_at, geom, magnitude, magnitude_unit, source, raw
      )
      SELECT
        ${report.externalId},
        ${report.reportType},
        ${report.occurredAt.toISOString()}::timestamptz,
        ST_SetSRID(ST_MakePoint(${report.longitude}, ${report.latitude}), 4326),
        ${report.magnitude ?? null},
        ${report.magnitudeUnit ?? null},
        ${report.source},
        ${JSON.stringify(report.raw)}::jsonb
      WHERE ST_Intersects(
        ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${aoiGeojson}), 4326)),
        ST_SetSRID(ST_MakePoint(${report.longitude}, ${report.latitude}), 4326)
      )
      ON CONFLICT (source, external_id) DO UPDATE SET
        magnitude = EXCLUDED.magnitude,
        raw = EXCLUDED.raw
      RETURNING id
    `;
    if (inserted[0]) reportCount += 1;
  }

  await db.execute(sql`
    UPDATE storm_reports r
    SET storm_event_id = s.id
    FROM storm_events s
    WHERE r.storm_event_id IS NULL
      AND r.occurred_at BETWEEN s.occurred_at - interval '3 hours'
        AND coalesce(s.expires_at, s.occurred_at) + interval '3 hours'
      AND ST_DWithin(r.geom::geography, s.geom::geography, 400)
  `);

  await db.execute(sql`
    UPDATE storm_events s
    SET confidence = LEAST(1, COALESCE(s.confidence::numeric, 0.35) + 0.35)
    WHERE EXISTS (
      SELECT 1 FROM storm_reports r WHERE r.storm_event_id = s.id
    )
  `);

  return {
    mode,
    from: from.toISOString(),
    to: to.toISOString(),
    eventsFetched: events.length,
    eventsStored: stored,
    reportsStored: reportCount,
  };
}

async function clipAndInsert(
  client: Sql,
  event: StormEventInput,
  aoiGeojson: string,
): Promise<boolean> {
  const geojson = JSON.stringify(event.geometry);
  const severity =
    event.eventType === "hail" ? event.hailIn : event.windMph ?? event.hailIn;
  const unit = event.eventType === "hail" ? "in" : "mph";
  const rows = await client<{ id: string }[]>`
    INSERT INTO storm_events (
      external_id, event_type, occurred_at, expires_at, geom,
      severity, severity_unit, wind_mph, hail_in, source, confidence, raw
    )
    SELECT
      ${event.externalId},
      ${event.eventType},
      ${event.occurredAt.toISOString()}::timestamptz,
      ${event.expiresAt ? event.expiresAt.toISOString() : null}::timestamptz,
      clipped,
      ${severity ?? null},
      ${unit},
      ${event.windMph ?? null},
      ${event.hailIn ?? null},
      ${event.source},
      ${event.confidence},
      ${JSON.stringify(event.raw)}::jsonb
    FROM (
      SELECT ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(
            ST_Intersection(
              ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326)),
              ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${aoiGeojson}), 4326))
            )
          ),
          3
        )
      ) AS clipped
    ) x
    WHERE clipped IS NOT NULL AND NOT ST_IsEmpty(clipped)
    ON CONFLICT (source, external_id) DO UPDATE SET
      geom = EXCLUDED.geom,
      wind_mph = EXCLUDED.wind_mph,
      hail_in = EXCLUDED.hail_in,
      confidence = EXCLUDED.confidence,
      raw = EXCLUDED.raw
    RETURNING id
  `;
  return Boolean(rows[0]);
}
