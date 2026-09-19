import { withAuth, jsonError, getDb } from "@/lib/server";

export async function GET(
  _req: Request,
  context: { params: Promise<{ stormId: string }> },
) {
  return withAuth(async () => {
    const { stormId } = await context.params;
    const { client } = getDb();
    const rows = await client`
      SELECT
        coalesce(p.owner_name, '') AS name,
        coalesce(p.situs_address, '') AS address,
        coalesce(p.situs_city, '') AS city,
        coalesce(p.situs_zip, '') AS zip,
        l.score,
        string_agg(c.number, ' | ' ORDER BY c.rank) AS phones
      FROM leads l
      JOIN parcels p ON p.id = l.parcel_id
      LEFT JOIN contacts c ON c.parcel_id = p.id
      WHERE l.storm_event_id = ${stormId}::uuid
        AND (
          p.owner_name IS NOT NULL
          OR EXISTS (SELECT 1 FROM contacts x WHERE x.parcel_id = p.id)
        )
      GROUP BY p.owner_name, p.situs_address, p.situs_city, p.situs_zip, l.score, l.id
      ORDER BY l.score DESC
    `;
    if (rows.length === 0) return jsonError("No skip-trace hits for this storm yet", 404);
    const header = "name,address,city,zip,score,phones";
    const csv = [
      header,
      ...rows.map((r) =>
        [r.name, r.address, r.city, r.zip, r.score, r.phones ?? ""]
          .map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`)
          .join(","),
      ),
    ].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="storm-${stormId}-hits.csv"`,
      },
    });
  });
}
