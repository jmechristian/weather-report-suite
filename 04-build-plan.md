# Storm Lead Platform — PoC Build Plan

**Target:** private Next.js app for one remodeler. **Demo AOI is Stafford County only** (`51179`). Wind + hail events from the last 12 hours through 12 months. Highest-impact single-family parcels with owner name, address, and phone via Tracerfy.

Fairfax and Loudoun GIS configs stay in the repo for later; they are not seeded or clipped in this demo.

**Out of this phase:** DNC/TCPA product work, multi-tenant SaaS, call logging, BatchData, MRMS/GRIB2, Prince William, independent cities (Fairfax City, Falls Church, Alexandria, Arlington, Fredericksburg).

---

## Success

Pick a storm on the map, generate ranked leads, skip-trace the top N, export CSV: name, address, phones. That is the PoC.

---

## Accounts

| Service | Status | Notes |
|---|---|---|
| Supabase | Ready, PostGIS enabled | Use service-role on the server only. `DATABASE_URL` = transaction pooler (`:6543`). `DIRECT_URL` = session pooler (`:5432`) for migrate/ingest. |
| MapTiler | Have key | `NEXT_PUBLIC_MAPTILER_KEY` |
| Tracerfy | Have key | Bearer token. 5 credits per sync lookup hit. |
| Weather | No paid key | NWS + IEM are free. NWS needs `NWS_USER_AGENT` like `storm-leads (you@company.com)`. |

---

## Data sources

**Weather (WFO LWX, no API key)**

- Historical + polling: IEM SBW `https://mesonet.agron.iastate.edu/geojson/sbw.geojson?sts=&ets=&wfo=LWX`
- Ground truth: IEM LSR GeoJSON (hail, thunderstorm wind, wind damage)
- Live optional: `https://api.weather.gov/alerts?area=VA` with User-Agent (last ~7 days only)

Keep SV.W and TO.W. Use `max_windtag` / `max_hailtag`. Buffer LSRs ~400 m. Clip to county AOI.

**Parcels — owner names are not on VA public GIS. Addresses + geometry from counties. Name + phone from Tracerfy.**

Fairfax `51059`

- Polygons: `https://www.fairfaxcounty.gov/gispub1/rest/services/OpenData/OpenData_A9/FeatureServer/0` (`PIN`, `PARCEL_TYPE`)
- Addresses: MAR, join `PARCEL_PIN` → `PIN`
- Assessor: DTA parcel `LUC_DESC`; dwelling `YRBLT` / `YRREMOD`. Normalize PIN (spaces).
- Skip `PARCEL_TYPE=CONDO`

Loudoun `51107`

- Parcels: `https://logis.loudoun.gov/gis/rest/services/COL/LandRecords/MapServer/5` (`PA_MCPI`, `PA_TYPE`)
- Addresses: Land Records address points, join `AD_MCPI` → `PA_MCPI`
- Confirm `?f=json` at ingest time. Do not use `/Test/` services.

Stafford `51179` (~62k, simplest)

- One layer: `https://services1.arcgis.com/qKiA6JuCrE2l72iL/arcgis/rest/services/Parcels/FeatureServer/0`
- `PRCLID`, `FULLADD`, `CITY`, `ZIP`, `APA` (`1110` = Single Family Detached, `1120` = townhomes, `1130` = multifamily)
- Native SRID 2924; request `outSR=4326`
- Address-point fallback if `FULLADD` empty

Always request `outSR=4326`. Fail if coords are not around `-77.x, 38.x`. Store everything EPSG:4326. `ST_Transform` in a query is a bug.

County field names live in `counties.field_map`, not in scorers.

---

## Schema (slim)

`counties`, `parcels`, `storm_events`, `storm_reports`, `leads`, `contacts`, `trace_jobs`

Dropped vs original brainstorm: tenants, assignments, suppressions, call_records, DNC views.

Parcels: MultiPolygon 4326, centroid via `ST_PointOnSurface`, situs parts, `property_type`, `year_built`, `owner_name` nullable until traced. Unique `(county_fips, county_parcel_id)`.

Contacts: E.164, rank, provider `tracerfy`, raw JSON. Unique `(parcel_id, number)`. Store Tracerfy `dnc` flags; do not filter the UI.

---

## Scoring (`packages/core`, no React, no DB)

Weights: severity 0.30, core proximity 0.20, roof age 0.20, owner-occupied 0.15, property fit 0.10, source confidence 0.05.

- Severity: wind 58–80+ mph and hail 1.0–2.5+ in, take the stronger of the two.
- Core proximity: nearest LSR if present, else distance to warning centroid.
- Roof age from `year_built` / `year_remodeled`; 0.5 if missing.
- Property fit: single_family = 1, else 0.2. Default lead query is single_family.
- Confidence: warning-only low; warning + LSR higher.

Always persist `score_breakdown`.

Lead gen: `ST_Intersects` insert, then score in app code. Trace **top N** only (default 25, hard cap 250). Never skip-trace a whole swath.

---

## Tracerfy

- Sync smoke: `POST https://tracerfy.com/v1/api/trace/lookup/` `{ address, city, state, zip }`
- Volume: batch `POST /v1/api/trace/`
- Cache 90 days per parcel
- Do not use Property Snapshot (10 credits) for every lead

---

## App

pnpm workspace:

```
apps/web          Next.js App Router, MapLibre, Tailwind
packages/core     ingest, scoring, Tracerfy, types — ZERO React
packages/db       drizzle schema + migrations
```

Auth: Supabase Auth, allowlisted emails. Service role never in the browser.

Map: storm polygon + scored **leads only** (not the whole county). Table synced to map. CSV export.

---

## Env

```
DATABASE_URL=
DIRECT_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_MAPTILER_KEY=
TRACERFY_API_KEY=
TRACERFY_WEBHOOK_SECRET=
NWS_USER_AGENT=
CRON_SECRET=
ALLOWED_EMAILS=
```

Typed env in `packages/core`. No `process.env` elsewhere.

---

## Constraints

- Hit live `?f=json` before coding against a GIS URL.
- Log provider payloads on `raw` jsonb during PoC.
- `packages/core` stays React-free.
- Independent cities are a coverage hole — say so in the UI, do not invent parcels.
