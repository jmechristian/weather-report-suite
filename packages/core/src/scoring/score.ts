import distance from "@turf/distance";
import { point } from "@turf/helpers";
import type { ScoringInput, ScoredLead } from "../types";

const WEIGHTS = {
  severity: 0.25,
  coreProximity: 0.2,
  homeAge: 0.3,
  ownerOccupied: 0.1,
  propertyFit: 0.1,
  sourceConfidence: 0.05,
} as const;

function clamp(n: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, n));
}

export function normalizeWindMph(mph?: number | null): number {
  if (mph == null || Number.isNaN(mph)) return 0;
  return clamp((mph - 50) / 30);
}

export function normalizeHailInches(inches?: number | null): number {
  if (inches == null || Number.isNaN(inches)) return 0;
  return clamp((inches - 0.75) / 1.75);
}

function usableYear(year?: number | null): number | null {
  if (year == null || year < 1800 || year > new Date().getFullYear() + 1) return null;
  return year;
}

/** Home age / roof proxy. Reroof year wins, else year built. 20+ years = full intent. */
export function homeAgeFactor(
  yearBuilt?: number | null,
  yearRemodeled?: number | null,
  nowYear = new Date().getFullYear(),
  lastReroofYear?: number | null,
): number {
  const year = usableYear(lastReroofYear) ?? usableYear(yearBuilt) ?? usableYear(yearRemodeled);
  if (!year) return 0.5;
  const age = nowYear - year;
  if (age <= 8) return 0.15;
  if (age <= 15) return 0.4;
  if (age < 20) return 0.75;
  return 1;
}

export const roofAgeFactor = homeAgeFactor;

function coreProximity(input: ScoringInput): number {
  const origin = point(input.parcelCentroid);
  const lsr = input.lsrPoints ?? [];
  if (lsr.length > 0) {
    let minKm = Infinity;
    for (const coord of lsr) {
      const km = distance(origin, point(coord), { units: "kilometers" });
      if (km < minKm) minKm = km;
    }
    return clamp(1 - minKm / 8);
  }
  const km = distance(origin, point(input.stormCentroid), { units: "kilometers" });
  const radius = Math.max(input.stormRadiusKm, 2);
  return clamp(1 - km / radius);
}

export function scoreLead(input: ScoringInput): ScoredLead {
  const severity = Math.max(
    normalizeWindMph(input.windMph),
    normalizeHailInches(input.hailIn),
  );
  const factors = {
    severity,
    coreProximity: coreProximity(input),
    homeAge: homeAgeFactor(
      input.yearBuilt,
      input.yearRemodeled,
      undefined,
      input.lastReroofYear,
    ),
    ownerOccupied:
      input.ownerOccupied == null ? 0.7 : input.ownerOccupied ? 1 : 0.4,
    propertyFit: input.propertyType === "single_family" ? 1 : 0.2,
    sourceConfidence: clamp(input.confidence),
  };
  const score = Object.entries(WEIGHTS).reduce(
    (sum, [key, weight]) => sum + factors[key as keyof typeof factors] * weight,
    0,
  );
  return {
    score: Math.round(score * 1000) / 1000,
    breakdown: { factors, weights: { ...WEIGHTS } },
  };
}

export function pickEventType(windMph?: number | null, hailIn?: number | null) {
  const hail = (hailIn ?? 0) >= 1;
  const wind = (windMph ?? 0) >= 58;
  if (hail && wind) return "mixed" as const;
  if (hail) return "hail" as const;
  if (wind) return "wind" as const;
  return "wind" as const;
}
