import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const multiPolygon4326 = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(MultiPolygon,4326)";
  },
});

const point4326 = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(Point,4326)";
  },
});

export const counties = pgTable("counties", {
  fips: text("fips").primaryKey(),
  name: text("name").notNull(),
  state: text("state").notNull(),
  parcelServiceUrl: text("parcel_service_url").notNull(),
  addressServiceUrl: text("address_service_url"),
  sourceSrid: integer("source_srid").notNull(),
  fieldMap: jsonb("field_map").notNull(),
  geom: multiPolygon4326("geom"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

export const parcels = pgTable(
  "parcels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countyFips: text("county_fips")
      .notNull()
      .references(() => counties.fips),
    countyParcelId: text("county_parcel_id").notNull(),
    geom: multiPolygon4326("geom").notNull(),
    centroid: point4326("centroid"),
    situsAddress: text("situs_address"),
    situsCity: text("situs_city"),
    situsZip: text("situs_zip"),
    situsState: text("situs_state").notNull().default("VA"),
    ownerName: text("owner_name"),
    mailingAddress: text("mailing_address"),
    ownerAge: integer("owner_age"),
    ownerDob: text("owner_dob"),
    ownerIsPropertyOwner: boolean("owner_is_property_owner"),
    ownerDeceased: boolean("owner_deceased"),
    ownerLitigator: boolean("owner_litigator"),
    ownerEmails: text("owner_emails").array(),
    propertyType: text("property_type"),
    yearBuilt: integer("year_built"),
    yearRemodeled: integer("year_remodeled"),
    lastReroofYear: integer("last_reroof_year"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    lastTracedAt: timestamp("last_traced_at", { withTimezone: true }),
    hotLead: boolean("hot_lead").notNull().default(false),
    hotLeadSource: text("hot_lead_source"),
    hotLeadAt: timestamp("hot_lead_at", { withTimezone: true }),
    hotHold: boolean("hot_hold").notNull().default(false),
    raw: jsonb("raw"),
  },
  (t) => [
    unique("parcels_county_parcel_uid").on(t.countyFips, t.countyParcelId),
    index("parcels_geom_idx").using("gist", t.geom),
    index("parcels_centroid_idx").using("gist", t.centroid),
    index("parcels_type_idx").on(t.propertyType),
  ],
);

export const stormEvents = pgTable(
  "storm_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalId: text("external_id"),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    geom: multiPolygon4326("geom").notNull(),
    severity: numeric("severity"),
    severityUnit: text("severity_unit"),
    windMph: numeric("wind_mph"),
    hailIn: numeric("hail_in"),
    source: text("source").notNull(),
    confidence: numeric("confidence"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    unique("storm_events_source_external_uid").on(t.source, t.externalId),
    index("storm_geom_idx").using("gist", t.geom),
    index("storm_time_idx").on(t.occurredAt),
  ],
);

export const stormReports = pgTable(
  "storm_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stormEventId: uuid("storm_event_id").references(() => stormEvents.id, {
      onDelete: "set null",
    }),
    externalId: text("external_id"),
    reportType: text("report_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    geom: point4326("geom").notNull(),
    magnitude: numeric("magnitude"),
    magnitudeUnit: text("magnitude_unit"),
    source: text("source").notNull().default("iem_lsr"),
    raw: jsonb("raw"),
  },
  (t) => [
    unique("storm_reports_source_external_uid").on(t.source, t.externalId),
    index("storm_reports_geom_idx").using("gist", t.geom),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stormEventId: uuid("storm_event_id")
      .notNull()
      .references(() => stormEvents.id, { onDelete: "cascade" }),
    parcelId: uuid("parcel_id")
      .notNull()
      .references(() => parcels.id, { onDelete: "cascade" }),
    score: numeric("score").notNull(),
    scoreBreakdown: jsonb("score_breakdown").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    unique("leads_storm_parcel_uid").on(t.stormEventId, t.parcelId),
    index("leads_score_idx").on(t.stormEventId, t.score),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parcelId: uuid("parcel_id")
      .notNull()
      .references(() => parcels.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    lineType: text("line_type"),
    carrier: text("carrier"),
    dnc: boolean("dnc"),
    tcpa: boolean("tcpa"),
    confidence: numeric("confidence"),
    rank: integer("rank").notNull().default(1),
    provider: text("provider").notNull(),
    tracedAt: timestamp("traced_at", { withTimezone: true }).notNull(),
    raw: jsonb("raw"),
  },
  (t) => [unique("contacts_parcel_number_uid").on(t.parcelId, t.number)],
);

export const phoneSuppressions = pgTable("phone_suppressions", {
  phone: text("phone").primaryKey(),
  reason: text("reason").notNull().default("stop"),
  sourceParcelId: uuid("source_parcel_id").references(() => parcels.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  raw: jsonb("raw"),
});

export const phoneConsents = pgTable("phone_consents", {
  phone: text("phone").primaryKey(),
  source: text("source").notNull().default("staff"),
  parcelId: uuid("parcel_id").references(() => parcels.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messageTemplates = pgTable("message_templates", {
  key: text("key").primaryKey(),
  body: text("body").notNull(),
  keywords: text("keywords").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const smsCampaigns = pgTable("sms_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateKey: text("template_key").notNull(),
  bodySnapshot: text("body_snapshot").notNull(),
  status: text("status").notNull().default("running"),
  includeAlreadySent: boolean("include_already_sent").notNull().default(false),
  requested: integer("requested").notNull().default(0),
  sent: integer("sent").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
});

export const outreachEvents = pgTable(
  "outreach_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parcelId: uuid("parcel_id").references(() => parcels.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => smsCampaigns.id, { onDelete: "set null" }),
    phone: text("phone").notNull(),
    channel: text("channel").notNull().default("sms"),
    direction: text("direction").notNull(),
    status: text("status"),
    body: text("body"),
    isTest: boolean("is_test").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    providerId: text("provider_id"),
    raw: jsonb("raw"),
  },
  (t) => [
    index("outreach_events_phone_idx").on(t.phone),
    index("outreach_events_parcel_idx").on(t.parcelId, t.occurredAt),
  ],
);

export const traceJobs = pgTable("trace_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  providerJobId: text("provider_job_id"),
  status: text("status").notNull().default("queued"),
  stormEventId: uuid("storm_event_id").references(() => stormEvents.id),
  parcelIds: uuid("parcel_ids").array().notNull(),
  credits: integer("credits").notNull().default(0),
  usd: numeric("usd", { precision: 10, scale: 2 }).notNull().default("0"),
  requested: integer("requested").notNull().default(0),
  hits: integer("hits").notNull().default(0),
  misses: integer("misses").notNull().default(0),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
});

export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
});

export const scoreJobs = pgTable("score_jobs", {
  stormEventId: uuid("storm_event_id")
    .primaryKey()
    .references(() => stormEvents.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"),
  phase: text("phase").notNull().default("starting"),
  total: integer("total").notNull().default(0),
  scored: integer("scored").notNull().default(0),
  message: text("message"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  error: text("error"),
});
