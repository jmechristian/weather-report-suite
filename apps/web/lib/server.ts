import { createDb } from "@storm-leads/db";

let cached: ReturnType<typeof createDb> | undefined;

export function getDb() {
  cached ??= createDb();
  return cached;
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function withAuth(handler: () => Promise<Response>): Promise<Response> {
  try {
    const { requireUserEmail } = await import("./supabase/server");
    await requireUserEmail();
    return await handler();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    if (message === "UNAUTHENTICATED") return jsonError("Sign in required", 401);
    if (message === "FORBIDDEN") return jsonError("Email not allowlisted", 403);
    console.error(err);
    return jsonError(message, 500);
  }
}
