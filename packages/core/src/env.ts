function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export type ServerEnv = {
  DATABASE_URL: string;
  DIRECT_URL?: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TRACERFY_API_KEY?: string;
  TRACERFY_WEBHOOK_SECRET?: string;
  NWS_USER_AGENT: string;
  CRON_SECRET?: string;
  ALLOWED_EMAILS: string[];
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_WEBHOOK_URL?: string;
};

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const emails = (optional("ALLOWED_EMAILS") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  cached = {
    DATABASE_URL: normalizePgUrl(required("DATABASE_URL")),
    DIRECT_URL: optional("DIRECT_URL") ? normalizePgUrl(optional("DIRECT_URL")!) : undefined,
    SUPABASE_URL: required("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
    TRACERFY_API_KEY: optional("TRACERFY_API_KEY"),
    TRACERFY_WEBHOOK_SECRET: optional("TRACERFY_WEBHOOK_SECRET"),
    NWS_USER_AGENT: optional("NWS_USER_AGENT") ?? "storm-leads (local-dev)",
    CRON_SECRET: optional("CRON_SECRET"),
    ALLOWED_EMAILS: emails,
    TWILIO_ACCOUNT_SID: optional("TWILIO_ACCOUNT_SID"),
    TWILIO_AUTH_TOKEN: optional("TWILIO_AUTH_TOKEN"),
    TWILIO_FROM_NUMBER: optional("TWILIO_FROM_NUMBER"),
    TWILIO_WEBHOOK_URL: optional("TWILIO_WEBHOOK_URL"),
  };
  return cached;
}

/** Transaction pooler (6543). Used by the Next.js app. */
export function getDatabaseUrl(): string {
  return normalizePgUrl(required("DATABASE_URL"));
}

/** Session pooler / direct (5432). Used by migrate, seed, and ingest CLIs. */
export function getDirectUrl(): string {
  return normalizePgUrl(optional("DIRECT_URL") ?? required("DATABASE_URL"));
}

function normalizePgUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("pgbouncer");
  return parsed.toString();
}

export function getNwsUserAgent(): string {
  return optional("NWS_USER_AGENT") ?? "storm-leads (local-dev)";
}

export function getTracerfyKey(): string | undefined {
  return optional("TRACERFY_API_KEY");
}

export function getTwilioConfig():
  | { accountSid: string; authToken: string; from: string }
  | null {
  const env = getServerEnv();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER) return null;
  return {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    from: env.TWILIO_FROM_NUMBER,
  };
}
