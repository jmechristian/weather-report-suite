import { withAuth, jsonError, getDb } from "@/lib/server";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withAuth(async () => {
    const { id } = await context.params;
    const { client } = getDb();
    const [lead] = await client`
      SELECT
        l.id,
        l.score,
        l.score_breakdown,
        l.storm_event_id,
        p.id AS parcel_id,
        p.situs_address,
        p.situs_city,
        p.situs_zip,
        p.situs_state,
        p.owner_name,
        p.year_built,
        p.year_remodeled,
        p.property_type,
        p.county_fips,
        ST_AsGeoJSON(p.centroid)::json AS centroid
      FROM leads l
      JOIN parcels p ON p.id = l.parcel_id
      WHERE l.id = ${id}::uuid
    `;
    if (!lead) return jsonError("Lead not found", 404);
    const phones = await client`
      SELECT id, number, line_type, carrier, dnc, rank, traced_at
      FROM contacts
      WHERE parcel_id = ${lead.parcel_id}::uuid
      ORDER BY rank
    `;
    return Response.json({ lead, phones });
  });
}
