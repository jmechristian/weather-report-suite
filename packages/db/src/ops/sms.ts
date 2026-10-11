import {
  DEFAULT_ADMIN_TEMPLATE,
  DEFAULT_HOMEOWNER_TEMPLATE,
  DEFAULT_HOT_KEYWORDS,
  isHotKeyword,
  isOptInMessage,
  isResumeMessage,
  isSmsEligiblePhone,
  isStopMessage,
  normalizeSmsPhone,
} from "@storm-leads/core";
import type { Sql } from "../client";

export type MessageSettings = {
  homeowner: string;
  adminAlert: string;
  keywords: string[];
};

export type SendablePhone = {
  contact_id: string;
  parcel_id: string;
  phone: string;
  owner_name: string | null;
  situs_address: string | null;
  already_sent: boolean;
};

type Candidate = SendablePhone & {
  line_type: string | null;
  dnc: boolean | null;
  tcpa: boolean | null;
  suppressed: boolean;
  owner_deceased: boolean | null;
  owner_litigator: boolean | null;
};

export async function getMessageSettings(client: Sql): Promise<MessageSettings> {
  const rows = await client<{ key: string; body: string; keywords: string[] | null }[]>`
    SELECT key, body, keywords FROM message_templates WHERE key IN ('homeowner', 'admin_alert')
  `;
  const homeowner = rows.find((row) => row.key === "homeowner");
  const admin = rows.find((row) => row.key === "admin_alert");
  return {
    homeowner: homeowner?.body || DEFAULT_HOMEOWNER_TEMPLATE,
    adminAlert: admin?.body || DEFAULT_ADMIN_TEMPLATE,
    keywords: homeowner?.keywords?.length ? homeowner.keywords : DEFAULT_HOT_KEYWORDS,
  };
}

export async function saveMessageSettings(
  client: Sql,
  settings: MessageSettings,
): Promise<void> {
  await client`
    INSERT INTO message_templates (key, body, keywords, updated_at)
    VALUES ('homeowner', ${settings.homeowner}, ${settings.keywords}, now())
    ON CONFLICT (key) DO UPDATE
      SET body = EXCLUDED.body, keywords = EXCLUDED.keywords, updated_at = now()
  `;
  await client`
    INSERT INTO message_templates (key, body, keywords, updated_at)
    VALUES ('admin_alert', ${settings.adminAlert}, ARRAY[]::text[], now())
    ON CONFLICT (key) DO UPDATE
      SET body = EXCLUDED.body, updated_at = now()
  `;
}

export async function listOptedInPhones(client: Sql): Promise<SendablePhone[]> {
  const rows = await client<Candidate[]>`
    SELECT DISTINCT ON (c.number)
      c.id AS contact_id,
      c.parcel_id,
      c.number AS phone,
      c.line_type,
      c.dnc,
      c.tcpa,
      p.owner_name,
      p.situs_address,
      coalesce(p.owner_deceased, false) AS owner_deceased,
      coalesce(p.owner_litigator, false) AS owner_litigator,
      (s.phone IS NOT NULL) AS suppressed,
      EXISTS (
        SELECT 1 FROM outreach_events o
        WHERE o.phone = c.number AND o.direction = 'out' AND o.is_test = false
      ) AS already_sent
    FROM contacts c
    JOIN parcels p ON p.id = c.parcel_id
    JOIN phone_consents cons ON cons.phone = c.number
    LEFT JOIN phone_suppressions s ON s.phone = c.number
    ORDER BY c.number, c.rank
  `;
  return rows
    .filter((row) =>
      isSmsEligiblePhone({
        lineType: row.line_type,
        dnc: row.dnc,
        tcpa: row.tcpa,
        suppressed: row.suppressed,
        ownerDeceased: row.owner_deceased,
        ownerLitigator: row.owner_litigator,
      }),
    )
    .map((row) => ({
      contact_id: row.contact_id,
      parcel_id: row.parcel_id,
      phone: row.phone,
      owner_name: row.owner_name,
      situs_address: row.situs_address,
      already_sent: row.already_sent,
    }));
}

export async function expireStaleCampaigns(client: Sql) {
  await client`
    UPDATE sms_campaigns
    SET status = 'failed', error = 'interrupted', finished_at = now()
    WHERE status = 'running' AND started_at < now() - interval '15 minutes'
  `;
}

export async function runningCampaignId(client: Sql): Promise<string | null> {
  const [row] = await client<{ id: string }[]>`
    SELECT id FROM sms_campaigns WHERE status = 'running' LIMIT 1
  `;
  return row?.id ?? null;
}

