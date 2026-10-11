const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const RESUME_WORDS = new Set(["START", "UNSTOP"]);
const OPT_IN_WORDS = new Set(["JOIN"]);

export function normalizeSmsPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

function compact(body: string): string {
  return body
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isStopMessage(body: string): boolean {
  const word = compact(body).split(" ")[0] ?? "";
  return STOP_WORDS.has(word) && compact(body).split(" ").length === 1;
}

export function isResumeMessage(body: string): boolean {
  const text = compact(body);
  return RESUME_WORDS.has(text);
}

export function isOptInMessage(body: string): boolean {
  return OPT_IN_WORDS.has(compact(body));
}

export function isHotKeyword(body: string, keywords: string[]): boolean {
  if (isStopMessage(body) || isResumeMessage(body) || isOptInMessage(body)) return false;
  const text = compact(body);
  if (!text) return false;
  const first = text.split(" ")[0] ?? "";
  return keywords.some((keyword) => {
    const key = compact(keyword);
    return key.length > 0 && (text === key || first === key);
  });
}

export function renderSmsTemplate(
  body: string,
  fields: { owner?: string | null; address?: string | null; reply?: string | null },
): string {
  const owner = fields.owner?.trim().split(/\s+/)[0] || "there";
  const address = fields.address?.trim() || "your home";
  const reply = fields.reply?.trim() || "";
  return body
    .replaceAll("{owner}", owner)
    .replaceAll("{address}", address)
    .replaceAll("{reply}", reply);
}

export function cleanKeywords(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const key = compact(raw);
    if (!key || key.length > 24 || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= 20) break;
  }
  return out;
}

export const DEFAULT_HOMEOWNER_TEMPLATE =
  "Hi {owner}, this is Weather Report Suite. You asked us to text about storm damage at {address}. Reply YES if you want a look, or STOP to opt out.";

export const DEFAULT_ADMIN_TEMPLATE =
  "Hot lead: {owner} at {address} replied: {reply}";

export const DEFAULT_HOT_KEYWORDS = ["YES", "INTERESTED"];
