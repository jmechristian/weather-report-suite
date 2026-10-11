import { setPhoneConsent } from "@storm-leads/db";
import { getDb, jsonError, withAuth } from "@/lib/server";

export async function POST(request: Request) {
  return withAuth(async () => {
    const body = (await request.json().catch(() => null)) as {
      phone?: string;
      parcelId?: string;
      consented?: boolean;
    } | null;
    if (!body?.phone || !body.parcelId) return jsonError("Missing number or home.");
    const { client } = getDb();
    const result = await setPhoneConsent(client, {
      phone: body.phone,
      parcelId: body.parcelId,
      consented: body.consented === true,
    });
    if (!result.ok) return jsonError(result.error);
    return Response.json({ ok: true });
  });
}
