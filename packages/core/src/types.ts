export const PROPERTY_TYPES = [
  "single_family",
  "attached",
  "condo",
  "commercial",
  "other",
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const EVENT_TYPES = ["wind", "hail", "tornado", "mixed"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type BBox = [west: number, south: number, east: number, north: number];

export type CountyFieldMap = {
  parcelId: string;
  parcelIdAlt?: string;
  parcelType?: string;
  address?: string;
  addressParts?: string[];
  city?: string;
  cityFallback?: string;
  zip?: string;
  state?: string;
  landUse?: string;
  yearBuilt?: string;
  yearBuiltAlt?: string;
  yearRemodeled?: string;
  addressJoin?: string;
  parcelAddressJoin?: string;
  assessorId?: string;
  layers?: {
    addresses?: string;
    assessorParcel?: string;
    dwelling?: string;
  };
  singleFamilyCodes?: Array<string | number>;
  attachedCodes?: Array<string | number>;
  condoCodes?: Array<string | number>;
};

export type StormEventInput = {
  externalId: string;
  eventType: EventType;
  occurredAt: Date;
  expiresAt?: Date | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  windMph?: number | null;
  hailIn?: number | null;
  source: "nws_warning" | "iem_sbw";
  confidence: number;
  raw: unknown;
};

export type StormReportInput = {
  externalId: string;
  reportType: "hail" | "wind" | "wind_damage" | "tornado" | "other";
  occurredAt: Date;
  longitude: number;
  latitude: number;
  magnitude?: number | null;
  magnitudeUnit?: string | null;
  source: "iem_lsr";
  raw: unknown;
};

export type ScoringInput = {
  eventType: EventType;
  windMph?: number | null;
  hailIn?: number | null;
  parcelCentroid: [lon: number, lat: number];
  stormCentroid: [lon: number, lat: number];
  stormRadiusKm: number;
  lsrPoints?: Array<[lon: number, lat: number]>;
  yearBuilt?: number | null;
  yearRemodeled?: number | null;
  lastReroofYear?: number | null;
  ownerOccupied?: boolean | null;
  propertyType: PropertyType | string;
  confidence: number;
};

export type ScoreBreakdown = {
  factors: Record<string, number>;
  weights: Record<string, number>;
};

export type ScoredLead = {
  score: number;
  breakdown: ScoreBreakdown;
};

export type TraceInput = {
  address: string;
  city: string;
  state: string;
  zip: string;
  countyFips?: string;
  countyName?: string;
  parcelId?: string;
  parcelIdAlt?: string;
  pageNum?: string;
  captLot?: string;
  insNum?: string;
  sectNum?: string;
};

export type TracedPhone = {
  number: string;
  lineType?: string | null;
  carrier?: string | null;
  dnc?: boolean | null;
  tcpa?: boolean | null;
  rank: number;
};

export type TracedMailing = {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type TraceResult = {
  hit: boolean;
  ownerName?: string | null;
  ownerAge?: number | null;
  ownerDob?: string | null;
  propertyOwner?: boolean | null;
  deceased?: boolean | null;
  litigator?: boolean | null;
  mailingAddress?: TracedMailing | null;
  mailingAddressText?: string | null;
  emails: string[];
  phones: TracedPhone[];
  raw: unknown;
  creditsDeducted?: number;
};

export interface StormEventProvider {
  name: string;
  getEvents(bbox: BBox, from: Date, to: Date): Promise<StormEventInput[]>;
}

export interface SkipTraceProvider {
  name: string;
  trace(input: TraceInput): Promise<TraceResult | null>;
  traceBatch(
    inputs: TraceInput[],
    webhookUrl?: string,
  ): Promise<{ jobId: string }>;
}
