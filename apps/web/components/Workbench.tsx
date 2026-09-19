"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RECENT_STORM_HOURS,
  TRACE_DEFAULT_LIMIT,
  estimateTraceCost,
  formatUsd,
} from "@storm-leads/core";
import { signOut } from "@/app/login/actions";
import { StormMap } from "./StormMap";

type Storm = {
  id: string;
  event_type: string;
  occurred_at: string;
  wind_mph: string | null;
  hail_in: string | null;
  source: string;
  confidence: string | null;
  lead_count: number;
  geom: GeoJSON.Geometry;
  recent?: boolean;
};

type Lead = {
  id: string;
  score: string | number;
  situs_address: string | null;
  situs_city: string | null;
  situs_zip: string | null;
  situs_state: string | null;
  county_name: string | null;
  owner_name: string | null;
  year_built: number | null;
  primary_phone: string | null;
  centroid: GeoJSON.Geometry | null;
  score_breakdown: {
    factors?: Record<string, number>;
  } | null;
};

type Spend = {
  credits: number;
  usd: number;
  lookups: number;
  hits: number;
  misses: number;
  jobs: number;
};

type Usage = {
  allTime: Spend;
  storm: Spend | null;
  next: {
    remaining: number;
    lookups: number;
    credits: number;
    usd: number;
    alreadyHits?: number;
    need?: number;
    target?: number;
  } | null;
  recent: Array<{
    id: string;
    usd: number;
    credits: number;
    requested: number;
    hits: number;
    submitted_at: string | null;
  }>;
};

const fallbackNext = estimateTraceCost(TRACE_DEFAULT_LIMIT);

type ScoreProgress = {
  status: "idle" | "running" | "completed" | "failed";
  phase: string;
  total: number;
  scored: number;
  message: string | null;
  startedAt: string | null;
  error: string | null;
};

function isRecentStorm(storm: Storm): boolean {
  if (storm.recent === true) return true;
  return Date.now() - new Date(storm.occurred_at).getTime() < RECENT_STORM_HOURS * 60 * 60 * 1000;
}

