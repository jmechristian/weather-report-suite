import { generateLeads } from "@storm-leads/db";
import { withAuth, jsonError, getDb } from "@/lib/server";

export const maxDuration = 300;

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withAuth(async () => {
    const { id } = await context.params;
    console.log(`generate-leads start ${id}`);
    const { db, client } = getDb();
    const [storm] = await client`SELECT id FROM storm_events WHERE id = ${id}::uuid`;
    if (!storm) return jsonError("Storm not found", 404);
    const result = await generateLeads(db, client, id);
    console.log(`generate-leads ${id}`, result);
    return Response.json(result);
  });
}
