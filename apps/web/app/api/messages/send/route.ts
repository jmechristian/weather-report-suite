import { getTwilioConfig, renderSmsTemplate, sendTwilioSms } from "@storm-leads/core";
import {
  createCampaign,
  expireStaleCampaigns,
  finishCampaign,
  getMessageSettings,
  listOptedInPhones,
  recordOutreach,
  runningCampaignId,
} from "@storm-leads/db";
import { getDb, jsonError, withAuth } from "@/lib/server";

export async function POST(request: Request) {
  return withAuth(async () => {
    const twilio = getTwilioConfig();
    if (!twilio) return jsonError("Add Twilio keys before sending texts.");
    const body = (await request.json().catch(() => null)) as { includeAlreadySent?: boolean } | null;
    const includeAlreadySent = body?.includeAlreadySent === true;
    const { client } = getDb();
    await expireStaleCampaigns(client);
    if (await runningCampaignId(client)) return jsonError("A send is already running.", 409);

    const settings = await getMessageSettings(client);
    const phones = await listOptedInPhones(client);
    const skipped = includeAlreadySent ? [] : phones.filter((phone) => phone.already_sent);
    const targets = includeAlreadySent ? phones : phones.filter((phone) => !phone.already_sent);
    if (targets.length === 0) {
      return jsonError(
        skipped.length
          ? "Everyone who asked for texts has already been texted."
          : "No opted-in numbers to text.",
      );
    }

    const campaignId = await createCampaign(client, {
      body: settings.homeowner,
      includeAlreadySent,
      requested: phones.length,
      skipped: skipped.length,
    });

    let sent = 0;
    let failed = 0;
    let error: string | null = null;
    try {
      for (const target of targets) {
        const text = renderSmsTemplate(settings.homeowner, {
          owner: target.owner_name,
          address: target.situs_address,
        });
        try {
          const result = await sendTwilioSms(twilio, target.phone, text);
          sent += 1;
          await recordOutreach(client, {
            parcelId: target.parcel_id,
            contactId: target.contact_id,
            campaignId,
            phone: target.phone,
            direction: "out",
            status: "sent",
            body: text,
            providerId: result.sid,
          });
        } catch (err) {
          failed += 1;
          error = err instanceof Error ? err.message : "Send failed";
          await recordOutreach(client, {
            parcelId: target.parcel_id,
            contactId: target.contact_id,
            campaignId,
            phone: target.phone,
            direction: "out",
            status: "failed",
            body: text,
            raw: { error },
          });
        }
      }
    } finally {
      await finishCampaign(client, campaignId, {
        sent,
        failed,
        error: failed > 0 && sent === 0 ? error : null,
      });
    }

    return Response.json({ campaignId, requested: phones.length, sent, skipped: skipped.length, failed });
  });
}
