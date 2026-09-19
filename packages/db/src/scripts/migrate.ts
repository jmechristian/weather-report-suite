import { loadEnv } from "../load-env";
loadEnv();

import { createDirectDb } from "../client";
import { SCHEMA_SQL } from "../sql";

const { client } = createDirectDb();
await client.unsafe(SCHEMA_SQL);
await client.end();
console.log("Schema applied.");
