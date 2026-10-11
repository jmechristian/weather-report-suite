import { withAuth, jsonError, getDb } from "@/lib/server";

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function flagLabel(value: boolean | null | undefined, whenTrue: string, whenFalse: string): string {
  if (value === true) return whenTrue;
  if (value === false) return whenFalse;
  return "";
}

function formatPhoneRow(phone: {
  number?: string | null;
  line_type?: string | null;
  dnc?: boolean | null;
  tcpa?: boolean | null;
  carrier?: string | null;
}): string {
  const bits = [
    phone.line_type,
    flagLabel(phone.dnc, "DNC", "Clean"),
    flagLabel(phone.tcpa, "TCPA", "Clear"),
    phone.carrier,
  ].filter(Boolean);
  return bits.length ? `${phone.number ?? ""} (${bits.join("; ")})` : (phone.number ?? "");
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ stormId: string }> },
) {
  return withAuth(async () => {
    const { stormId } = await context.params;
    const { client } = getDb();
    const rows = await client<{
      name: string;
      age: number | null;
      dob: string | null;
      property_owner: boolean | null;
      address: string;
      city: string;
      zip: string;
      mailing_address: string | null;
      emails: string[] | null;
      score: string | number;
      year_built: number | null;
      last_reroof_year: number | null;
      phones: Array<{
        number: string | null;
        line_type: string | null;
        dnc: boolean | null;
        tcpa: boolean | null;
        carrier: string | null;
      }> | null;
    }[]>`
      SELECT
        coalesce(p.owner_name, '') AS name,
        p.owner_age AS age,
        coalesce(p.owner_dob, '') AS dob,
        p.owner_is_property_owner AS property_owner,
        coalesce(p.situs_address, '') AS address,
        coalesce(p.situs_city, '') AS city,
        coalesce(p.situs_zip, '') AS zip,
        coalesce(p.mailing_address, '') AS mailing_address,
        p.owner_emails AS emails,
        l.score,
        p.year_built,
        p.last_reroof_year,
        coalesce(
          json_agg(
            json_build_object(
              'number', c.number,
              'line_type', c.line_type,
              'dnc', c.dnc,
              'tcpa', c.tcpa,
              'carrier', c.carrier
            ) ORDER BY c.rank
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'::json
        ) AS phones
      FROM leads l
      JOIN parcels p ON p.id = l.parcel_id
      LEFT JOIN contacts c ON c.parcel_id = p.id
      WHERE l.storm_event_id = ${stormId}::uuid
        AND (
          p.owner_name IS NOT NULL
          OR EXISTS (SELECT 1 FROM contacts x WHERE x.parcel_id = p.id)
        )
      GROUP BY
        p.owner_name, p.owner_age, p.owner_dob, p.owner_is_property_owner,
        p.situs_address, p.situs_city, p.situs_zip, p.mailing_address, p.owner_emails,
        l.score, l.id, p.year_built, p.last_reroof_year
      ORDER BY l.score DESC
    `;
    if (rows.length === 0) return jsonError("No skip-trace hits for this storm yet", 404);
    const header =
      "name,age,dob,property_owner,address,city,zip,mailing_address,emails,score,year_built,last_reroof_year,phones";
    const csv = [
      header,
      ...rows.map((r) =>
        [
          r.name,
          r.age ?? "",
          r.dob,
          r.property_owner === true ? "yes" : r.property_owner === false ? "no" : "",
          r.address,
          r.city,
          r.zip,
          r.mailing_address,
          (r.emails ?? []).join(" | "),
          r.score,
          r.year_built ?? "",
          r.last_reroof_year ?? "",
          (Array.isArray(r.phones) ? r.phones : []).map(formatPhoneRow).join(" | "),
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="storm-${stormId}-hits.csv"`,
      },
    });
  });
}
