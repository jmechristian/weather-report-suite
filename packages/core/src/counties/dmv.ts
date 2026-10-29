import type { CountyFieldMap } from "../types";

export type DmvCountySeed = {
  fips: string;
  name: string;
  state: "VA" | "MD" | "DC";
  parcelServiceUrl: string;
  addressServiceUrl: string | null;
  sourceSrid: number;
  fieldMap: CountyFieldMap;
};

const fairfaxMap: CountyFieldMap = {
  parcelId: "PIN",
  parcelType: "PARCEL_TYPE",
  addressJoin: "PARCEL_PIN",
  address: "ADDRESS_1",
  city: "CITY",
  zip: "ZIP",
  state: "STATE",
  landUse: "LUC_DESC",
  yearBuilt: "YRBLT",
  yearRemodeled: "YRREMOD",
  assessorId: "PARID",
  layers: {
    assessorParcel:
      "https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services/OpenData_A6/FeatureServer/1",
    dwelling:
      "https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services/OpenData_A7/FeatureServer/2",
  },
};

const loudounMap: CountyFieldMap = {
  parcelId: "PA_MCPI",
  parcelType: "PA_TYPE",
  addressJoin: "AD_MCPI",
  address: "FULL_ADDRESS",
  city: "AM_TOWN",
  zip: "AM_ZIP",
  state: "AM_STATE",
};

const staffordMap: CountyFieldMap = {
  parcelId: "PRCLID",
  parcelIdAlt: "PARCEL_ID_NSP",
  address: "FULLADD",
  city: "CITY",
  zip: "ZIP",
  landUse: "APA",
  singleFamilyCodes: [1110],
  attachedCodes: [1120],
  condoCodes: [1130],
};

const MD_PARCELS =
  "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0";

function marylandCounty(fips: string, name: string, jurs: string): DmvCountySeed {
  return {
    fips,
    name,
    state: "MD",
    parcelServiceUrl: MD_PARCELS,
    addressServiceUrl: null,
    sourceSrid: 4326,
    fieldMap: {
      parcelId: "ACCTID",
      address: "ADDRESS",
      city: "CITY",
      zip: "ZIPCODE",
      landUse: "DESCLU",
      yearBuilt: "YEARBLT",
      parcelWhere: `JURSCODE='${jurs}' AND ACCTID <> 'ROW' AND DESCLU IN ('Residential', 'Town House')`,
    },
  };
}

