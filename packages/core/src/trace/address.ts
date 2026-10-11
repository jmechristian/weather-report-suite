import { dmvCounty } from "../counties/dmv";
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

export function pickCountyMatch(
  results: AutocompleteMatch[],
  countyFips?: string | null,
): AutocompleteMatch | null {
  if (results.length === 0) return null;
  if (!countyFips) return results[0] ?? null;
  const fips = countyFips.trim();
  const short = fips.slice(-3);
  return (
    results.find(
      (row) =>
        row.fips === fips ||
        row.county_fips === fips ||
        row.county_fips === short,
    ) ??
    results[0] ??
    null
  );
}

export function pickStaffordMatch(results: AutocompleteMatch[]): AutocompleteMatch | null {
  return pickCountyMatch(results, "51179");
}

/** Tracerfy wants title-cased county names ('District Of Columbia', 'Palm Beach'). */
export function tracerfyCountyName(name?: string | null): string | null {
  const trimmed = (name ?? "").replace(/\s+County$/i, "").trim();
  if (!trimmed) return null;
  return trimmed.replace(/[A-Za-z][A-Za-z']*/g, (word) => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

export function traceState(input: Pick<TraceInput, "state" | "countyFips">): string {
  const fromInput = (input.state ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(fromInput)) return fromInput;
  return dmvCounty(input.countyFips)?.state ?? fromInput;
}

export function hasStreetAddress(input: Pick<TraceInput, "address">): boolean {
  return Boolean(input.address?.trim());
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
    const only = parts[0];
    if (parts.length === 1 && only?.includes("-")) return only;
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

function collapseParcelId(raw?: string | null): string | null {
  const next = (raw ?? "").replace(/\s+/g, " ").trim();
  return next || null;
}

/** GIS APN as Tracerfy expects it. Stafford PRCLID is space-padded map-insert-section-lot. */
export function formatParcelIdForTrace(input: {
  countyFips?: string | null;
  parcelId?: string | null;
  parcelIdAlt?: string | null;
  pageNum?: string | null;
  captLot?: string | null;
  insNum?: string | null;
  sectNum?: string | null;
}): string | null {
  if (input.countyFips === "51179") {
    return formatStaffordApn(input) ?? collapseParcelId(input.parcelId);
  }
  return collapseParcelId(input.parcelId);
}

export type ParcelLookupBody = {
  parcel_id: string;
  county: string;
  state: string;
};

export function parcelLookupBody(input: TraceInput): ParcelLookupBody | null {
  const parcel_id = formatParcelIdForTrace(input);
  const county =
    tracerfyCountyName(input.countyName) ?? tracerfyCountyName(dmvCounty(input.countyFips)?.name);
  const state = traceState(input);
  if (!parcel_id || !county || !/^[A-Z]{2}$/.test(state)) return null;
  return { parcel_id, county, state };
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
