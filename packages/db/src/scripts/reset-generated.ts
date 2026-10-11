import { loadEnv } from "../load-env";
loadEnv();

import { createDirectDb } from "../client";

const { client } = createDirectDb();
await client`
  TRUNCATE outreach_events, sms_campaigns, phone_consents, phone_suppressions, leads, contacts, trace_jobs, score_jobs, storm_reports, storm_events, parcels
  RESTART IDENTITY CASCADE
`;
await client.end();
console.log("Cleared leads, contacts, jobs, storms, and parcels. Auth and counties were left alone.");
