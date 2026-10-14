"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_CURRENT_MONTHLY_USD,
  estimateUsageCost,
  formatUsd,
  SMS_CAMPAIGN_USD_PER_MONTH,
  SMS_INBOUND_USD_PER_REPLY,
  SMS_NUMBER_USD_PER_MONTH,
  SMS_OUTBOUND_USD_PER_SEGMENT,
  TRACE_USD_PER_HIT,
} from "@storm-leads/core";
import { signOut } from "@/app/login/actions";
import { AppNav } from "./AppNav";
import { Logo } from "./Logo";

const fieldClass =
  "mt-2 w-full border border-[#3a342e] bg-[#161412] px-3 py-2 text-sm text-[#f3ece3] outline-none focus:border-[#d4783b]";

function amount(raw: string, fallback: number): number {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function usdRate(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function choiceClass(on: boolean) {
  return `border px-3 py-1.5 text-xs uppercase tracking-wider ${
    on
      ? "border-[#d4783b] bg-[#d4783b] text-[#161412]"
      : "border-[#3a342e] text-[#b7aaa0] hover:border-[#d4783b] hover:text-[#f3ece3]"
  }`;
}

export function CostEstimate() {
  const [textsRaw, setTexts] = useState("1000");
  const [segments, setSegments] = useState<1 | 2>(1);
  const [lookupsRaw, setLookups] = useState("200");
  const [replyRaw, setReply] = useState("10");
  const [daysRaw, setDays] = useState("30");
  const [currentRaw, setCurrent] = useState(String(DEFAULT_CURRENT_MONTHLY_USD));

  const estimate = useMemo(
    () =>
      estimateUsageCost({
        textsPerDay: amount(textsRaw, 1000),
        segments,
        newLookupsPerDay: amount(lookupsRaw, 200),
        replyPercent: amount(replyRaw, 10),
        sendDays: amount(daysRaw, 30),
        currentMonthlyUsd: amount(currentRaw, DEFAULT_CURRENT_MONTHLY_USD),
      }),
    [textsRaw, segments, lookupsRaw, replyRaw, daysRaw, currentRaw],
  );

  const maxBar = Math.max(estimate.suiteUsd, estimate.currentUsd, 1);
  const ahead = estimate.differenceUsd >= 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center border-b border-[#3a342e] px-5 py-6">
        <div className="min-w-0 flex-1">
          <Logo />
        </div>
        <AppNav current="costs" />
        <div className="flex min-w-0 flex-1 items-center justify-end">
          <form action={signOut}>
            <button
              type="submit"
              className="border border-[#3a342e] px-3 py-1.5 text-xs uppercase tracking-wider hover:border-[#d4783b]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-6">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-xl">Costs</h1>
          <p className="mt-2 max-w-2xl text-sm text-[#b7aaa0]">
            Buying the leads and contacting them runs about {formatUsd(DEFAULT_CURRENT_MONTHLY_USD)} a month.
            This is that same month here: texts to people who asked for them, and a lookup only when the home is not already saved.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <figure className="border border-[#3a342e] bg-[#211e1b] px-4 py-4">
              <figcaption className="text-xs uppercase tracking-wider text-[#b7aaa0]">This suite</figcaption>
              <p className="mt-2 text-3xl tabular-nums text-[#d4783b]">{formatUsd(estimate.suiteUsd)}</p>
              <p className="mt-1 text-sm text-[#b7aaa0]">{estimate.sendDays} send-days</p>
            </figure>
            <figure className="border border-[#3a342e] bg-[#211e1b] px-4 py-4">
              <figcaption className="text-xs uppercase tracking-wider text-[#b7aaa0]">Today</figcaption>
              <p className="mt-2 text-3xl tabular-nums">{formatUsd(estimate.currentUsd)}</p>
              <p className="mt-1 text-sm text-[#b7aaa0]">Leads plus contacting them</p>
            </figure>
            <figure className="border border-[#3a342e] bg-[#211e1b] px-4 py-4">
              <figcaption className="text-xs uppercase tracking-wider text-[#b7aaa0]">
                {ahead ? "Less than today" : "More than today"}
              </figcaption>
              <p className="mt-2 text-3xl tabular-nums text-[#d4783b]">
                {formatUsd(Math.abs(estimate.differenceUsd))}
              </p>
              <p className="mt-1 text-sm text-[#b7aaa0]">Over those send-days</p>
            </figure>
          </div>

          <div className="mt-8 space-y-4">
            <Meter label="This suite" value={estimate.suiteUsd} max={maxBar} accent />
            <Meter label="Today" value={estimate.currentUsd} max={maxBar} />
          </div>
          <p className="mt-3 text-sm text-[#b7aaa0]">
            Today is the whole month of buying the leads and contacting them. The suite line is the texts, the replies, and lookups for homes not already saved.
          </p>

          <dl className="mt-8 divide-y divide-[#3a342e] border-y border-[#3a342e]">
            <Line
              label="Texts"
              value={formatUsd(estimate.outboundUsd)}
              detail={`${estimate.textsPerDay.toLocaleString()} a day, ${estimate.segments} segment${estimate.segments === 1 ? "" : "s"}, ${estimate.sendDays} days`}
            />
            <Line
              label="Replies"
              value={formatUsd(estimate.inboundUsd)}
              detail={`${Math.round(estimate.replies).toLocaleString()} at ${usdRate(SMS_INBOUND_USD_PER_REPLY)}`}
            />
            <Line
              label="New lookups"
              value={formatUsd(estimate.lookupsUsd)}
              detail={`${estimate.newLookupsPerDay.toLocaleString()} hits a day at ${formatUsd(TRACE_USD_PER_HIT)}. Misses are free.`}
            />
            <Line
              label="Number and campaign"
              value={formatUsd(estimate.fixedUsd)}
              detail={`${formatUsd(SMS_NUMBER_USD_PER_MONTH)} number, ${formatUsd(SMS_CAMPAIGN_USD_PER_MONTH)} low-volume campaign`}
            />
          </dl>

          <div className="mt-8 border border-[#3a342e] p-4">
            <p className="text-xs uppercase tracking-wider text-[#b7aaa0]">Adjust the month</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-xs uppercase tracking-wider text-[#b7aaa0]">
                Texts per day
                <input value={textsRaw} onChange={(e) => setTexts(e.target.value)} inputMode="numeric" className={fieldClass} />
              </label>
              <label className="text-xs uppercase tracking-wider text-[#b7aaa0]">
                New lookups per day
                <input value={lookupsRaw} onChange={(e) => setLookups(e.target.value)} inputMode="numeric" className={fieldClass} />
              </label>
              <label className="text-xs uppercase tracking-wider text-[#b7aaa0]">
                Replies, percent
                <input value={replyRaw} onChange={(e) => setReply(e.target.value)} inputMode="decimal" className={fieldClass} />
              </label>
              <label className="text-xs uppercase tracking-wider text-[#b7aaa0]">
                Send-days
                <input value={daysRaw} onChange={(e) => setDays(e.target.value)} inputMode="numeric" className={fieldClass} />
              </label>
              <label className="text-xs uppercase tracking-wider text-[#b7aaa0] sm:col-span-2">
                Buying and contacting, per month
                <input value={currentRaw} onChange={(e) => setCurrent(e.target.value)} inputMode="decimal" className={fieldClass} />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={choiceClass(segments === 1)} onClick={() => setSegments(1)}>
                1 segment
              </button>
              <button type="button" className={choiceClass(segments === 2)} onClick={() => setSegments(2)}>
                2 segments
              </button>
              <button type="button" className={choiceClass(lookupsRaw === "0")} onClick={() => setLookups("0")}>
                Already indexed
              </button>
              <button type="button" className={choiceClass(lookupsRaw === "200")} onClick={() => setLookups("200")}>
                200 new homes
              </button>
              <button type="button" className={choiceClass(lookupsRaw === "1000")} onClick={() => setLookups("1000")}>
                All 1,000 are new
              </button>
            </div>
            <p className="mt-4 text-sm text-[#b7aaa0]">
              A text is {usdRate(SMS_OUTBOUND_USD_PER_SEGMENT)} a segment. The stock message usually fits in one.
              A long name and street can spill into a second and double the text line. One thousand two-segment texts a day still fits the low-volume campaign.
              A hit that is not a mobile line, or that never asks for texts, still costs {formatUsd(TRACE_USD_PER_HIT)} and does not become a send.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meter({ label, value, max, accent }: { label: string; value: number; max: number; accent?: boolean }) {
  const width = Math.max(1.5, (value / max) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-[#b7aaa0]">{label}</span>
        <span className="tabular-nums">{formatUsd(value)}</span>
      </div>
      <div className="mt-2 h-2 bg-[#211e1b]">
        <div className="h-2" style={{ width: `${width}%`, background: accent ? "#d4783b" : "#7a6e64" }} />
      </div>
    </div>
  );
}

function Line({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[180px_140px_1fr] sm:items-baseline sm:gap-4">
      <dt className="text-sm">{label}</dt>
      <dd className="tabular-nums text-[#d4783b] sm:text-right">{value}</dd>
      <dd className="text-sm text-[#b7aaa0]">{detail}</dd>
    </div>
  );
}
