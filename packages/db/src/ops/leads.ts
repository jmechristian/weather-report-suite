import {
  HOME_AGE_INTENT_YEARS,
  INTENT_LEAD_CAP,
  REROOF_FRESH_YEARS,
  SCORE_PARCEL_CAP,
  scoreLead,
  type EventType,
  type PropertyType,
} from "@storm-leads/core";
import type { Database, Sql } from "../client";
import { fetchStormParcels } from "./parcels";
import { applyReroofPermits } from "./permits";

type GenerateResult = { inserted: number; scored: number };

export type ScoreProgress = {
  status: "idle" | "running" | "completed" | "failed";
  phase: string;
  total: number;
  scored: number;
  message: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  error: string | null;
};

async function setScoreJob(
  client: Sql,
  stormId: string,
  fields: {
    status?: string;
    phase: string;
    total?: number;
    scored?: number;
    message: string;
    error?: string | null;
  },
) {
  await client`
    INSERT INTO score_jobs (
      storm_event_id, status, phase, total, scored, message, error, started_at, updated_at
    ) VALUES (
      ${stormId}::uuid,
      ${fields.status ?? "running"},
      ${fields.phase},
      ${fields.total ?? 0},
      ${fields.scored ?? 0},
      ${fields.message},
      ${fields.error ?? null},
      now(),
      now()
    )
    ON CONFLICT (storm_event_id) DO UPDATE SET
      status = EXCLUDED.status,
      phase = EXCLUDED.phase,
      total = EXCLUDED.total,
      scored = EXCLUDED.scored,
      message = EXCLUDED.message,
      error = EXCLUDED.error,
      updated_at = now(),
      started_at = CASE
        WHEN score_jobs.status = 'running' THEN score_jobs.started_at
        ELSE now()
      END
  `;
}

export async function getScoreProgress(client: Sql, stormId: string): Promise<ScoreProgress> {
  const [job] = await client<{
    status: string;
    phase: string;
    total: number;
    scored: number;
    message: string | null;
    started_at: string | Date | null;
    updated_at: string | Date | null;
    error: string | null;
  }[]>`
    SELECT status, phase, total, scored, message, started_at, updated_at, error
    FROM score_jobs
    WHERE storm_event_id = ${stormId}::uuid
  `;
  if (!job) {
    return {
      status: "idle",
      phase: "idle",
      total: 0,
      scored: 0,
      message: null,
      startedAt: null,
      updatedAt: null,
      error: null,
    };
  }
  return {
    status: job.status as ScoreProgress["status"],
    phase: job.phase,
    total: Number(job.total) || 0,
    scored: Number(job.scored) || 0,
    message: job.message,
    startedAt: job.started_at ? new Date(job.started_at).toISOString() : null,
    updatedAt: job.updated_at ? new Date(job.updated_at).toISOString() : null,
    error: job.error,
  };
}

const SCORE_JOB_STALE_MS = 20 * 60 * 1000;

function isStaleScoreJob(updatedAt: string | null): boolean {
  if (!updatedAt) return true;
  const t = Date.parse(updatedAt);
  return !Number.isFinite(t) || Date.now() - t > SCORE_JOB_STALE_MS;
}