export async function createCampaign(
  client: Sql,
  input: {
    body: string;
    includeAlreadySent: boolean;
    requested: number;
    skipped: number;
  },
): Promise<string> {
  const [row] = await client<{ id: string }[]>`
    INSERT INTO sms_campaigns (
      template_key, body_snapshot, status, include_already_sent, requested, skipped
    )
    VALUES ('homeowner', ${input.body}, 'running', ${input.includeAlreadySent}, ${input.requested}, ${input.skipped})
    RETURNING id
  `;
  if (!row) throw new Error("Could not start the send");
  return row.id;
}

export async function finishCampaign(
  client: Sql,
  id: string,
  input: { sent: number; failed: number; error?: string | null },
) {
  await client`
    UPDATE sms_campaigns
    SET status = ${input.error ? "failed" : "done"},
        sent = ${input.sent},
        failed = ${input.failed},
        error = ${input.error ?? null},
        finished_at = now()
    WHERE id = ${id}::uuid
  `;
}

export async function recordOutreach(
  client: Sql,
  input: {
    parcelId?: string | null;
    contactId?: string | null;
    campaignId?: string | null;
    phone: string;
    direction: "in" | "out";
    status?: string | null;
    body?: string | null;
    isTest?: boolean;
    providerId?: string | null;
    raw?: unknown;
  },
) {
  await client`
    INSERT INTO outreach_events (
      parcel_id, contact_id, campaign_id, phone, direction, status, body, is_test, provider_id, raw
    )
    VALUES (
      ${input.parcelId ?? null}::uuid,
      ${input.contactId ?? null}::uuid,
      ${input.campaignId ?? null}::uuid,
      ${input.phone},
      ${input.direction},
      ${input.status ?? null},
      ${input.body ?? null},
      ${input.isTest ?? false},
      ${input.providerId ?? null},
      ${input.raw ? client.json(input.raw as never) : null}
    )
  `;
}

export async function listCampaigns(client: Sql) {
  return client<
    {
      id: string;
      status: string;
      requested: number;
      sent: number;
      skipped: number;
      failed: number;
      started_at: string | Date;
      finished_at: string | Date | null;
      error: string | null;
    }[]
  >`
    SELECT id, status, requested, sent, skipped, failed, started_at, finished_at, error
    FROM sms_campaigns
    ORDER BY started_at DESC
    LIMIT 20
  `;
}

export async function listReplies(client: Sql) {
  return client<
    {
      id: string;
      phone: string;
      body: string | null;
      occurred_at: string | Date;
      status: string | null;
      parcel_id: string | null;
      owner_name: string | null;
      situs_address: string | null;
      hot_lead: boolean | null;
      hot_hold: boolean | null;
    }[]
  >`
    SELECT
      o.id, o.phone, o.body, o.occurred_at, o.status,
      p.id AS parcel_id, p.owner_name, p.situs_address, p.hot_lead, p.hot_hold
    FROM outreach_events o
    LEFT JOIN parcels p ON p.id = o.parcel_id
    WHERE o.direction = 'in' AND o.is_test = false
    ORDER BY o.occurred_at DESC
    LIMIT 100
  `;
}

export async function listSendVolume(client: Sql) {
  return client<{ phone: string; sent: number; last_sent: string | Date }[]>`
    SELECT phone, count(*)::int AS sent, max(occurred_at) AS last_sent
    FROM outreach_events
    WHERE direction = 'out' AND is_test = false
    GROUP BY phone
    ORDER BY sent DESC, last_sent DESC
    LIMIT 50
  `;
}

