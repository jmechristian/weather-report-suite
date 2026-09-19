import { z } from "zod";
import {
  TRACE_DEFAULT_LIMIT,
  TRACE_HARD_CAP,
  TracerfyProvider,
  creditsToUsd,
  fiveDigitZip,
  getServerEnv,
  maxTraceLookups,
  postalCityForTrace,
} from "@storm-leads/core";
import { getUsageSnapshot } from "@storm-leads/db";
import { withAuth, jsonError, getDb } from "@/lib/server";

const Body = z.object({
  limit: z.number().int().min(1).max(TRACE_HARD_CAP).optional(),
});

type TraceTarget = {
  parcel_id: string;
  county_fips: string;
  county_name: string;
  county_parcel_id: string;
  prclid: string | null;
  parcel_nsp: string | null;
  page_num: string | null;
  capt_lot: string | null;
  ins_num: string | null;
  sect_num: string | null;
  situs_address: string | null;
  situs_city: string | null;
  situs_zip: string | null;
  situs_state: string | null;
};

export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withAuth(async () => {
    const { id } = await context.params;
    const parsed = Body.safeParse(await request.json().catch(() => ({ limit: TRACE_DEFAULT_LIMIT })));
    if (!parsed.success) return jsonError("Invalid body");
    const targetHits = parsed.data.limit ?? TRACE_DEFAULT_LIMIT;
    const env = getServerEnv();
    if (!env.TRACERFY_API_KEY) return jsonError("TRACERFY_API_KEY is not set", 500);

    const { client } = getDb();
    const [hitCount] = await client<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM leads l
      JOIN parcels p ON p.id = l.parcel_id
      WHERE l.storm_event_id = ${id}::uuid
        AND (
          p.owner_name IS NOT NULL
          OR EXISTS (SELECT 1 FROM contacts c WHERE c.parcel_id = p.id)
        )
    `;
    const alreadyHits = hitCount?.n ?? 0;
    const need = targetHits;
    const lookupCap = maxTraceLookups(need);

    const targets = await client<TraceTarget[]>`
      SELECT
        p.id AS parcel_id,
        p.county_fips,
        c.name AS county_name,
        p.county_parcel_id,
        p.raw->>'PRCLID' AS prclid,
        p.raw->>'PARCEL_ID_NSP' AS parcel_nsp,
        p.raw->>'PAGENUM' AS page_num,
        p.raw->>'CAPTLOT' AS capt_lot,
        p.raw->>'INSNUM' AS ins_num,
        p.raw->>'SECTNUM' AS sect_num,
        p.situs_address,
        p.situs_city,
        p.situs_zip,
        p.situs_state
      FROM leads l
      JOIN parcels p ON p.id = l.parcel_id
      JOIN counties c ON c.fips = p.county_fips
      WHERE l.storm_event_id = ${id}::uuid
        AND p.situs_address IS NOT NULL
        AND p.owner_name IS NULL
        AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.parcel_id = p.id)
        AND (p.last_traced_at IS NULL OR p.last_traced_at <= now() - interval '90 days')
      ORDER BY l.score DESC
      LIMIT ${lookupCap}
    `;

    if (targets.length === 0) {
      const usage = await getUsageSnapshot(client, id);
      return Response.json({
        requested: 0,
        hits: 0,
        misses: 0,
        alreadyHits,
        target: targetHits,
        credits: 0,
        estimatedUsd: 0,
        usage,
      });
    }

    const tracer = new TracerfyProvider(env.TRACERFY_API_KEY);
    let hits = 0;
    let misses = 0;
    let credits = 0;
    const attempted: string[] = [];

    const [job] = await client<{ id: string }[]>`
      INSERT INTO trace_jobs (provider, status, storm_event_id, parcel_ids)
      VALUES ('tracerfy', 'running', ${id}::uuid, '{}'::uuid[])
      RETURNING id
    `;

    for (const target of targets) {
      if (hits >= need) break;
      attempted.push(target.parcel_id);
      if (!target.situs_address) {
        misses += 1;
        await client`
          UPDATE parcels SET last_traced_at = now()
          WHERE id = ${target.parcel_id}::uuid
        `;
        continue;
      }
      try {
        const zip = fiveDigitZip(target.situs_zip);
        const city =
          postalCityForTrace(zip, target.situs_city) ||
          target.situs_city ||
          target.county_name;
        const result = await tracer.trace({
          address: target.situs_address,
          city,
          state: target.situs_state || "VA",
          zip,
          countyFips: target.county_fips,
          parcelId: target.prclid ?? target.county_parcel_id,
          parcelIdAlt: target.parcel_nsp ?? undefined,
          pageNum: target.page_num ?? undefined,
          captLot: target.capt_lot ?? undefined,
          insNum: target.ins_num ?? undefined,
          sectNum: target.sect_num ?? undefined,
        });
        const charged = result?.creditsDeducted ?? 0;
        credits += charged;
        await client`
          UPDATE parcels SET last_traced_at = now()
          WHERE id = ${target.parcel_id}::uuid
        `;
        if (!result?.hit) {
          misses += 1;
          continue;
        }
        hits += 1;
        if (result.ownerName) {
          await client`
            UPDATE parcels SET owner_name = ${result.ownerName}
            WHERE id = ${target.parcel_id}::uuid AND owner_name IS NULL
          `;
        }
        for (const phone of result.phones) {
          await client`
            INSERT INTO contacts (
              parcel_id, number, line_type, carrier, dnc, rank, provider, traced_at, raw
            ) VALUES (
              ${target.parcel_id}::uuid,
              ${phone.number},
              ${phone.lineType ?? null},
              ${phone.carrier ?? null},
              ${phone.dnc ?? null},
              ${phone.rank},
              'tracerfy',
              now(),
              ${JSON.stringify(result.raw)}::jsonb
            )
            ON CONFLICT (parcel_id, number) DO UPDATE SET
              line_type = EXCLUDED.line_type,
              carrier = EXCLUDED.carrier,
              dnc = EXCLUDED.dnc,
              rank = EXCLUDED.rank,
              traced_at = now(),
              raw = EXCLUDED.raw
          `;
        }
      } catch (err) {
        console.error("Trace failed", target.parcel_id, err);
        misses += 1;
        await client`
          UPDATE parcels SET last_traced_at = now()
          WHERE id = ${target.parcel_id}::uuid
        `;
      }
    }

    await client`
      UPDATE trace_jobs
      SET
        status = 'completed',
        completed_at = now(),
        credits = ${credits},
        usd = ${creditsToUsd(credits)},
        requested = ${attempted.length},
        hits = ${hits},
        misses = ${misses},
        parcel_ids = ${attempted}
      WHERE id = ${job?.id ?? null}::uuid
    `;

    const usage = await getUsageSnapshot(client, id);
    return Response.json({
      requested: attempted.length,
      hits,
      misses,
      alreadyHits,
      target: targetHits,
      credits,
      estimatedUsd: creditsToUsd(credits),
      usage,
    });
  });
}
