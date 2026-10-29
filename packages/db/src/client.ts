import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseUrl, getDirectUrl } from "@storm-leads/core";
import * as schema from "./schema";

export function createDb(url = getDatabaseUrl(), opts?: { max?: number }) {
  const supabase = /supabase\.(co|com)/i.test(url);
  const client = postgres(url, {
    prepare: false,
    max: opts?.max ?? 8,
    ssl: supabase ? "require" : undefined,
  });
  return { db: drizzle(client, { schema }), client };
}

export function createDirectDb(opts?: { max?: number }) {
  return createDb(getDirectUrl(), opts);
}

export type Database = ReturnType<typeof createDb>["db"];
export type Sql = ReturnType<typeof createDb>["client"];
