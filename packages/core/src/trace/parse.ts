import type { TraceResult, TracedMailing, TracedPhone } from "../types";

function digitsToE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapLookup(body: Record<string, unknown>): Record<string, unknown> {
  return asRecord(body.data) ?? asRecord(body.result) ?? body;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (["true", "dnc", "yes", "1"].includes(s)) return true;
  if (["false", "clean", "clear", "no", "0"].includes(s)) return false;
  return null;
}

function asAge(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 130) return null;
  return Math.trunc(n);
}

function asDob(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return /^\d{4}(-\d{2})?(-\d{2})?$/.test(s) ? s : null;
}

function asEmails(raw: unknown): string[] {
  if (typeof raw === "string" && raw.includes("@")) return [raw.trim()];
  if (!Array.isArray(raw)) return [];
  const emails: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.includes("@")) {
      emails.push(item.trim());
      continue;
    }
    const rec = asRecord(item);
    const email = String(rec?.email ?? rec?.address ?? "").trim();
    if (email.includes("@")) emails.push(email);
  }
  return [...new Set(emails)];
}

function asMailing(raw: unknown): TracedMailing | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const mailing: TracedMailing = {
    street: String(rec.street ?? rec.address ?? "").trim() || null,
    city: String(rec.city ?? "").trim() || null,
    state: String(rec.state ?? "").trim() || null,
    zip: String(rec.zip ?? rec.postal_code ?? "").replace(/\D/g, "").slice(0, 5) || null,
  };
  if (!mailing.street && !mailing.city && !mailing.zip) return null;
  return mailing;
}

export function formatMailingAddress(mailing: TracedMailing | null | undefined): string | null {
  if (!mailing) return null;
  const cityState = [mailing.city, mailing.state].filter(Boolean).join(", ");
  const cityStateZip = [cityState, mailing.zip].filter(Boolean).join(" ");
  const line = [mailing.street, cityStateZip].filter(Boolean).join(", ");
  return line || null;
}

function asPhones(raw: unknown): TracedPhone[] {
  if (typeof raw === "string") {
    const number = digitsToE164(raw);
    return number ? [{ number, lineType: null, carrier: null, dnc: null, tcpa: null, rank: 1 }] : [];
  }
  if (!Array.isArray(raw)) return [];
  const phones: TracedPhone[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item === "string") {
      const number = digitsToE164(item);
      if (number) phones.push({ number, lineType: null, carrier: null, dnc: null, tcpa: null, rank: i + 1 });
      continue;
    }
    const rec = asRecord(item);
    if (!rec) continue;
    const number = digitsToE164(String(rec.number ?? rec.phone ?? rec.phone_number ?? ""));
    if (!number) continue;
    const type = rec.type ?? rec.line_type;
    phones.push({
      number,
      lineType: type ? String(type) : null,
      carrier: rec.carrier ? String(rec.carrier) : null,
      dnc: asBool(rec.dnc),
      tcpa: asBool(rec.tcpa),
      rank: typeof rec.rank === "number" ? rec.rank : i + 1,
    });
  }
  return phones.sort((a, b) => a.rank - b.rank);
}

function personName(person: Record<string, unknown>): string | null {
  const full = String(person.full_name ?? "").trim();
  if (full) return full;
  const name = `${String(person.first_name ?? "").trim()} ${String(person.last_name ?? "").trim()}`.trim();
  return name || null;
}

function pickPerson(persons: Array<Record<string, unknown>>): Record<string, unknown> | null {
  return persons.find((p) => p.property_owner === true) ?? persons[0] ?? null;
}

function creditsFrom(body: Record<string, unknown>, hit: boolean): number {
  const n = Number(body.credits_deducted);
  if (Number.isFinite(n)) return n;
  return hit ? 5 : 0;
}

export function parseTracerfyLookup(raw: unknown): TraceResult {
  const root = asRecord(raw) ?? {};
  const body = unwrapLookup(root);
  const contacts = asRecord(body.contacts) ?? {};
  const persons = Array.isArray(body.persons)
    ? body.persons.filter((p): p is Record<string, unknown> => Boolean(asRecord(p)))
    : [];
  const owner = pickPerson(persons);
  const phones: TracedPhone[] = [
    ...asPhones(contacts.phones ?? body.phones),
    ...persons.flatMap((person) => asPhones(person.phones)),
  ];
  const seen = new Set<string>();
  const unique = phones.filter((p) => {
    if (seen.has(p.number)) return false;
    seen.add(p.number);
    return true;
  });
  const mailingAddress = asMailing(owner?.mailing_address ?? body.mailing_address);
  const emails = asEmails(owner?.emails ?? contacts.emails ?? body.emails);
  const ownerName = owner ? personName(owner) : null;
  const hit =
    body.hit === true ||
    unique.length > 0 ||
    emails.length > 0 ||
    Number(body.persons_count) > 0 ||
    Boolean(ownerName);
  return {
    hit,
    ownerName,
    ownerAge: asAge(owner?.age),
    ownerDob: asDob(owner?.dob),
    propertyOwner: asBool(owner?.property_owner),
    deceased: asBool(owner?.deceased),
    litigator: asBool(owner?.litigator),
    mailingAddress,
    mailingAddressText: formatMailingAddress(mailingAddress),
    emails,
    phones: unique,
    raw: body,
    creditsDeducted: creditsFrom(body, hit),
  };
}
