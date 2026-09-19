export const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS counties (
  fips text PRIMARY KEY,
  name text NOT NULL,
  state text NOT NULL,
  parcel_service_url text NOT NULL,
  address_service_url text,
  source_srid int NOT NULL,
  field_map jsonb NOT NULL,
  geom geometry(MultiPolygon, 4326),
  last_synced_at timestamptz
);

CREATE TABLE IF NOT EXISTS parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  county_fips text NOT NULL REFERENCES counties(fips),
  county_parcel_id text NOT NULL,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  centroid geometry(Point, 4326),
  situs_address text,
  situs_city text,
  situs_zip text,
  situs_state text NOT NULL DEFAULT 'VA',
  owner_name text,
  property_type text,
  year_built int,
  year_remodeled int,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  last_traced_at timestamptz,
  raw jsonb,
  UNIQUE (county_fips, county_parcel_id)
);
CREATE INDEX IF NOT EXISTS parcels_geom_idx ON parcels USING GIST (geom);
CREATE INDEX IF NOT EXISTS parcels_centroid_idx ON parcels USING GIST (centroid);
CREATE INDEX IF NOT EXISTS parcels_type_idx ON parcels (property_type);

CREATE TABLE IF NOT EXISTS storm_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  expires_at timestamptz,
  geom geometry(MultiPolygon, 4326) NOT NULL,
  severity numeric,
  severity_unit text,
  wind_mph numeric,
  hail_in numeric,
  source text NOT NULL,
  confidence numeric,
  raw jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS storm_geom_idx ON storm_events USING GIST (geom);
CREATE INDEX IF NOT EXISTS storm_time_idx ON storm_events (occurred_at DESC);

CREATE TABLE IF NOT EXISTS storm_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storm_event_id uuid REFERENCES storm_events(id) ON DELETE SET NULL,
  external_id text,
  report_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  geom geometry(Point, 4326) NOT NULL,
  magnitude numeric,
  magnitude_unit text,
  source text NOT NULL DEFAULT 'iem_lsr',
  raw jsonb,
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS storm_reports_geom_idx ON storm_reports USING GIST (geom);

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storm_event_id uuid NOT NULL REFERENCES storm_events(id) ON DELETE CASCADE,
  parcel_id uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  score numeric NOT NULL,
  score_breakdown jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (storm_event_id, parcel_id)
);
CREATE INDEX IF NOT EXISTS leads_score_idx ON leads (storm_event_id, score DESC);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  number text NOT NULL,
  line_type text,
  carrier text,
  dnc boolean,
  confidence numeric,
  rank int NOT NULL DEFAULT 1,
  provider text NOT NULL,
  traced_at timestamptz NOT NULL,
  raw jsonb,
  UNIQUE (parcel_id, number)
);
CREATE INDEX IF NOT EXISTS contacts_lookup_idx ON contacts (parcel_id);

CREATE TABLE IF NOT EXISTS trace_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_job_id text,
  status text NOT NULL DEFAULT 'queued',
  storm_event_id uuid REFERENCES storm_events(id),
  parcel_ids uuid[] NOT NULL,
  credits int NOT NULL DEFAULT 0,
  usd numeric(10, 2) NOT NULL DEFAULT 0,
  requested int NOT NULL DEFAULT 0,
  hits int NOT NULL DEFAULT 0,
  misses int NOT NULL DEFAULT 0,
  submitted_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  error text
);

CREATE TABLE IF NOT EXISTS score_jobs (
  storm_event_id uuid PRIMARY KEY REFERENCES storm_events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  phase text NOT NULL DEFAULT 'starting',
  total int NOT NULL DEFAULT 0,
  scored int NOT NULL DEFAULT 0,
  message text,
  started_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  error text
);

ALTER TABLE counties ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE storm_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trace_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_jobs ENABLE ROW LEVEL SECURITY;

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS last_traced_at timestamptz;
ALTER TABLE trace_jobs ADD COLUMN IF NOT EXISTS credits int NOT NULL DEFAULT 0;
ALTER TABLE trace_jobs ADD COLUMN IF NOT EXISTS usd numeric(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE trace_jobs ADD COLUMN IF NOT EXISTS requested int NOT NULL DEFAULT 0;
ALTER TABLE trace_jobs ADD COLUMN IF NOT EXISTS hits int NOT NULL DEFAULT 0;
ALTER TABLE trace_jobs ADD COLUMN IF NOT EXISTS misses int NOT NULL DEFAULT 0;
`;
