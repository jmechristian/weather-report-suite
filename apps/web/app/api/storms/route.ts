import { NextRequest } from "next/server";
import { z } from "zod";
import { ingestStorms } from "@storm-leads/db";
import { withAuth, jsonError, getDb } from "@/lib/server";

export const maxDuration = 300;

export async function GET() {
  return withAuth(async () => {
    const { client } = getDb();
    const rows = await client`
      SELECT
        s.id,
        s.event_type,
        s.occurred_at,
        s.expires_at,
        s.wind_mph,
        s.hail_in,
        s.severity,
        s.severity_unit,
        s.source,
        s.confidence,
        ST_AsGeoJSON(s.geom)::json AS geom,
        (
          SELECT count(*) FROM leads l WHERE l.storm_event_id = s.id
        )::int AS lead_count,
        (s.occurred_at > now() - interval '12 hours') AS recent
      FROM storm_events s
      WHERE s.occurred_at > now() - interval '12 months'
      ORDER BY s.occurred_at DESC
    `;
    return Response.json({ storms: rows, now: new Date().toISOString() });
  });
}

const SyncSchema = z.object({
  months: z.number().min(1).max(12).optional(),
  full: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  return withAuth(async () => {
    const body = SyncSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return jsonError("Invalid body");
    const { db, client } = getDb();
    const result = await ingestStorms(db, client, {
      full: body.data.full,
      months: body.data.full ? (body.data.months ?? 12) : body.data.months,
    });
    return Response.json(result);
  });
}
