import { listTracedParcels, parseTracedQuery } from "@storm-leads/db";
import { withAuth, getDb } from "@/lib/server";

export async function GET(request: Request) {
  return withAuth(async () => {
    const url = new URL(request.url);
    const query = parseTracedQuery(url.searchParams);
    const { client } = getDb();
    const data = await listTracedParcels(client, query);
    return Response.json(data);
  });
}
