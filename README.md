# Storm Leads

Private Next.js PoC: Stafford County wind/hail events → scored single-family parcels → Tracerfy owner phones.

No paid weather API. NWS + IEM are free. PostGIS on Supabase.

## Setup

1. Copy `.env.example` to `.env.local` at the **repo root** (Next and the ingest CLIs both read it from there).
2. From Database → Connect → pooling: `DATABASE_URL` is the **transaction** pooler (`:6543`). `DIRECT_URL` is the **session** pooler (`:5432`) for migrate/ingest. URL-encode `!` in the password as `%21`.
3. Enable email auth in Supabase and add your allowlisted user.

```bash
corepack pnpm install
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm ingest:parcels          # Stafford (51179)
corepack pnpm ingest:storms
corepack pnpm dev
```

Open http://localhost:3000, sign in, **Sync storms** if needed, pick an event, **Generate leads**, **Trace top 25 (~$2.50)**, export CSV.

`pnpm` is not required on your PATH — these scripts call `corepack pnpm`. Parcel ingest must include the extra `--` so the county flag reaches the CLI.

## Notes

- Owner names are not on VA public GIS. Addresses come from counties; name/phone from Tracerfy.
- Trace is capped at 250 and defaults to the top 25 by score (~$2.50). Spend is stored per job and shown as a running total in the header.
- Demo AOI is Stafford only. Fairfax and Loudoun stay in seed data (`db:seed -- --all`) but are out of this demo.
- Parcel ingest is local-only; too large for a Hobby serverless timeout.
