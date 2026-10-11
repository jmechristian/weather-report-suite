import { getTracedParcel } from "@storm-leads/db";
import { withAuth, jsonError, getDb } from "@/lib/server";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withAuth(async () => {
    const { id } = await context.params;
    const { client } = getDb();
    const data = await getTracedParcel(client, id);
    if (!data) return jsonError("Parcel not found", 404);
    return Response.json(data);
  });
}
