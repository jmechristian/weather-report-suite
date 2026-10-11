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
        p.mailing_address,
        p.owner_age,
        p.owner_dob,
        p.owner_is_property_owner,
        p.owner_deceased,
        p.owner_litigator,
        p.owner_emails,
        p.year_built,
        p.year_remodeled,
        p.last_reroof_year,
        p.property_type,
        p.county_fips,
        ST_AsGeoJSON(p.centroid)::json AS centroid
      FROM leads l
      JOIN parcels p ON p.id = l.parcel_id
      WHERE l.id = ${id}::uuid
    `;
    if (!lead) return jsonError("Lead not found", 404);
    const phones = await client`
      SELECT
        c.id, c.number, c.line_type, c.carrier, c.dnc, c.tcpa, c.rank, c.traced_at,
        (s.phone IS NOT NULL) AS suppressed,
        (cons.phone IS NOT NULL) AS consented
      FROM contacts c
      LEFT JOIN phone_suppressions s ON s.phone = c.number
      LEFT JOIN phone_consents cons ON cons.phone = c.number
      WHERE c.parcel_id = ${lead.parcel_id}::uuid
      ORDER BY c.rank
    `;
    return Response.json({ lead, phones });
  });
}
