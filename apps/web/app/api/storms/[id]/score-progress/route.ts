import { withAuth, jsonError, getDb } from "@/lib/server";
import { getScoreProgress } from "@storm-leads/db";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withAuth(async () => {
    const { id } = await context.params;
    const { client } = getDb();
    const [storm] = await client`SELECT id FROM storm_events WHERE id = ${id}::uuid`;
    if (!storm) return jsonError("Storm not found", 404);
    return Response.json(await getScoreProgress(client, id));
  });
}
