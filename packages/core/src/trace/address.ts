import type { TraceInput } from "../types";

export type AutocompleteMatch = {
  street_address?: string;
  city?: string;
  state?: string;
  zip?: string;
  county?: string;
  county_fips?: string;
  fips?: string;
};

const END_SUFFIX: Array<[RegExp, string]> = [
  [/\s+LN$/i, " Lane"],
  [/\s+DR$/i, " Drive"],
  [/\s+RD$/i, " Road"],
  [/\s+CT$/i, " Court"],
  [/\s+CIR$/i, " Circle"],
  [/\s+BLVD$/i, " Boulevard"],
  [/\s+TER$/i, " Terrace"],
  [/\s+PL$/i, " Place"],
  [/\s+AVE$/i, " Avenue"],
  [/\s+TRL$/i, " Trail"],
];

export function expandStreetSuffix(address: string): string {
  let next = address.trim();
  for (const [pattern, replacement] of END_SUFFIX) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

export function autocompleteQuery(input: TraceInput): string {
  return [expandStreetSuffix(input.address), input.city, input.state, input.zip]
    .filter((part) => part && String(part).trim())
    .join(", ");
}

export function pickStaffordMatch(results: AutocompleteMatch[]): AutocompleteMatch | null {
  if (results.length === 0) return null;
  return (
    results.find(
      (row) =>
        row.fips === "51179" ||
        row.county_fips === "179" ||
        /stafford/i.test(row.county ?? ""),
    ) ?? results[0]
  );
}

export function formatStaffordApn(input: {
  parcelId?: string | null;
  parcelIdAlt?: string | null;
  pageNum?: string | null;
  captLot?: string | null;
  insNum?: string | null;
  sectNum?: string | null;
}): string | null {
  const prclid = input.parcelId?.trim();
  if (prclid) {
    const parts = prclid.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return parts.join("-");
    if (parts.length === 1 && parts[0].includes("-")) return parts[0];
  }
  const page = (input.pageNum ?? "").trim();
  const ins = (input.insNum ?? "").trim();
  const sect = (input.sectNum ?? "").trim();
  const lot = (input.captLot ?? "").trim();
  const composed = [`${page}${ins}`, sect, lot].filter(Boolean);
  if (composed.length >= 2) return composed.join("-");
  const nsp = input.parcelIdAlt?.replace(/\s+/g, "").trim();
  if (nsp?.includes("-")) return nsp;
  return null;
}

export function resolveFromMatch(input: TraceInput, match: AutocompleteMatch | null): TraceInput {
  if (!match?.street_address) {
    return { ...input, address: expandStreetSuffix(input.address) };
  }
  return {
    ...input,
    address: match.street_address,
    city: match.city || input.city,
    state: match.state || input.state,
    zip: (match.zip ?? input.zip).replace(/\D/g, "").slice(0, 5),
  };
}
