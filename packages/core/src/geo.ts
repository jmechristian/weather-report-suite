import type { PropertyType } from "./types";

const ENTITY_RE = /\b(LLC|L\.L\.C|INC|INCORPORATED|CORP|CORPORATION|TRUST|TR\b|LP|LLP|LTD|ESTATE|HOA|HOMEOWNERS)\b/i;

export function normalizePin(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s-]/g, "").toUpperCase();
}

export function ownerLooksLikeEntity(name: string | null | undefined): boolean {
  if (!name) return false;
  return ENTITY_RE.test(name);
}

function codeIn(list: Array<string | number> | undefined, raw: unknown): boolean {
  if (!list || raw == null) return false;
  const asString = String(raw).trim();
  return list.some((c) => String(c) === asString);
}

export function classifyPropertyType(input: {
  landUse?: unknown;
  parcelType?: unknown;
  singleFamilyCodes?: Array<string | number>;
  attachedCodes?: Array<string | number>;
  condoCodes?: Array<string | number>;
}): PropertyType {
  const parcelType = String(input.parcelType ?? "").toUpperCase();
  if (parcelType === "CONDO") return "condo";

  if (codeIn(input.condoCodes, input.landUse)) return "condo";
  if (codeIn(input.attachedCodes, input.landUse)) return "attached";
  if (codeIn(input.singleFamilyCodes, input.landUse)) return "single_family";

  const hay = `${input.landUse ?? ""} ${input.parcelType ?? ""}`.toLowerCase();
  if (/\bcondo/.test(hay)) return "condo";
  if (/\btown ?house|townhome|attached/.test(hay)) return "attached";
  if (/\bcommercial|industrial|office|retail/.test(hay)) return "commercial";
  if (/\bsingle family|sfr|detached|ordinary|\bresidential\b/.test(hay)) return "single_family";
  // Cadastral labels (Frederick TAXPARCELTYPE "Parcel - Base") are not land use.
  if (/\bparcel\b/.test(hay)) return "single_family";
  if (!hay.trim() || hay.trim().length <= 2) return "single_family";
  return "other";
}

export function toMultiPolygon(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
): GeoJSON.MultiPolygon {
  if (geometry.type === "MultiPolygon") return geometry;
  return { type: "MultiPolygon", coordinates: [geometry.coordinates] };
}

/** Degrees covering the seeded counties, from north of Baltimore through Richmond. Rejects state-plane coordinates. */
export function looksLikeNorthernVa(lon: number, lat: number): boolean {
  return lon > -79.4 && lon < -75.7 && lat > 37.35 && lat < 39.85;
}
