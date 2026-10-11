import { setParcelHot } from "@storm-leads/db";
import { getDb, jsonError, withAuth } from "@/lib/server";

export async function POST(request: Request) {
  return withAuth(async () => {
    const body = (await request.json().catch(() => null)) as { parcelId?: string; hot?: boolean } | null;
    if (!body?.parcelId) return jsonError("Missing home.");
    const { client } = getDb();
    await setParcelHot(client, body.parcelId, body.hot === true);
    return Response.json({ ok: true });
  });
}