/** Public parcel layers. Empty URL = TIGER boundary only until a live service is confirmed. */
const ORIGINAL_COUNTIES: DmvCountySeed[] = [
  {
    fips: "11001",
    name: "District of Columbia",
    state: "DC",
    parcelServiceUrl:
      "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land/MapServer/40",
    addressServiceUrl: null,
    sourceSrid: 4326,
    fieldMap: {
      parcelId: "SSL",
      address: "PREMISEADD",
      zip: "CITYSTZIP",
      cityFallback: "Washington",
      parcelType: "PROPTYPE",
      landUse: "USECODE",
    },
  },
  {
    fips: "24031",
    name: "Montgomery",
    state: "MD",
    parcelServiceUrl:
      "https://gis3.montgomerycountymd.gov/arcgis/rest/services/property/property_query/FeatureServer/0",
    addressServiceUrl: null,
    sourceSrid: 2248,
    fieldMap: {
      parcelId: "ACCT",
      addressParts: [
        "PREMISE_ADDR_HOUSENO",
        "PREMISE_ADDR_DIRECTION",
        "PREMISE_ADDR_STREET",
        "PREMISE_ADDR_STREET_TYPE",
      ],
      city: "PREMISE_ADDR_CITY",
      zip: "PREMISE_ADDR_ZIP",
      landUse: "LU_CATEGORY",
      yearBuilt: "YEAR_BUILT",
    },
  },
  {
    fips: "24033",
    name: "Prince George's",
    state: "MD",
    parcelServiceUrl:
      "https://gis.princegeorgescountymd.gov/arcgis/rest/services/Property/Property_Flattened/MapServer/0",
    addressServiceUrl: null,
    sourceSrid: 2248,
    fieldMap: {
      parcelId: "ACCOUNT",
      addressParts: ["HOUSE_NUMBER", "STREET_DIRECTION", "STREET_NAME", "STREET_TYPE"],
      city: "CITY",
      zip: "ZIP5",
      landUse: "DWELLING_TYPE",
      yearBuilt: "YEAR_BUILT",
    },
  },
  {
    fips: "24017",
    name: "Charles",
    state: "MD",
    parcelServiceUrl:
      "https://services7.arcgis.com/3BMWkdyrt45RNCrq/arcgis/rest/services/CharlesCounty_Parcels/FeatureServer/6",
    addressServiceUrl: null,
    sourceSrid: 2248,
    fieldMap: {
      parcelId: "ACCTID",
      address: "ADDRESS",
      city: "PREMCITY",
      zip: "PREMZIP",
      landUse: "DESCLU",
      yearBuilt: "YEARBLT",
    },
  },
  {
    fips: "24027",
    name: "Howard",
    state: "MD",
    parcelServiceUrl: "https://bou.howardcountymd.gov/server/rest/services/AccelaGIS/MapServer/1",
    addressServiceUrl: null,
    sourceSrid: 2248,
    fieldMap: {
      parcelId: "ACCTID",
      address: "ADDRESS",
      city: "PREMCITY",
      zip: "PREMZIP",
      landUse: "DESCLU",
      yearBuilt: "YEARBLT",
      yearBuiltAlt: "YRBLT_CAMA",
    },
  },
  marylandCounty("24003", "Anne Arundel", "ANNE"),
  {
    fips: "24021",
    name: "Frederick",
    state: "MD",
    parcelServiceUrl: "https://fcgis.frederickcountymd.gov/server_pub/rest/services/Basemap/Parcels/MapServer/0",
    addressServiceUrl: null,
    sourceSrid: 2248,
    fieldMap: {
      parcelId: "TAX_ACCT",
      parcelIdAlt: "PIN",
      address: "ADDRESS",
      city: "CITY",
      zip: "ZipCode",
      landUse: "TAXPARCELTYPE",
    },
  },
  {
    fips: "51013",
    name: "Arlington",
    state: "VA",
    parcelServiceUrl: "https://arlgis.arlingtonva.us/arcgis/rest/services/Public_Maps/Parcel_Map/FeatureServer/1",
    addressServiceUrl: null,
    sourceSrid: 4326,
    fieldMap: { parcelId: "RPCMSTR" },
  },
  {
    fips: "51510",
    name: "Alexandria",
    state: "VA",
    parcelServiceUrl: "https://geoportal.alexandriava.gov/server/rest/services/Real_Estate_Parcels/FeatureServer/0",
    addressServiceUrl: null,
    sourceSrid: 3857,
    fieldMap: {
      parcelId: "PID_GIS",
      parcelIdAlt: "ACCOUNTNO",
      address: "ADDRESS_GIS",
      cityFallback: "Alexandria",
      parcelType: "PARCELTYPE",
      landUse: "LANDDESC",
      condoCodes: ["3"],
    },
  },
  {
    fips: "51059",
    name: "Fairfax",
    state: "VA",
    parcelServiceUrl:
      "https://www.fairfaxcounty.gov/gispub1/rest/services/OpenData/OpenData_A9/FeatureServer/0",
    addressServiceUrl:
      "https://www.fairfaxcounty.gov/gispub2/rest/services/GIS/MasterAddressRepository/FeatureServer/0",
    sourceSrid: 2283,
    fieldMap: fairfaxMap,
  },
  {
    fips: "51600",
    name: "Fairfax City",
    state: "VA",
    parcelServiceUrl:
      "https://cofgis.fairfaxva.gov/server/rest/services/Hosted/PropertyOwners/FeatureServer/0",
    addressServiceUrl: null,
    sourceSrid: 3857,
    fieldMap: {
      parcelId: "parcelid",
      parcelIdAlt: "pin",
      addressParts: ["streetnumber", "description"],
      city: "city",
      zip: "situszip",
      landUse: "elu",
      yearBuilt: "yearbuilt",
    },
  },
  {
    fips: "51610",
    name: "Falls Church",
    state: "VA",
    parcelServiceUrl: "https://services1.arcgis.com/2hmXRAz4ofcdQP6p/arcgis/rest/services/Parcels/FeatureServer/0",
    addressServiceUrl: null,
    sourceSrid: 3857,
    fieldMap: {
      parcelId: "PIN",
      parcelIdAlt: "RPC",
      cityFallback: "Falls Church",
    },
  },
  {
    fips: "51107",
    name: "Loudoun",
    state: "VA",
    parcelServiceUrl: "https://logis.loudoun.gov/gis/rest/services/COL/LandRecords/MapServer/5",
    addressServiceUrl: "https://logis.loudoun.gov/gis/rest/services/COL/LandRecords/MapServer/2",
    sourceSrid: 2924,
    fieldMap: loudounMap,
  },
  {
    fips: "51153",
    name: "Prince William",
    state: "VA",
    parcelServiceUrl: "https://gisweb.pwcva.gov/arcgis/rest/services/OpenData/OpenData/MapServer/0",
    addressServiceUrl: null,
    sourceSrid: 2283,
    fieldMap: {
      parcelId: "GPIN",
      addressParts: ["ST_NO", "ST_NAME", "ST_TYPE"],
      city: "CITY",
      zip: "ZIP",
      landUse: "CAMA_USECODE",
    },
  },
  {
    fips: "51683",
    name: "Manassas",
    state: "VA",
    parcelServiceUrl:
      "https://gis.manassasva.gov/server2/rest/services/Web_ParcelUnit_Standard/Web_Parcel_Standard/MapServer/1",
    addressServiceUrl: null,
    sourceSrid: 2283,
    fieldMap: {
      parcelId: "GPIN_NUM",
      parcelIdAlt: "TAXMAP_NUM",
      address: "FULL_ADDRESS",
      cityFallback: "Manassas",
      landUse: "USE_CODE",
    },
  },
  {
    fips: "51685",
    name: "Manassas Park",
    state: "VA",
    parcelServiceUrl:
      "https://services7.arcgis.com/ma9pWVMuT9vmGH9G/arcgis/rest/services/Parcels_2021TaxAssessment/FeatureServer/0",
    addressServiceUrl: null,
    sourceSrid: 3857,
    fieldMap: {
      parcelId: "Parcel_ID",
      parcelIdAlt: "PARCEL_ID_1",
      address: "PROPERTY_LOCATION",
      city: "CITY",
      cityFallback: "Manassas Park",
      zip: "ZIP_CODE",
      landUse: "STATE_CLASS",
    },
  },
  {
    fips: "51179",
    name: "Stafford",
    state: "VA",
    parcelServiceUrl:
      "https://services1.arcgis.com/qKiA6JuCrE2l72iL/arcgis/rest/services/Parcels/FeatureServer/0",
    addressServiceUrl:
      "https://services1.arcgis.com/qKiA6JuCrE2l72iL/arcgis/rest/services/Address_Points/FeatureServer/0",
    sourceSrid: 2924,
    fieldMap: staffordMap,
  },
  {
    fips: "51061",
    name: "Fauquier",
    state: "VA",
    parcelServiceUrl:
      "https://agol.gis.fauquiercounty.gov/arcgis/rest/services/Authoritative/Fauquier_County_Parcels/FeatureServer/32",
    addressServiceUrl: null,
    sourceSrid: 2283,
    fieldMap: {
      parcelId: "PARCELID",
      parcelIdAlt: "VisionPID",
      address: "SITEADDRESS",
      landUse: "Primary_Use_DESC",
      yearBuilt: "Year_Built",
    },
  },
];

