import { ingestStorms } from "@storm-leads/db";
import { getServerEnv } from "@storm-leads/core";
import { getDb, jsonError } from "@/lib/server";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) return jsonError("Unauthorized", 401);
  const { db, client } = getDb();
  const result = await ingestStorms(db, client);
  return Response.json(result);
}
