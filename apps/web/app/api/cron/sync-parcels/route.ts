import { getServerEnv } from "@storm-leads/core";
import { jsonError } from "@/lib/server";

export async function POST(request: Request) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return jsonError("Unauthorized", 401);
  }
  return Response.json({
    ok: true,
    hint: "Parcels load on Generate leads for homes inside the warning. Do not bulk-ingest the DMV.",
  });
}