export async function generateLeads(
  _db: Database,
  client: Sql,
  stormId: string,
): Promise<GenerateResult> {
  const existing = await getScoreProgress(client, stormId);
  if (existing.status === "running" && !isStaleScoreJob(existing.updatedAt)) {
    throw new Error("Generate is already running for this storm. Wait for it to finish.");
  }

  try {
    await setScoreJob(client, stormId, {
      status: "running",
      phase: "fetching",
      total: 0,
      scored: 0,
      message: "Pulling homes from county GIS inside this warning…",
    });

    const fetched = await fetchStormParcels(client, stormId, {
      cap: SCORE_PARCEL_CAP,
      onProgress: async (message) => {
        await setScoreJob(client, stormId, {
          status: "running",
          phase: "fetching",
          message,
        });
      },
    });

    const layerNote =
      fetched.missingLayers.length > 0
        ? ` No parcel layer for ${fetched.missingLayers.join(", ")}.`
        : "";

    await setScoreJob(client, stormId, {
      status: "running",
      phase: "permits",
      total: 0,
      scored: 0,
      message: `Cached ${fetched.upserted.toLocaleString()} homes. Checking county roof permits…${layerNote}`,
    });

    const reroofs = await applyReroofPermits(client, stormId, async (message) => {
      await setScoreJob(client, stormId, {
        status: "running",
        phase: "permits",
        message,
      });
    });

    await setScoreJob(client, stormId, {
      status: "running",
      phase: "intersecting",
      total: 0,
      scored: 0,
      message: `Matched ${reroofs.toLocaleString()} reroof permits. Ranking homes (${HOME_AGE_INTENT_YEARS}+ years first)…`,
    });

    const ranked = await client<{ id: string }[]>`
      SELECT p.id
      FROM parcels p
      JOIN storm_events s ON p.centroid IS NOT NULL AND ST_Intersects(p.centroid, s.geom)
      WHERE s.id = ${stormId}::uuid
        AND p.property_type = 'single_family'
        AND (p.last_reroof_year IS NULL OR p.last_reroof_year <= extract(year from now())::int - ${REROOF_FRESH_YEARS})
      ORDER BY
        CASE
          WHEN COALESCE(p.year_built, p.year_remodeled) IS NOT NULL
            AND COALESCE(p.year_built, p.year_remodeled) <= extract(year from now())::int - ${HOME_AGE_INTENT_YEARS}
          THEN 0
          ELSE 1
        END,
        COALESCE((
          SELECT MIN(ST_Distance(p.centroid::geography, r.geom::geography))
          FROM storm_reports r
          WHERE r.storm_event_id = s.id
        ), 1e9),
        ST_Distance(p.centroid::geography, ST_PointOnSurface(s.geom)::geography)
      LIMIT ${INTENT_LEAD_CAP}
    `;

    if (ranked.length === 0) {
      await setScoreJob(client, stormId, {
        status: "completed",
        phase: "done",
        total: 0,
        scored: 0,
        message: `No homes inside this warning without a reroof in the last ${REROOF_FRESH_YEARS} years.`,
      });
      return { inserted: 0, scored: 0 };
    }

    const rankedIds = ranked.map((row) => row.id);
    await client`
      DELETE FROM leads
      WHERE storm_event_id = ${stormId}::uuid
        AND parcel_id <> ALL(${rankedIds}::uuid[])
    `;
    const inserted = await client`
      INSERT INTO leads (storm_event_id, parcel_id, score, score_breakdown)
      SELECT ${stormId}::uuid, x.id, 0, '{}'::jsonb
      FROM unnest(${rankedIds}::uuid[]) AS x(id)
      ON CONFLICT (storm_event_id, parcel_id) DO UPDATE SET
        score = 0,
        score_breakdown = '{}'::jsonb
      RETURNING id
    `;

    const lsr = await client<{ lon: number; lat: number }[]>`
      SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat
      FROM storm_reports
      WHERE storm_event_id = ${stormId}::uuid
    `;
    const lsrPoints = lsr.map((r) => [Number(r.lon), Number(r.lat)] as [number, number]);

    const rows = await client<
      {
        id: string;
        year_built: number | null;
        year_remodeled: number | null;
        last_reroof_year: number | null;
        property_type: string | null;
        lon: number;
        lat: number;
        storm_lon: number;
        storm_lat: number;
        radius_km: number;
        wind_mph: string | null;
        hail_in: string | null;
        event_type: string;
        confidence: string | null;
      }[]
    >`
      SELECT
        l.id,
        p.year_built,
        p.year_remodeled,
        p.last_reroof_year,
        p.property_type,
        ST_X(p.centroid) AS lon,
        ST_Y(p.centroid) AS lat,
        ST_X(ST_PointOnSurface(s.geom)) AS storm_lon,
        ST_Y(ST_PointOnSurface(s.geom)) AS storm_lat,
        GREATEST(
          ST_Distance(ST_PointOnSurface(s.geom)::geography, ST_Centroid(ST_Envelope(s.geom))::geography) / 1000.0,
          3
        ) AS radius_km,
        s.wind_mph,
        s.hail_in,
        s.event_type,
        s.confidence
      FROM leads l
      JOIN parcels p ON p.id = l.parcel_id
      JOIN storm_events s ON s.id = l.storm_event_id
      WHERE l.storm_event_id = ${stormId}::uuid
    `;

    await setScoreJob(client, stormId, {
      status: "running",
      phase: "scoring",
      total: rows.length,
      scored: 0,
      message: `Scoring ${rows.length.toLocaleString()} intent homes…`,
    });

    let scored = 0;
    const chunkSize = 250;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const slice = rows.slice(i, i + chunkSize);
      const ids: string[] = [];
      const scores: number[] = [];
      const breakdowns: string[] = [];
      for (const row of slice) {
        if (row.lon == null || row.lat == null) continue;
        const result = scoreLead({
          eventType: row.event_type as EventType,
          windMph: row.wind_mph ? Number(row.wind_mph) : null,
          hailIn: row.hail_in ? Number(row.hail_in) : null,
          parcelCentroid: [Number(row.lon), Number(row.lat)],
          stormCentroid: [Number(row.storm_lon), Number(row.storm_lat)],
          stormRadiusKm: Number(row.radius_km) || 8,
          lsrPoints,
          yearBuilt: row.year_built,
          yearRemodeled: row.year_remodeled,
          lastReroofYear: row.last_reroof_year,
          propertyType: (row.property_type ?? "other") as PropertyType,
          confidence: row.confidence ? Number(row.confidence) : 0.35,
        });
        ids.push(row.id);
        scores.push(result.score);
        breakdowns.push(JSON.stringify(result.breakdown));
      }
      if (ids.length > 0) {
        await client`
          UPDATE leads AS l
          SET score = v.score, score_breakdown = v.breakdown::jsonb
          FROM unnest(
            ${ids}::uuid[],
            ${scores}::float8[],
            ${breakdowns}::text[]
          ) AS v(id, score, breakdown)
          WHERE l.id = v.id
        `;
      }
      scored += ids.length;
      await setScoreJob(client, stormId, {
        status: "running",
        phase: "scoring",
        total: rows.length,
        scored,
        message: `Scored ${scored.toLocaleString()} of ${rows.length.toLocaleString()} homes…`,
      });
    }

    await setScoreJob(client, stormId, {
      status: "completed",
      phase: "done",
      total: rows.length,
      scored,
      message: `Scored ${scored.toLocaleString()} intent homes (cap ${INTENT_LEAD_CAP.toLocaleString()}).`,
    });

    return { inserted: inserted.length, scored };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scoring failed";
    await setScoreJob(client, stormId, {
      status: "failed",
      phase: "failed",
      message: "Scoring failed.",
      error: message,
    }).catch(() => undefined);
    throw err;
  }
}
