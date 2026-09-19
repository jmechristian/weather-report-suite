import { jsonError } from "@/lib/server";
import { getServerEnv } from "@storm-leads/core";

export async function POST(request: Request) {
  const env = getServerEnv();
  const secret = env.TRACERFY_WEBHOOK_SECRET;
  if (secret) {
    const header = request.headers.get("x-tracerfy-signature") ?? request.headers.get("authorization");
    if (header !== secret && header !== `Bearer ${secret}`) {
      return jsonError("Invalid webhook secret", 401);
    }
  }
  const body = await request.json().catch(() => null);
  console.log("Tracerfy webhook received", body ? Object.keys(body as object) : "empty");
  return Response.json({ ok: true });
}
