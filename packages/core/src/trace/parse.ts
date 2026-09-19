import type { TraceResult, TracedPhone } from "../types";

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

function asPhones(raw: unknown): TracedPhone[] {
  if (typeof raw === "string") {
    const number = digitsToE164(raw);
    return number ? [{ number, lineType: null, carrier: null, dnc: null, rank: 1 }] : [];
  }
  if (!Array.isArray(raw)) return [];
  const phones: TracedPhone[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item === "string") {
      const number = digitsToE164(item);
      if (number) phones.push({ number, lineType: null, carrier: null, dnc: null, rank: i + 1 });
      continue;
    }
    const rec = asRecord(item);
    if (!rec) continue;
    const number = digitsToE164(String(rec.number ?? rec.phone ?? rec.phone_number ?? ""));
    if (!number) continue;
    phones.push({
      number,
      lineType: rec.type ? String(rec.type) : null,
      carrier: rec.carrier ? String(rec.carrier) : null,
      dnc: typeof rec.dnc === "boolean" ? rec.dnc : null,
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

function ownerFromPersons(persons: Array<Record<string, unknown>>): string | null {
  const owner = persons.find((p) => p.property_owner === true) ?? persons[0];
  return owner ? personName(owner) : null;
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
  const ownerName = ownerFromPersons(persons);
  const hit =
    body.hit === true || unique.length > 0 || Number(body.persons_count) > 0 || Boolean(ownerName);
  return {
    hit,
    ownerName,
    phones: unique,
    raw: body,
    creditsDeducted: creditsFrom(body, hit),
  };
}
