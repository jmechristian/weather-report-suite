import { cleanKeywords, getTwilioConfig } from "@storm-leads/core";
import {
  getMessageSettings,
  listCampaigns,
  listOptedInPhones,
  listReplies,
  listSendVolume,
  saveMessageSettings,
} from "@storm-leads/db";
import { getDb, jsonError, withAuth } from "@/lib/server";

export async function GET() {
  return withAuth(async () => {
    const { client } = getDb();
    const [settings, phones, campaigns, replies, volume] = await Promise.all([
      getMessageSettings(client),
      listOptedInPhones(client),
      listCampaigns(client),
      listReplies(client),
      listSendVolume(client),
    ]);
    const alreadySent = phones.filter((phone) => phone.already_sent).length;
    return Response.json({
      ...settings,
      twilioConfigured: Boolean(getTwilioConfig()),
      sendable: phones.length - alreadySent,
      alreadySent,
      campaigns,
      replies,
      volume,
    });
  });
}

export async function PUT(request: Request) {
  return withAuth(async () => {
    const body = (await request.json().catch(() => null)) as {
      homeowner?: string;
      adminAlert?: string;
      keywords?: string[];
    } | null;
    const homeowner = body?.homeowner?.trim() ?? "";
    const adminAlert = body?.adminAlert?.trim() ?? "";
    if (!homeowner || !adminAlert) return jsonError("Both messages need text.");
    const keywords = cleanKeywords(Array.isArray(body?.keywords) ? body.keywords : []);
    if (keywords.length === 0) return jsonError("Add at least one hot-lead word.");
    const { client } = getDb();
    await saveMessageSettings(client, { homeowner, adminAlert, keywords });
    return Response.json({ ok: true, keywords });
  });
}
