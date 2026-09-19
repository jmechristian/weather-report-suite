export const TRACE_DEFAULT_LIMIT = 25;
export const TRACE_HARD_CAP = 250;
export const TRACE_CREDITS_PER_LOOKUP = 5;
export const TRACE_USD_PER_CREDIT = 0.02;

export function creditsToUsd(credits: number): number {
  return Math.round(credits * TRACE_USD_PER_CREDIT * 100) / 100;
}

export function estimateTraceCost(lookups: number): {
  lookups: number;
  credits: number;
  usd: number;
} {
  const n = Math.max(0, Math.trunc(lookups));
  const credits = n * TRACE_CREDITS_PER_LOOKUP;
  return { lookups: n, credits, usd: creditsToUsd(credits) };
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function remainingHitTarget(alreadyHits: number, target = TRACE_DEFAULT_LIMIT): number {
  return Math.max(0, target - Math.max(0, Math.trunc(alreadyHits)));
}

export function maxTraceLookups(need: number): number {
  if (need <= 0) return 0;
  return Math.min(TRACE_HARD_CAP, Math.max(need * 4, need));
}
