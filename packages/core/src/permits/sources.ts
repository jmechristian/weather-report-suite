export type PermitSource = {
  fips: string;
  name: string;
  kind: "arcgis" | "soda";
  url: string;
  layers?: number[];
  textFields: string[];
  dateField: string;
  parcelIdField?: string;
  addressField?: string;
  addressParts?: string[];
  sodaLimit?: number;
};

const DC_DCRA = "https://maps2.dcgis.dc.gov/dcgis/rest/services/FEEDS/DCRA/FeatureServer";

/** Yearly DC layers covering the last ~15 years of reroof permits. */
const DC_LAYERS = [18, 17, 16, 15, 14, 3, 2, 8, 9, 37, 24, 25, 5, 6, 7, 10];

export const PERMIT_SOURCES: PermitSource[] = [
  {
    fips: "51059",
    name: "Fairfax",
    kind: "arcgis",
    url: "https://services1.arcgis.com/ioennV6PpG5Xodq0/arcgis/rest/services/Building_Records_PLUS/FeatureServer/0",
    textFields: ["APPTYPEALIAS", "PROJECT_NAME"],
    dateField: "ISSUED_DATE",
    parcelIdField: "PARCEL_ID",
    addressField: "ADDRESS_1",
  },
  {
    fips: "24033",
    name: "Prince George's",
    kind: "arcgis",
    url: "https://gisdata.pgplanning.org/arcgis/rest/services/Applications/Momentum_DPIE/MapServer/0",
    textFields: ["PERMIT_WORKTYPE_DESCRIPT", "SCOPE", "SCOPEDESCRIPTION"],
    dateField: "ISSUANCE_DATE",
    parcelIdField: "TAXNUMBER",
    addressField: "ADDRESS",
  },
  {
    fips: "11001",
    name: "District of Columbia",
    kind: "arcgis",
    url: DC_DCRA,
    layers: DC_LAYERS,
    textFields: ["DESC_OF_WORK", "PERMIT_SUBTYPE_NAME", "PERMIT_TYPE_NAME"],
    dateField: "ISSUE_DATE",
    parcelIdField: "SSL",
    addressField: "FULL_ADDRESS",
  },
  {
    fips: "24031",
    name: "Montgomery",
    kind: "soda",
    url: "https://data.montgomerycountymd.gov/resource/m88u-pqki.json",
    textFields: ["description", "worktype", "applicationtype"],
    dateField: "issueddate",
    addressParts: ["stno", "stname", "suffix"],
    sodaLimit: 500,
  },
];

export function permitSourcesForFips(fips: string[]): PermitSource[] {
  const want = new Set(fips);
  return PERMIT_SOURCES.filter((s) => want.has(s.fips));
}