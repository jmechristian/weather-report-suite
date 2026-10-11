import type { Sql } from "../client";

export type TracedListQuery = {
  countyFips?: string;
  q?: string;
  smsEligible?: boolean;
  neverContacted?: boolean;
  limit: number;
  offset: number;
};

export type TracedParcelRow = {
  id: string;
  situs_address: string | null;
  situs_city: string | null;
  situs_zip: string | null;
  situs_state: string | null;
  county_fips: string;
  county_name: string;
  owner_name: string | null;
  owner_age: number | null;
  owner_dob: string | null;
  owner_is_property_owner: boolean | null;
  owner_deceased: boolean | null;
  owner_litigator: boolean | null;
  mailing_address: string | null;
  owner_emails: string[] | null;
  year_built: number | null;
  last_reroof_year: number | null;
  last_traced_at: string | Date | null;
  phone_count: number;
  dnc_count: number;
  tcpa_count: number;
  stopped_count: number;
  best_mobile: string | null;
  sms_eligible: boolean;
  hot_lead: boolean;
  opted_in_count: number;
  last_reached_at: string | Date | null;
  storm_count: number;
  last_storm_at: string | Date | null;
};

function whereTraced(client: Sql, query: TracedListQuery) {
  const county = query.countyFips || null;
  const q = query.q?.trim() || null;
  const like = q ? `%${q}%` : null;
  const digits = q ? q.replace(/\D/g, "") : "";
  const digitLike = digits.length >= 7 ? `%${digits}%` : null;

  return client`
    (
      p.owner_name IS NOT NULL
      OR EXISTS (SELECT 1 FROM contacts x WHERE x.parcel_id = p.id)
    )
    ${county ? client`AND p.county_fips = ${county}` : client``}
    ${
      q
        ? client`AND (
            coalesce(p.owner_name, '') ILIKE ${like}
            OR coalesce(p.situs_address, '') ILIKE ${like}
            OR coalesce(p.mailing_address, '') ILIKE ${like}
            ${
              digitLike
                ? client`OR EXISTS (
                    SELECT 1 FROM contacts n
                    WHERE n.parcel_id = p.id AND n.number LIKE ${digitLike}
                  )`
                : client``
            }
          )`
        : client``
    }
    ${
      query.smsEligible
        ? client`AND coalesce(p.owner_deceased, false) = false
          AND coalesce(p.owner_litigator, false) = false
          AND EXISTS (
            SELECT 1 FROM contacts c
            LEFT JOIN phone_suppressions s ON s.phone = c.number
            WHERE c.parcel_id = p.id
              AND lower(c.line_type) = 'mobile'
              AND c.dnc IS FALSE
              AND c.tcpa IS FALSE
              AND s.phone IS NULL
          )`
        : client``
    }
    ${
      query.neverContacted
        ? client`AND NOT EXISTS (
            SELECT 1 FROM outreach_events o
            WHERE o.parcel_id = p.id AND o.direction = 'out'
          )`
        : client``
    }
  `;
}

export function parseTracedQuery(sp: URLSearchParams): TracedListQuery {
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(sp.get("offset") ?? 0) || 0, 0);
  const countyFips = sp.get("county")?.trim() || undefined;
  const q = sp.get("q")?.trim() || undefined;
  return {
    countyFips,
    q,
    smsEligible: sp.get("sms") === "1",
    neverContacted: sp.get("never") === "1",
    limit,
    offset,
  };
}