export async function setPhoneConsent(
  client: Sql,
  input: { phone: string; parcelId: string; consented: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const phone = normalizeSmsPhone(input.phone);
  if (!phone) return { ok: false, error: "That number is not a mobile we can text." };
  const [contact] = await client<
    {
      line_type: string | null;
      dnc: boolean | null;
      tcpa: boolean | null;
      suppressed: boolean;
      owner_deceased: boolean | null;
      owner_litigator: boolean | null;
    }[]
  >`
    SELECT
      c.line_type, c.dnc, c.tcpa,
      (s.phone IS NOT NULL) AS suppressed,
      p.owner_deceased, p.owner_litigator
    FROM contacts c
    JOIN parcels p ON p.id = c.parcel_id
    LEFT JOIN phone_suppressions s ON s.phone = c.number
    WHERE c.parcel_id = ${input.parcelId}::uuid AND c.number = ${phone}
    LIMIT 1
  `;
  if (!contact) return { ok: false, error: "That number is not on this home." };
  if (
    !isSmsEligiblePhone({
      lineType: contact.line_type,
      dnc: contact.dnc,
      tcpa: contact.tcpa,
      suppressed: contact.suppressed,
      ownerDeceased: contact.owner_deceased,
      ownerLitigator: contact.owner_litigator,
    })
  ) {
    return { ok: false, error: "This number is not eligible for texts." };
  }
  if (!input.consented) {
    await client`DELETE FROM phone_consents WHERE phone = ${phone}`;
    return { ok: true };
  }
  await client`
    INSERT INTO phone_consents (phone, source, parcel_id)
    VALUES (${phone}, 'staff', ${input.parcelId}::uuid)
    ON CONFLICT (phone) DO UPDATE
      SET source = 'staff', parcel_id = EXCLUDED.parcel_id, created_at = now()
  `;
  return { ok: true };
}

export async function setParcelHot(client: Sql, parcelId: string, hot: boolean) {
  if (hot) {
    await client`
      UPDATE parcels
      SET hot_lead = true, hot_lead_source = 'manual', hot_lead_at = now(), hot_hold = false
      WHERE id = ${parcelId}::uuid
    `;
    return;
  }
  await client`
    UPDATE parcels
    SET hot_lead = false, hot_lead_source = 'manual', hot_hold = true
    WHERE id = ${parcelId}::uuid
  `;
}

export async function recordInbound(
  client: Sql,
  input: { from: string; body: string; providerId: string | null },
) {
  const phone = normalizeSmsPhone(input.from);
  if (!phone) return;
  const settings = await getMessageSettings(client);
  const [match] = await client<
    { contact_id: string; parcel_id: string; hot_hold: boolean }[]
  >`
    SELECT c.id AS contact_id, c.parcel_id, p.hot_hold
    FROM contacts c
    JOIN parcels p ON p.id = c.parcel_id
    WHERE c.number = ${phone}
    ORDER BY c.traced_at DESC
    LIMIT 1
  `;

  let status = "received";
  if (isStopMessage(input.body)) {
    status = "stop";
    await client`
      INSERT INTO phone_suppressions (phone, reason, source_parcel_id, raw)
      VALUES (${phone}, 'stop', ${match?.parcel_id ?? null}::uuid, ${client.json({ body: input.body })})
      ON CONFLICT (phone) DO NOTHING
    `;
    await client`DELETE FROM phone_consents WHERE phone = ${phone}`;
  } else if (isResumeMessage(input.body)) {
    status = "resume";
    await client`DELETE FROM phone_suppressions WHERE phone = ${phone}`;
  } else if (isOptInMessage(input.body) && match) {
    status = "opt-in";
    const [contact] = await client<
      {
        line_type: string | null;
        dnc: boolean | null;
        tcpa: boolean | null;
        owner_deceased: boolean | null;
        owner_litigator: boolean | null;
      }[]
    >`
      SELECT c.line_type, c.dnc, c.tcpa, p.owner_deceased, p.owner_litigator
      FROM contacts c
      JOIN parcels p ON p.id = c.parcel_id
      WHERE c.id = ${match.contact_id}::uuid
    `;
    if (
      contact &&
      isSmsEligiblePhone({
        lineType: contact.line_type,
        dnc: contact.dnc,
        tcpa: contact.tcpa,
        suppressed: false,
        ownerDeceased: contact.owner_deceased,
        ownerLitigator: contact.owner_litigator,
      })
    ) {
      await client`
        INSERT INTO phone_consents (phone, source, parcel_id)
        VALUES (${phone}, 'keyword', ${match.parcel_id}::uuid)
        ON CONFLICT (phone) DO UPDATE
          SET source = 'keyword', parcel_id = EXCLUDED.parcel_id, created_at = now()
      `;
    }
  } else if (match && !match.hot_hold && isHotKeyword(input.body, settings.keywords)) {
    status = "hot";
    await client`
      UPDATE parcels
      SET hot_lead = true, hot_lead_source = 'keyword', hot_lead_at = now()
      WHERE id = ${match.parcel_id}::uuid AND hot_hold = false
    `;
  }

  await recordOutreach(client, {
    parcelId: match?.parcel_id ?? null,
    contactId: match?.contact_id ?? null,
    phone,
    direction: "in",
    status,
    body: input.body,
    providerId: input.providerId,
  });
}
