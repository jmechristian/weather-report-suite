import {
  TRACE_CREDITS_PER_LOOKUP,
  TRACE_DEFAULT_LIMIT,
  TRACE_USD_PER_CREDIT,
  estimateTraceCost,
} from "@storm-leads/core";
import type { Sql } from "../client";

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type TraceSpend = {
  credits: number;
  usd: number;
  lookups: number;
  hits: number;
  misses: number;
  jobs: number;
};

export type TraceJobRow = {
  id: string;
  storm_event_id: string | null;
  status: string;
  credits: number;
  usd: number;
  requested: number;
  hits: number;
  misses: number;
  submitted_at: string | null;
};

function toSpend(row: {
  credits?: unknown;
  usd?: unknown;
  lookups?: unknown;
  hits?: unknown;
  misses?: unknown;
  jobs?: unknown;
}): TraceSpend {
  return {
    credits: num(row.credits),
    usd: Math.round(num(row.usd) * 100) / 100,
    lookups: num(row.lookups),
    hits: num(row.hits),
    misses: num(row.misses),
    jobs: num(row.jobs),
  };
}

export async function getTraceSpend(client: Sql, stormId?: string | null): Promise<TraceSpend> {
  const [row] = stormId
    ? await client<{
        credits: string | number | null;
        usd: string | number | null;
        lookups: string | number | null;
        hits: string | number | null;
        misses: string | number | null;
        jobs: string | number | null;
      }[]>`
        SELECT
          coalesce(sum(credits), 0) AS credits,
          coalesce(sum(usd), 0) AS usd,
          coalesce(sum(requested), 0) AS lookups,
          coalesce(sum(hits), 0) AS hits,
          coalesce(sum(misses), 0) AS misses,
          count(*)::int AS jobs
        FROM trace_jobs
        WHERE status = 'completed' AND storm_event_id = ${stormId}::uuid
      `
    : await client<{
        credits: string | number | null;
        usd: string | number | null;
        lookups: string | number | null;
        hits: string | number | null;
        misses: string | number | null;
        jobs: string | number | null;
      }[]>`
        SELECT
          coalesce(sum(credits), 0) AS credits,
          coalesce(sum(usd), 0) AS usd,
          coalesce(sum(requested), 0) AS lookups,
          coalesce(sum(hits), 0) AS hits,
          coalesce(sum(misses), 0) AS misses,
          count(*)::int AS jobs
        FROM trace_jobs
        WHERE status = 'completed'
      `;
  return toSpend(row ?? {});
}

export async function listRecentTraceJobs(client: Sql, limit = 8): Promise<TraceJobRow[]> {
  const rows = await client<TraceJobRow[]>`
    SELECT
      id,
      storm_event_id,
      status,
      coalesce(credits, 0) AS credits,
      coalesce(usd, 0) AS usd,
      coalesce(requested, 0) AS requested,
      coalesce(hits, 0) AS hits,
      coalesce(misses, 0) AS misses,
      submitted_at
    FROM trace_jobs
    ORDER BY submitted_at DESC NULLS LAST
    LIMIT ${limit}
  `;
  return rows.map((row) => ({
    ...row,
    credits: num(row.credits),
    usd: Math.round(num(row.usd) * 100) / 100,
    requested: num(row.requested),
    hits: num(row.hits),
    misses: num(row.misses),
  }));
}

export async function nextTraceEstimate(
  client: Sql,
  stormId: string,
  limit = TRACE_DEFAULT_LIMIT,
) {
  const [row] = await client<{ already_hits: number; remaining: number }[]>`
    SELECT
      count(*) FILTER (
        WHERE p.owner_name IS NOT NULL
          OR EXISTS (SELECT 1 FROM contacts c WHERE c.parcel_id = p.id)
      )::int AS already_hits,
      count(*) FILTER (
        WHERE p.situs_address IS NOT NULL
          AND p.owner_name IS NULL
          AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.parcel_id = p.id)
          AND (p.last_traced_at IS NULL OR p.last_traced_at <= now() - interval '90 days')
      )::int AS remaining
    FROM leads l
    JOIN parcels p ON p.id = l.parcel_id
    WHERE l.storm_event_id = ${stormId}::uuid
  `;
  const alreadyHits = num(row?.already_hits);
  const remaining = num(row?.remaining);
  return {
    target: limit,
    alreadyHits,
    need: limit,
    remaining,
    ...estimateTraceCost(limit),
  };
}

export async function getUsageSnapshot(client: Sql, stormId?: string | null) {
  const [allTime, storm, next, recent] = await Promise.all([
    getTraceSpend(client),
    stormId ? getTraceSpend(client, stormId) : Promise.resolve(null),
    stormId ? nextTraceEstimate(client, stormId) : Promise.resolve(null),
    listRecentTraceJobs(client),
  ]);
  return {
    usdPerCredit: TRACE_USD_PER_CREDIT,
    creditsPerLookup: TRACE_CREDITS_PER_LOOKUP,
    defaultLimit: TRACE_DEFAULT_LIMIT,
    allTime,
    storm,
    next,
    recent,
  };
}