export async function listTracedParcels(client: Sql, query: TracedListQuery) {
  const where = whereTraced(client, query);
  const [countRow] = await client<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM parcels p
    WHERE ${where}
  `;
  const rows = await client<TracedParcelRow[]>`
    SELECT
      p.id,
      p.situs_address,
      p.situs_city,
      p.situs_zip,
      p.situs_state,
      p.county_fips,
      co.name AS county_name,
      p.owner_name,
      p.owner_age,
      p.owner_dob,
      p.owner_is_property_owner,
      p.owner_deceased,
      p.owner_litigator,
      p.mailing_address,
      p.owner_emails,
      p.year_built,
      p.last_reroof_year,
      p.last_traced_at,
      coalesce(ps.phone_count, 0)::int AS phone_count,
      coalesce(ps.dnc_count, 0)::int AS dnc_count,
      coalesce(ps.tcpa_count, 0)::int AS tcpa_count,
      coalesce(ps.stopped_count, 0)::int AS stopped_count,
      ps.best_mobile,
      (
        coalesce(p.owner_deceased, false) = false
        AND coalesce(p.owner_litigator, false) = false
        AND coalesce(ps.has_eligible_mobile, false)
      ) AS sms_eligible,
      p.hot_lead,
      coalesce(ps.opted_in_count, 0)::int AS opted_in_count,
      (
        SELECT max(o.occurred_at) FROM outreach_events o WHERE o.parcel_id = p.id
      ) AS last_reached_at,
      (
        SELECT count(*)::int FROM leads l WHERE l.parcel_id = p.id
      ) AS storm_count,
      (
        SELECT max(se.occurred_at)
        FROM leads l
        JOIN storm_events se ON se.id = l.storm_event_id
        WHERE l.parcel_id = p.id
      ) AS last_storm_at
    FROM parcels p
    JOIN counties co ON co.fips = p.county_fips
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS phone_count,
        count(*) FILTER (WHERE c.dnc IS TRUE)::int AS dnc_count,
        count(*) FILTER (WHERE c.tcpa IS TRUE)::int AS tcpa_count,
        count(*) FILTER (WHERE s.phone IS NOT NULL)::int AS stopped_count,
        bool_or(
          lower(c.line_type) = 'mobile'
          AND c.dnc IS FALSE
          AND c.tcpa IS FALSE
          AND s.phone IS NULL
        ) AS has_eligible_mobile,
        (array_agg(c.number ORDER BY c.rank) FILTER (
          WHERE lower(c.line_type) = 'mobile'
            AND c.dnc IS FALSE
            AND c.tcpa IS FALSE
            AND s.phone IS NULL
        ))[1] AS best_mobile,
        count(*) FILTER (
          WHERE cons.phone IS NOT NULL
            AND lower(c.line_type) = 'mobile'
            AND c.dnc IS FALSE
            AND c.tcpa IS FALSE
            AND s.phone IS NULL
        )::int AS opted_in_count
      FROM contacts c
      LEFT JOIN phone_suppressions s ON s.phone = c.number
      LEFT JOIN phone_consents cons ON cons.phone = c.number
      WHERE c.parcel_id = p.id
    ) ps ON true
    WHERE ${where}
    ORDER BY p.last_traced_at DESC NULLS LAST, p.owner_name ASC NULLS LAST
    LIMIT ${query.limit}
    OFFSET ${query.offset}
  `;
  const counties = await client<{ fips: string; name: string }[]>`
    SELECT DISTINCT c.fips, c.name
    FROM parcels p
    JOIN counties c ON c.fips = p.county_fips
    WHERE p.owner_name IS NOT NULL
      OR EXISTS (SELECT 1 FROM contacts x WHERE x.parcel_id = p.id)
    ORDER BY c.name
  `;
  return {
    parcels: rows,
    total: countRow?.n ?? 0,
    counties,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getTracedParcel(client: Sql, parcelId: string) {
  const [parcel] = await client<
    (TracedParcelRow & { year_remodeled: number | null; property_type: string | null })[]
  >`
    SELECT
      p.id,
      p.situs_address,
      p.situs_city,
      p.situs_zip,
      p.situs_state,
      p.county_fips,
      co.name AS county_name,
      p.owner_name,
      p.owner_age,
      p.owner_dob,
      p.owner_is_property_owner,
      p.owner_deceased,
      p.owner_litigator,
      p.mailing_address,
      p.owner_emails,
      p.year_built,
      p.year_remodeled,
      p.last_reroof_year,
      p.property_type,
      p.last_traced_at,
      coalesce(ps.phone_count, 0)::int AS phone_count,
      coalesce(ps.dnc_count, 0)::int AS dnc_count,
      coalesce(ps.tcpa_count, 0)::int AS tcpa_count,
      coalesce(ps.stopped_count, 0)::int AS stopped_count,
      ps.best_mobile,
      (
        coalesce(p.owner_deceased, false) = false
        AND coalesce(p.owner_litigator, false) = false
        AND coalesce(ps.has_eligible_mobile, false)
      ) AS sms_eligible,
      p.hot_lead,
      coalesce(ps.opted_in_count, 0)::int AS opted_in_count,
      (
        SELECT max(o.occurred_at) FROM outreach_events o WHERE o.parcel_id = p.id
      ) AS last_reached_at,
      (
        SELECT count(*)::int FROM leads l WHERE l.parcel_id = p.id
      ) AS storm_count,
      (
        SELECT max(se.occurred_at)
        FROM leads l
        JOIN storm_events se ON se.id = l.storm_event_id
        WHERE l.parcel_id = p.id
      ) AS last_storm_at
    FROM parcels p
    JOIN counties co ON co.fips = p.county_fips
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS phone_count,
        count(*) FILTER (WHERE c.dnc IS TRUE)::int AS dnc_count,
        count(*) FILTER (WHERE c.tcpa IS TRUE)::int AS tcpa_count,
        count(*) FILTER (WHERE s.phone IS NOT NULL)::int AS stopped_count,
        bool_or(
          lower(c.line_type) = 'mobile'
          AND c.dnc IS FALSE
          AND c.tcpa IS FALSE
          AND s.phone IS NULL
        ) AS has_eligible_mobile,
        (array_agg(c.number ORDER BY c.rank) FILTER (
          WHERE lower(c.line_type) = 'mobile'
            AND c.dnc IS FALSE
            AND c.tcpa IS FALSE
            AND s.phone IS NULL
        ))[1] AS best_mobile,
        count(*) FILTER (
          WHERE cons.phone IS NOT NULL
            AND lower(c.line_type) = 'mobile'
            AND c.dnc IS FALSE
            AND c.tcpa IS FALSE
            AND s.phone IS NULL
        )::int AS opted_in_count
      FROM contacts c
      LEFT JOIN phone_suppressions s ON s.phone = c.number
      LEFT JOIN phone_consents cons ON cons.phone = c.number
      WHERE c.parcel_id = p.id
    ) ps ON true
    WHERE p.id = ${parcelId}::uuid
  `;
  if (!parcel) return null;
  const phones = await client<
    {
      id: string;
      number: string;
      line_type: string | null;
      carrier: string | null;
      dnc: boolean | null;
      tcpa: boolean | null;
      rank: number;
      traced_at: string | Date;
      suppressed: boolean;
      consented: boolean;
    }[]
  >`
    SELECT
      c.id,
      c.number,
      c.line_type,
      c.carrier,
      c.dnc,
      c.tcpa,
      c.rank,
      c.traced_at,
      (s.phone IS NOT NULL) AS suppressed,
      (cons.phone IS NOT NULL) AS consented
    FROM contacts c
    LEFT JOIN phone_suppressions s ON s.phone = c.number
    LEFT JOIN phone_consents cons ON cons.phone = c.number
    WHERE c.parcel_id = ${parcelId}::uuid
    ORDER BY c.rank
  `;
  const [latestLead] = await client<
    {
      score: string | number;
      score_breakdown: unknown;
      event_type: string;
      occurred_at: string | Date;
    }[]
  >`
    SELECT l.score, l.score_breakdown, se.event_type, se.occurred_at
    FROM leads l
    JOIN storm_events se ON se.id = l.storm_event_id
    WHERE l.parcel_id = ${parcelId}::uuid
    ORDER BY se.occurred_at DESC
    LIMIT 1
  `;
  return { parcel, phones, latestLead: latestLead ?? null };
}
