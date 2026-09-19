import { loadEnv } from "../load-env";
loadEnv();

import { createDirectDb } from "../client";
import { ingestStorms } from "../ops/storms";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

const full = process.argv.includes("--full");
const monthsArg = arg("months");
const { db, client } = createDirectDb();
const result = await ingestStorms(db, client, {
  full,
  months: monthsArg ? Number(monthsArg) : undefined,
  includeNws: (arg("nws") ?? "1") !== "0",
});
await client.end();
console.log(
  `Storm ingest complete. mode=${result.mode} ${result.from.slice(0, 10)}→${result.to.slice(0, 10)} fetched=${result.eventsFetched} stored=${result.eventsStored} lsr=${result.reportsStored}`,
);
