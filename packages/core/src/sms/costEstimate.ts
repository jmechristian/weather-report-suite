import { TRACE_CREDITS_PER_LOOKUP, TRACE_USD_PER_CREDIT } from "../trace/cost";

/** Twilio US SMS base $0.0083 plus about $0.0042 in carrier fees. October 2026 list prices. */
export const SMS_OUTBOUND_USD_PER_SEGMENT = 0.0125;
/** Inbound reply: the same Twilio base plus a smaller carrier fee. */
export const SMS_INBOUND_USD_PER_REPLY = 0.0105;
/** Instant parcel or address hit. Misses are free and are not passed in here. */
export const TRACE_USD_PER_HIT = TRACE_CREDITS_PER_LOOKUP * TRACE_USD_PER_CREDIT;
export const SMS_NUMBER_USD_PER_MONTH = 1.15;
/** Low-volume 10DLC campaign. One thousand texts a day stays inside that tier. */
export const SMS_CAMPAIGN_USD_PER_MONTH = 1.5;
/** What buying the leads and contacting them runs in a month today. */
export const DEFAULT_CURRENT_MONTHLY_USD = 10_000;

export type UsageEstimateInput = {
  textsPerDay: number;
  segments: number;
  newLookupsPerDay: number;
  replyPercent: number;
  sendDays: number;
  currentMonthlyUsd: number;
};

export type UsageEstimate = {
  textsPerDay: number;
  segments: 1 | 2;
  newLookupsPerDay: number;
  replyPercent: number;
  sendDays: number;
  replies: number;
  outboundUsd: number;
  inboundUsd: number;
  lookupsUsd: number;
  fixedUsd: number;
  suiteUsd: number;
  currentUsd: number;
  differenceUsd: number;
};

function bounded(value: number, cap: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(cap, value);
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function estimateUsageCost(input: UsageEstimateInput): UsageEstimate {
  const textsPerDay = Math.trunc(bounded(input.textsPerDay, 1_000_000));
  const segments: 1 | 2 = input.segments >= 2 ? 2 : 1;
  const newLookupsPerDay = Math.trunc(bounded(input.newLookupsPerDay, 1_000_000));
  const replyPercent = bounded(input.replyPercent, 100);
  const sendDays = Math.trunc(bounded(input.sendDays, 31));
  const currentUsd = money(bounded(input.currentMonthlyUsd, 10_000_000));

  const replies = textsPerDay * (replyPercent / 100) * sendDays;
  const outboundUsd = money(textsPerDay * segments * SMS_OUTBOUND_USD_PER_SEGMENT * sendDays);
  const inboundUsd = money(replies * SMS_INBOUND_USD_PER_REPLY);
  const lookupsUsd = money(newLookupsPerDay * TRACE_USD_PER_HIT * sendDays);
  const fixedUsd = money(SMS_NUMBER_USD_PER_MONTH + SMS_CAMPAIGN_USD_PER_MONTH);
  const suiteUsd = money(outboundUsd + inboundUsd + lookupsUsd + fixedUsd);

  return {
    textsPerDay,
    segments,
    newLookupsPerDay,
    replyPercent,
    sendDays,
    replies,
    outboundUsd,
    inboundUsd,
    lookupsUsd,
    fixedUsd,
    suiteUsd,
    currentUsd,
    differenceUsd: money(currentUsd - suiteUsd),
  };
}
