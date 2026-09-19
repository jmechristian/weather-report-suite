import { withAuth, getDb } from "@/lib/server";
import { getUsageSnapshot } from "@storm-leads/db";

export async function GET(request: Request) {
  return withAuth(async () => {
    const stormId = new URL(request.url).searchParams.get("stormId");
    const { client } = getDb();
    const usage = await getUsageSnapshot(client, stormId);
    return Response.json(usage);
  });
}
