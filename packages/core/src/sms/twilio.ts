import { createHmac, timingSafeEqual } from "node:crypto";

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  from: string;
};

export function twilioSignatureValid(input: {
  url: string;
  params: Record<string, string>;
  signature: string | null;
  authToken: string;
}): boolean {
  if (!input.signature) return false;
  const payload =
    input.url +
    Object.keys(input.params)
      .sort()
      .map((key) => key + input.params[key])
      .join("");
  const expected = createHmac("sha1", input.authToken).update(payload, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function sendTwilioSms(
  config: TwilioConfig,
  to: string,
  body: string,
): Promise<{ sid: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: config.from, Body: body }),
  });
  const data = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null;
  if (!res.ok || !data?.sid) {
    throw new Error(data?.message || "Twilio send failed");
  }
  return { sid: data.sid };
}
