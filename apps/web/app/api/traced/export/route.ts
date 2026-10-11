import { listTracedParcels, parseTracedQuery } from "@storm-leads/db";
import { withAuth, jsonError, getDb } from "@/lib/server";

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function when(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export async function GET(request: Request) {
  return withAuth(async () => {
    const url = new URL(request.url);
    const query = parseTracedQuery(url.searchParams);
    const { client } = getDb();
    const data = await listTracedParcels(client, { ...query, limit: 5000, offset: 0 });
    if (data.parcels.length === 0) return jsonError("No traced homes match these filters", 404);
    const header = [
      "owner_name",
      "age",
      "dob",
      "property_owner",
      "address",
      "city",
      "zip",
      "county",
      "mailing_address",
      "emails",
      "year_built",
      "last_reroof_year",
      "phone_count",
      "best_mobile",
      "dnc_count",
      "tcpa_count",
      "stopped_count",
      "sms_eligible",
      "last_traced_at",
      "last_reached_at",
      "storm_count",
      "last_storm_at",
    ].join(",");
    const csv = [
      header,
      ...data.parcels.map((r) =>
        [
          r.owner_name,
          r.owner_age ?? "",
          r.owner_dob,
          r.owner_is_property_owner === true ? "yes" : r.owner_is_property_owner === false ? "no" : "",
          r.situs_address,
          r.situs_city,
          r.situs_zip,
          r.county_name,
          r.mailing_address,
          (r.owner_emails ?? []).join(" | "),
          r.year_built ?? "",
          r.last_reroof_year ?? "",
          r.phone_count,
          r.best_mobile,
          r.dnc_count,
          r.tcpa_count,
          r.stopped_count,
          r.sms_eligible ? "yes" : "no",
          when(r.last_traced_at),
          when(r.last_reached_at),
          r.storm_count,
          when(r.last_storm_at),
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="traced-homes.csv"',
      },
    });
  });
}
