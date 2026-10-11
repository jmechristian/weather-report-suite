import { getTwilioConfig, normalizeSmsPhone, renderSmsTemplate, sendTwilioSms } from "@storm-leads/core";
import { getMessageSettings, recordOutreach } from "@storm-leads/db";
import { getDb, jsonError, withAuth } from "@/lib/server";

export async function POST(request: Request) {
  return withAuth(async () => {
    const twilio = getTwilioConfig();
    if (!twilio) return jsonError("Add Twilio keys before sending a test.");
    const body = (await request.json().catch(() => null)) as {
      to?: string;
      template?: string;
    } | null;
    const to = normalizeSmsPhone(body?.to ?? "");
    if (!to) return jsonError("Enter a mobile number for the test.");
    const template = body?.template === "admin_alert" ? "admin_alert" : "homeowner";
    const { client } = getDb();
    const settings = await getMessageSettings(client);
    const text = renderSmsTemplate(template === "admin_alert" ? settings.adminAlert : settings.homeowner, {
      owner: "Alex",
      address: "100 Main St",
      reply: "YES",
    });
    try {
      const result = await sendTwilioSms(twilio, to, text);
      await recordOutreach(client, {
        phone: to,
        direction: "out",
        status: "sent",
        body: text,
        isTest: true,
        providerId: result.sid,
      });
      return Response.json({ ok: true, sid: result.sid });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Test send failed";
      return jsonError(message, 502);
    }
  });
}