function formatElapsed(startedAt: string | null): string {
  if (!startedAt) return "0:00";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function Workbench({ mapTilerKey }: { mapTilerKey: string }) {
  const [storms, setStorms] = useState<Storm[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedStormId, setSelectedStormId] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [scoreProgress, setScoreProgress] = useState<ScoreProgress | null>(null);
  const [elapsed, setElapsed] = useState("0:00");
  const runGen = useRef(0);
  const scoreClosed = useRef(false);

  const selectedStorm = storms.find((s) => s.id === selectedStormId) ?? null;
  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;
  const nextCost = usage?.next ?? fallbackNext;
  const lastJob = usage?.recent[0] ?? null;

  const loadStorms = useCallback(async () => {
    const res = await fetch("/api/storms");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load storms");
    setStorms(data.storms ?? []);
  }, []);

  const loadLeads = useCallback(async (stormId: string) => {
    const res = await fetch(`/api/storms/${stormId}/leads`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load leads");
    setLeads(data.leads ?? []);
  }, []);

  const loadUsage = useCallback(async (stormId?: string | null) => {
    const qs = stormId ? `?stormId=${stormId}` : "";
    const res = await fetch(`/api/usage${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load spend");
    setUsage(data);
  }, []);

  useEffect(() => {
    loadStorms().catch((err) => setStatus(err.message));
  }, [loadStorms]);

  useEffect(() => {
    const refresh = window.setInterval(() => {
      loadStorms().catch(() => undefined);
    }, 5 * 60 * 1000);
    return () => window.clearInterval(refresh);
  }, [loadStorms]);

  const loadScoreProgress = useCallback(async (stormId: string) => {
    const res = await fetch(`/api/storms/${stormId}/score-progress`);
    const data = await res.json();
    if (!res.ok) return;
    setScoreProgress(data);
    return data as ScoreProgress;
  }, []);

  useEffect(() => {
    if (!selectedStormId) {
      loadUsage().catch((err) => setStatus(err.message));
      return;
    }
    loadUsage(selectedStormId).catch((err) => setStatus(err.message));
  }, [selectedStormId, loadUsage]);

  const finishScoring = useCallback(
    async (stormId: string, message: string) => {
      if (scoreClosed.current) return;
      scoreClosed.current = true;
      runGen.current += 1;
      setBusy(null);
      setStatus(message);
      await Promise.all([
        loadStorms().catch((err) => setStatus(err.message)),
        loadLeads(stormId).catch((err) => setStatus(err.message)),
        loadUsage(stormId).catch((err) => setStatus(err.message)),
      ]);
    },
    [loadStorms, loadLeads, loadUsage],
  );

  useEffect(() => {
    if (busy !== "leads" || !selectedStormId) return;
    let cancelled = false;
    const tick = async () => {
      const data = await loadScoreProgress(selectedStormId);
      if (cancelled || !data) return;
      if (data.status === "completed" || data.status === "failed") {
        const message =
          data.status === "failed"
            ? (data.error ?? "Scoring failed")
            : (data.message ?? `Scored ${data.scored} single-family parcels.`);
        await finishScoring(selectedStormId, message);
      }
    };
    tick();
    const poll = window.setInterval(tick, 2000);
    const startedAt = scoreProgress?.startedAt ?? new Date().toISOString();
    const clock = window.setInterval(() => {
      setElapsed(formatElapsed(startedAt));
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [busy, selectedStormId, loadScoreProgress, finishScoring, scoreProgress?.startedAt]);

  async function run(label: string, fn: () => Promise<void>) {
    const id = ++runGen.current;
    setBusy(label);
    setStatus(null);
    try {
      await fn();
    } catch (err) {
      if (runGen.current === id) {
        setStatus(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      if (runGen.current === id) setBusy(null);
    }
  }

  return (
    <div className="grid h-screen grid-cols-[280px_minmax(0,1fr)_340px] grid-rows-[64px_minmax(0,1fr)]">
      <header className="col-span-3 flex items-center justify-between border-b border-[#3a342e] px-5">
        <div>
          <p className="text-[10px] tracking-[0.22em] text-[#b7aaa0] uppercase">DMV · DC, MD, Northern VA</p>
          <h1 className="serif text-xl leading-none">Storm Leads</h1>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-[10px] tracking-[0.18em] text-[#b7aaa0] uppercase">Skip-trace spend</p>
            <p className="text-lg leading-none tabular-nums text-[#d4783b]">
              {formatUsd(usage?.allTime.usd ?? 0)}
            </p>
            <p className="mt-1 text-[10px] text-[#b7aaa0]">
              {usage?.allTime.credits ?? 0} credits
              {lastJob
                ? ` · last ${formatUsd(lastJob.usd)}`
                : ""}
            </p>
          </div>
          <button
            disabled={Boolean(busy)}
            onClick={() =>
              run("sync", async () => {
                const res = await fetch("/api/storms", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                setStatus(
                  `Caught up ${new Date(data.from).toLocaleDateString()} → now · ${data.eventsStored} events, ${data.reportsStored} reports.`,
                );
                await loadStorms();
              })
            }
            className="border border-[#3a342e] px-3 py-1.5 text-xs uppercase tracking-wider hover:border-[#d4783b]"
          >
            {busy === "sync" ? "Syncing…" : "Sync storms"}
          </button>
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

      <aside className="overflow-y-auto border-r border-[#3a342e]">
        <p className="px-4 py-3 text-[11px] uppercase tracking-wider text-[#b7aaa0]">
          Last 12 months · {storms.length} events
          {storms.some(isRecentStorm)
            ? ` · ${storms.filter(isRecentStorm).length} in the last ${RECENT_STORM_HOURS}h`
            : ""}
        </p>
        {storms.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#b7aaa0]">
            No events yet. Click <span className="text-[#f3ece3]">Sync storms</span> to pull IEM
            warnings for WFO LWX, clipped to the DMV.
          </p>
        ) : null}
        {storms.map((storm) => (
          <button
            key={storm.id}
            onClick={() => {
              setSelectedStormId(storm.id);
              setSelectedLeadId(null);
              loadLeads(storm.id).catch((err) => setStatus(err.message));
            }}
            className={`block w-full border-b border-[#3a342e] px-4 py-3 text-left ${
              storm.id === selectedStormId
                ? "bg-[#2a241f]"
                : isRecentStorm(storm)
                  ? "bg-[#2a2118] hover:bg-[#32271c]"
                  : "hover:bg-[#1c1917]"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm capitalize">
                {storm.event_type}
                {isRecentStorm(storm) ? (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-[#d4783b]">
                    Last {RECENT_STORM_HOURS}h
                  </span>
                ) : null}
              </span>
              <span className="text-[11px] text-[#b7aaa0]">
                {isRecentStorm(storm)
                  ? new Date(storm.occurred_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : new Date(storm.occurred_at).toLocaleDateString()}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-[#b7aaa0]">
              {storm.wind_mph ? `${storm.wind_mph} mph` : "—"}
              {" · "}
              {storm.hail_in ? `${storm.hail_in}" hail` : "no hail tag"}
              {" · "}
              {storm.lead_count} leads
            </p>
          </button>
        ))}
      </aside>

      <section className="relative min-h-0">
        <StormMap
          mapTilerKey={mapTilerKey}
          storms={selectedStorm ? [selectedStorm] : storms}
          selectedStormId={selectedStormId}
          leads={leads}
          selectedLeadId={selectedLeadId}
          onSelectLead={setSelectedLeadId}
        />
        {busy === "leads" &&
        scoreProgress?.status !== "completed" &&
        scoreProgress?.status !== "failed" ? (
          <div className="absolute inset-x-4 bottom-4 rounded border border-[#3a342e] bg-[#211e1b]/95 p-4 shadow-lg">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#b7aaa0]">Scoring this storm</p>
            <p className="mt-1 text-sm text-[#f3ece3]">
              {Number(elapsed.split(":")[0]) >= 1 &&
              (scoreProgress?.phase === "starting" || scoreProgress?.status === "idle")
                ? "Server hasn't started scoring — a storm sync is blocking the database. Stop waiting, restart npm run dev, then Generate leads again."
                : (scoreProgress?.message ??
                  "Starting… the first step can take a minute on a wide warning.")}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden bg-[#161412]">
              <div
                className="h-full bg-[#d4783b] transition-[width] duration-300"
                style={{
                  width:
                    scoreProgress && scoreProgress.total > 0
                      ? `${Math.min(100, (scoreProgress.scored / scoreProgress.total) * 100)}%`
                      : "12%",
                }}
              />
            </div>
            <p className="mt-2 text-[11px] text-[#b7aaa0]">
              {elapsed} elapsed
              {scoreProgress && scoreProgress.total > 0
                ? ` · ${scoreProgress.scored.toLocaleString()} of ${scoreProgress.total.toLocaleString()} homes`
                : " · finding homes in the warning"}
            </p>
          </div>
        ) : status ? (
          <p className="absolute bottom-3 left-3 right-3 bg-[#211e1b]/90 px-3 py-2 text-xs">{status}</p>
        ) : null}
      </section>

      <aside className="flex min-h-0 flex-col border-l border-[#3a342e]">
        <div className="flex gap-2 border-b border-[#3a342e] p-3">
          <button
            disabled={!selectedStormId || Boolean(busy)}
            onClick={() =>
              run("leads", async () => {
                if (!selectedStormId) return;
                scoreClosed.current = false;
                setElapsed("0:00");
                setScoreProgress({
                  status: "running",
                  phase: "starting",
                  total: 0,
                  scored: 0,
                  message: "Starting… fetching homes from county GIS, then scoring (cap 8,000).",
                  startedAt: new Date().toISOString(),
                  error: null,
                });
                const res = await fetch(`/api/storms/${selectedStormId}/generate-leads`, {
                  method: "POST",
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                await finishScoring(
                  selectedStormId,
                  `Scored ${data.scored} single-family parcels.`,
                );
              })
            }
            className="flex-1 border border-[#3a342e] px-2 py-1.5 text-[11px] hover:border-[#d4783b] disabled:opacity-40"
          >
            {busy === "leads"
              ? scoreProgress && scoreProgress.total > 0
                ? `Scoring ${scoreProgress.scored.toLocaleString()}/${scoreProgress.total.toLocaleString()}`
                : "Finding homes…"
              : "Generate leads"}
          </button>
          <button
            disabled={!selectedStormId || Boolean(busy)}
            onClick={() =>
              run("trace", async () => {
                if (!selectedStormId) return;
                const res = await fetch(`/api/storms/${selectedStormId}/trace`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ limit: TRACE_DEFAULT_LIMIT }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                if (data.usage) setUsage(data.usage);
                else await loadUsage(selectedStormId);
                setStatus(
                  `+${data.hits} hits / ${data.misses} misses (${formatUsd(Number(data.estimatedUsd ?? 0))}) · ${(data.alreadyHits ?? 0) + data.hits} with property info.`,
                );
                await loadLeads(selectedStormId);
              })
            }
            className="flex-1 bg-[#d4783b] px-2 py-1.5 text-[11px] font-medium text-[#161412] disabled:opacity-40"
          >
            {busy === "trace"
              ? "Tracing…"
              : `Trace ${TRACE_DEFAULT_LIMIT} hits (${formatUsd(nextCost.usd)})`}
          </button>
        </div>
        {selectedStormId ? (
          <div className="border-b border-[#3a342e] px-3 py-2 text-[11px] text-[#b7aaa0]">
            <p>
              Next {formatUsd(nextCost.usd)} · {TRACE_DEFAULT_LIMIT} more hits
              {usage?.next ? ` · ${usage.next.alreadyHits ?? 0} with property info` : ""}
              {usage?.next != null
                ? ` · ${usage.next.remaining.toLocaleString()} still untraced`
                : leads.length === 0
                  ? " · generate leads first"
                  : ""}
            </p>
            <p className="mt-1">
              This storm {formatUsd(usage?.storm?.usd ?? 0)}
              {usage?.storm
                ? ` · ${usage.storm.lookups} lookups · ${usage.storm.hits} hits`
                : ""}
            </p>
          </div>
        ) : null}
        {selectedStormId ? (
          <a
            href={`/api/export/${selectedStormId}`}
            className="border-b border-[#3a342e] px-3 py-2 text-center text-[11px] uppercase tracking-wider text-[#b7aaa0] hover:text-[#f3ece3]"
          >
            Export hits CSV
          </a>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {leads.map((lead) => (
            <button
              key={lead.id}
              onClick={() => setSelectedLeadId(lead.id)}
              className={`block w-full border-b border-[#3a342e] px-3 py-2 text-left ${
                lead.id === selectedLeadId ? "bg-[#2a241f]" : "hover:bg-[#1c1917]"
              }`}
            >
              <div className="flex justify-between gap-2 text-sm">
                <span className="truncate">{lead.situs_address ?? "No address"}</span>
                <span className="text-[#d4783b]">{Number(lead.score).toFixed(2)}</span>
              </div>
              <p className="truncate text-[11px] text-[#b7aaa0]">
                {lead.situs_city ?? lead.county_name ?? "DMV"} {lead.situs_zip ?? ""} ·{" "}
                {lead.county_name ?? "DMV"}
              </p>
              <p className="truncate text-[11px] text-[#b7aaa0]">
                {lead.owner_name ?? "Owner pending trace"} · {lead.primary_phone ?? "no phone"}
              </p>
            </button>
          ))}
        </div>
        {selectedLead ? (
          <div className="border-t border-[#3a342e] p-3 text-xs">
            <p className="serif text-base">{selectedLead.situs_address}</p>
            <p className="text-[#b7aaa0]">
              {selectedLead.situs_city ?? selectedLead.county_name ?? "DMV"}{" "}
              {selectedLead.situs_zip ?? ""} · {selectedLead.county_name ?? "DMV"}
              {" · "}
              {selectedLead.owner_name ?? "Not traced"} · built {selectedLead.year_built ?? "—"}
            </p>
            {selectedLead.primary_phone ? (
              <a className="mt-2 inline-block text-[#d4783b]" href={`tel:${selectedLead.primary_phone}`}>
                {selectedLead.primary_phone}
              </a>
            ) : null}
            {selectedLead.score_breakdown?.factors ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[#b7aaa0]">
                {Object.entries(selectedLead.score_breakdown.factors).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt>{k}</dt>
                    <dd>{v.toFixed(2)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
