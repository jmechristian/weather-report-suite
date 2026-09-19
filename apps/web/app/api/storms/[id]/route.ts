import { withAuth, jsonError, getDb } from "@/lib/server";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withAuth(async () => {
    const { id } = await context.params;
    const { client } = getDb();
    const [storm] = await client`
      SELECT
        s.*,
        ST_AsGeoJSON(s.geom)::json AS geom
      FROM storm_events s
      WHERE s.id = ${id}::uuid
    `;
    if (!storm) return jsonError("Storm not found", 404);
    const reports = await client`
      SELECT
        id, report_type, occurred_at, magnitude, magnitude_unit,
        ST_AsGeoJSON(geom)::json AS geom
      FROM storm_reports
      WHERE storm_event_id = ${id}::uuid
      ORDER BY occurred_at
    `;
    return Response.json({ storm, reports });
  });
}
