/** USPS mailing city for Stafford County ZIPs. 22405/22406 mail as Fredericksburg. */
export const STAFFORD_ZIP_POSTAL_CITY: Record<string, string> = {
  "22172": "Triangle",
  "22405": "Fredericksburg",
  "22406": "Fredericksburg",
  "22554": "Stafford",
  "22555": "Stafford",
  "22556": "Stafford",
};

export function fiveDigitZip(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "").slice(0, 5);
}

function titleCaseCity(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/** City Tracerfy should receive. ZIP wins over GIS when they disagree. */
export function postalCityForTrace(zip: string, gisCity?: string | null): string {
  const mapped = STAFFORD_ZIP_POSTAL_CITY[fiveDigitZip(zip)];
  if (mapped) return mapped;
  const city = (gisCity ?? "").trim();
  if (!city || /^\d/.test(city)) return mapped ?? "";
  return titleCaseCity(city);
}