const VA_STATE_PARCELS =
  "https://services.dwr.virginia.gov/arcgis/rest/services/Projects/VA_Parcels/FeatureServer/0";

/** Counties added beyond the original Washington footprint. */
export const EXPANDED_COUNTIES: DmvCountySeed[] = [
  marylandCounty("24013", "Carroll", "CARR"),
  marylandCounty("24005", "Baltimore County", "BACO"),
  marylandCounty("24510", "Baltimore City", "BACI"),
  marylandCounty("24025", "Harford", "HARF"),
  {
    fips: "51177",
    name: "Spotsylvania",
    state: "VA",
    parcelServiceUrl:
      "https://gis.spotsylvania.va.us/arcgis/rest/services/GeoHub/GeoHub/FeatureServer/45",
    addressServiceUrl: null,
    sourceSrid: 4326,
    fieldMap: {
      parcelId: "GPIN",
      parcelIdAlt: "MAP_Pin",
      address: "PROPADDRESS",
      city: "PROPCITY",
      yearBuilt: "YEARBUILT",
    },
  },
  {
    fips: "51630",
    name: "Fredericksburg",
    state: "VA",
    parcelServiceUrl: "https://maps.fredericksburgva.gov/arcgis/rest/services/Tax_Parcels/MapServer/0",
    addressServiceUrl: null,
    sourceSrid: 4326,
    fieldMap: {
      parcelId: "PARID",
      parcelIdAlt: "GPIN",
      address: "PropertyAddress",
      landUse: "GICLASS",
      cityFallback: "Fredericksburg",
    },
  },
  {
    fips: "51033",
    name: "Caroline",
    state: "VA",
    parcelServiceUrl: VA_STATE_PARCELS,
    addressServiceUrl: null,
    sourceSrid: 4326,
    fieldMap: {
      parcelId: "PARCELID",
      parcelIdAlt: "PIN",
      parcelWhere: "FIPS='51033'",
    },
  },
  {
    fips: "51085",
    name: "Hanover",
    state: "VA",
    parcelServiceUrl:
      "https://services2.arcgis.com/sKZWgJlU6SekCzQV/arcgis/rest/services/Hanover_Parcels/FeatureServer/0",
    addressServiceUrl: null,
    sourceSrid: 4326,
    fieldMap: {
      parcelId: "GPIN",
      addressParts: ["ADDRESS", "ST_PREFIX", "ST_NAME", "ST_TYPE", "ST_SUFFIX"],
      city: "CITY",
      zip: "ZIP",
    },
  },
  {
    fips: "51087",
    name: "Henrico",
    state: "VA",
    parcelServiceUrl:
      "https://portal.henrico.gov/mapping/rest/services/GISViewerExternal/RealEstate/MapServer/0",
    addressServiceUrl: null,
    sourceSrid: 4326,
    fieldMap: {
      parcelId: "GPIN",
      parcelIdAlt: "PID",
      address: "FULL_ADDRESS",
      city: "CITY",
      zip: "ZIP_CODE",
      landUse: "USE_DESCRIPTION",
    },
  },
  {
    fips: "51760",
    name: "Richmond",
    state: "VA",
    parcelServiceUrl: "https://services1.arcgis.com/k3vhq11XkBNeeOfM/arcgis/rest/services/Parcels/FeatureServer/0",
    addressServiceUrl: null,
    sourceSrid: 4326,
    fieldMap: {
      parcelId: "PIN",
      parcelIdAlt: "ParcelID",
      landUse: "LandUse",
      parcelType: "PropertyClass",
      cityFallback: "Richmond",
      spatialAddress: {
        url: "https://services1.arcgis.com/k3vhq11XkBNeeOfM/arcgis/rest/services/Addresses/FeatureServer/0",
        label: "AddressLabel",
        zip: "ZipCode",
        latitude: "Latitude",
        longitude: "Longitude",
      },
    },
  },
];

export const DMV_COUNTIES: DmvCountySeed[] = [...ORIGINAL_COUNTIES, ...EXPANDED_COUNTIES];

export function dmvCounty(fips: string | null | undefined): DmvCountySeed | undefined {
  if (!fips) return undefined;
  return DMV_COUNTIES.find((county) => county.fips === fips);
}
