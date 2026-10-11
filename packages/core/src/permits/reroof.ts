const KEEP =
  /\b(reroof|re-roof|re roof|reroofing|roof replacement|replace(?:ment)? (?:of )?(?:the )?(?:existing )?roof(?:ing)?|new roof(?:ing)?|shingle replacement|roofing[- ]shingles|tear[- ]off.{0,50}(?:roof|shingle)|(?:roof|shingle).{0,50}tear[- ]off)\b/i;
const DROP_IF_ONLY_SOLAR = /\b(solar|photovoltaic|\bpv\b|solar panel|roof[- ]mounted solar)\b/i;

export const REROOF_SQL_LIKES = [
  "%REROOF%",
  "%RE-ROOF%",
  "%ROOF REPLACEMENT%",
  "%SHINGLE REPLACEMENT%",
  "%ROOFING-SHINGLE%",
];

export function isReroofText(...parts: Array<string | null | undefined>): boolean {
  const text = parts.filter(Boolean).join(" ").trim();
  if (!text) return false;
  if (KEEP.test(text)) return true;
  if (DROP_IF_ONLY_SOLAR.test(text)) return false;
  return false;
}

export function roofSqlWhere(fields: string[]): string {
  const parts = fields.flatMap((field) =>
    REROOF_SQL_LIKES.map((term) => `UPPER(${field}) LIKE '${term}'`),
  );
  return `(${parts.join(" OR ")})`;
}

export function sodaRoofWhere(fields: string[]): string {
  const parts = fields.flatMap((field) =>
    REROOF_SQL_LIKES.map((term) => `upper(${field}) like '${term.toLowerCase()}'`),
  );
  return `(${parts.join(" or ")})`;
}

export function yearFromPermitDate(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
    return yearFromPermitDate(Number(value));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
    if (!Number.isFinite(ms)) return null;
    const year = new Date(ms).getUTCFullYear();
    return year >= 1980 && year <= new Date().getFullYear() + 1 ? year : null;
  }
  const s = String(value);
  const year = Number(s.slice(0, 4));
  if (year >= 1980 && year <= new Date().getFullYear() + 1) return year;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y >= 1980 && y <= new Date().getFullYear() + 1 ? y : null;
}

export function streetKey(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|LANE|LN|COURT|CT|BOULEVARD|BLVD|PLACE|PL|TERRACE|TER|CIRCLE|CIR|WAY|HIGHWAY|HWY|NORTH|SOUTH|EAST|WEST|N|S|E|W)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}