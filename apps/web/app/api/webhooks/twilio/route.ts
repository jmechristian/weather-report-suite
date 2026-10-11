import { getServerEnv, getTwilioConfig, twilioSignatureValid } from "@storm-leads/core";
import { recordInbound } from "@storm-leads/db";
import { getDb } from "@/lib/server";

export async function POST(request: Request) {
  const twilio = getTwilioConfig();
  if (!twilio) return new Response("Twilio is not configured", { status: 503 });

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  const signature = request.headers.get("x-twilio-signature");
  if (
    !twilioSignatureValid({
      url: getServerEnv().TWILIO_WEBHOOK_URL ?? request.url,
      params,
      signature,
      authToken: twilio.authToken,
    })
  ) {
    return new Response("Invalid signature", { status: 403 });
  }

  const { client } = getDb();
  await recordInbound(client, {
    from: params.From ?? "",
    body: params.Body ?? "",
    providerId: params.MessageSid ?? null,
  });
  return new Response("<Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
}
