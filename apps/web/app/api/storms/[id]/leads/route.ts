import { withAuth, getDb } from "@/lib/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withAuth(async () => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const { client } = getDb();
    const rows = await client`
      SELECT
        l.id,
        l.score,
        l.score_breakdown,
        p.id AS parcel_id,
        p.situs_address,
        p.situs_city,
        p.situs_zip,
        p.situs_state,
        c.name AS county_name,
        p.owner_name,
        p.year_built,
        p.last_reroof_year,
        p.property_type,
        p.county_fips,
        ST_AsGeoJSON(p.centroid)::json AS centroid,
        (
          SELECT c.number FROM contacts c
          WHERE c.parcel_id = p.id
          ORDER BY c.rank
          LIMIT 1
        ) AS primary_phone
      FROM leads l
      JOIN parcels p ON p.id = l.parcel_id
      JOIN counties c ON c.fips = p.county_fips
      WHERE l.storm_event_id = ${id}::uuid
      ORDER BY l.score DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    return Response.json({ leads: rows });
  });
}
