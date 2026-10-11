"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HOME_AGE_INTENT_YEARS,
  INTENT_LEAD_CAP,
  RECENT_STORM_HOURS,
  TRACE_DEFAULT_LIMIT,
  estimateTraceCost,
  formatUsd,
} from "@storm-leads/core";
import { signOut } from "@/app/login/actions";
import { StormMap } from "./StormMap";
import { LeadModal } from "./LeadModal";
import { AppNav } from "./AppNav";
import { Logo } from "./Logo";

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
  last_reroof_year: number | null;
  primary_phone: string | null;
  centroid: GeoJSON.Geometry | null;
  score_breakdown: {
    factors?: Record<string, number>;
  } | null;
};

type LeadPhone = {
  id: string;
  number: string;
  line_type: string | null;
  carrier: string | null;
  dnc: boolean | null;
  tcpa: boolean | null;
  rank: number;
  suppressed?: boolean | null;
};

type LeadDetail = {
  lead: Lead & {
    parcel_id?: string;
    mailing_address: string | null;
    owner_age: number | null;
    owner_dob: string | null;
    owner_is_property_owner: boolean | null;
    owner_deceased: boolean | null;
    owner_litigator: boolean | null;
    owner_emails: string[] | null;
  };
  phones: LeadPhone[];
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

function intentYearsLabel(lead: Lead): string {
  const built = lead.year_built ? `built ${lead.year_built}` : "year unknown";
  return lead.last_reroof_year ? `${built} · roof ${lead.last_reroof_year}` : built;
}

function readStormParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("storm");
}

function writeStormParam(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("storm", id);
  else url.searchParams.delete("storm");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function formatStormSync(iso: string | null): string {
  if (!iso) return "Not synced yet";
  return `Synced ${new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function stormWhen(storm: Storm): string {
  const d = new Date(storm.occurred_at);
  return isRecentStorm(storm)
    ? d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString();
}

export function Workbench({ mapTilerKey }: { mapTilerKey: string }) {
  const [storms, setStorms] = useState<Storm[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedStormId, setSelectedStormId] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [leadDetail, setLeadDetail] = useState<LeadDetail | null>(null);
  const [detailTick, setDetailTick] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [scoreProgress, setScoreProgress] = useState<ScoreProgress | null>(null);
  const [elapsed, setElapsed] = useState("0:00");
  const runGen = useRef(0);
  const scoreClosed = useRef(false);
  const generatingStormId = useRef<string | null>(null);
  const generateSeq = useRef(0);
  const selectedStormIdRef = useRef<string | null>(null);

  const selectedStorm = storms.find((s) => s.id === selectedStormId) ?? null;
  const selectedLead = leads.find((l) => l.id === selectedLeadId) ?? null;
  const nextCost = usage?.next ?? fallbackNext;
  const lastJob = usage?.recent[0] ?? null;

  const openLead = useCallback((id: string) => {
    setSelectedLeadId(id);
    setLeadModalOpen(true);
  }, []);

  const closeLead = useCallback(() => {
    setLeadModalOpen(false);
  }, []);

  const loadStorms = useCallback(async () => {
    const res = await fetch("/api/storms");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load storms");
    setStorms(data.storms ?? []);
    setLastSyncedAt(data.lastSyncedAt ?? null);
  }, []);

  const loadLeads = useCallback(async (stormId: string) => {
    const res = await fetch(`/api/storms/${stormId}/leads`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load leads");
    if (selectedStormIdRef.current !== stormId) return;
    setLeads(data.leads ?? []);
  }, []);

  const loadUsage = useCallback(async (stormId?: string | null) => {
    const qs = stormId ? `?stormId=${stormId}` : "";
    const res = await fetch(`/api/usage${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to load spend");
    if (stormId && selectedStormIdRef.current !== stormId) return;
    setUsage(data);
  }, []);

  const selectStorm = useCallback(
    (stormId: string) => {
      selectedStormIdRef.current = stormId;
      setSelectedStormId(stormId);
      setSelectedLeadId(null);
      setLeadModalOpen(false);
      setLeadDetail(null);
      writeStormParam(stormId);
      loadLeads(stormId).catch((err) => setStatus(err.message));
      loadUsage(stormId).catch((err) => setStatus(err.message));
    },
    [loadLeads, loadUsage],
  );

  useEffect(() => {
    if (!selectedLeadId) {
      setLeadDetail(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/leads/${selectedLeadId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load lead");
        if (!cancelled) setLeadDetail(data);
      })
      .catch(() => {
        if (!cancelled) setLeadDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLeadId, detailTick]);

  useEffect(() => {
    loadStorms().catch((err) => setStatus(err.message));
    const fromUrl = readStormParam();
    if (fromUrl) selectStorm(fromUrl);
  }, [loadStorms, selectStorm]);

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
    if (selectedStormId) return;
    loadUsage().catch((err) => setStatus(err.message));
  }, [selectedStormId, loadUsage]);

  const finishScoring = useCallback(
    async (stormId: string, message: string, seq: number) => {
      if (seq !== generateSeq.current) return;
      if (scoreClosed.current) return;
      scoreClosed.current = true;
      generatingStormId.current = null;
      runGen.current += 1;
      setBusy(null);
      await loadStorms().catch((err) => setStatus(err.message));
      if (selectedStormIdRef.current !== stormId) return;
      setStatus(message);
      await Promise.all([
        loadLeads(stormId).catch((err) => setStatus(err.message)),
        loadUsage(stormId).catch((err) => setStatus(err.message)),
      ]);
    },
    [loadStorms, loadLeads, loadUsage],
  );

  useEffect(() => {
    if (busy !== "leads") return;
    const stormId = generatingStormId.current;
    if (!stormId) return;
    const seq = generateSeq.current;
    let cancelled = false;
    let seenRunning = false;
    const tick = async () => {
      const data = await loadScoreProgress(stormId);
      if (cancelled || !data) return;
      if (data.status === "running") seenRunning = true;
      if (!seenRunning) return;
      if (data.status === "completed" || data.status === "failed") {
        const message =
          data.status === "failed"
            ? (data.error ?? "Scoring failed")
            : (data.message ?? `Scored ${data.scored} intent homes.`);
        await finishScoring(stormId, message, seq);
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
  }, [busy, loadScoreProgress, finishScoring, scoreProgress?.startedAt]);

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
    <div className="grid h-screen grid-cols-[280px_minmax(0,1fr)_340px] grid-rows-[auto_minmax(0,1fr)]">
      <header className="col-span-3 flex items-center border-b border-[#3a342e] px-5 py-6">
        <div className="min-w-0 flex-1">
          <h1>
            <Logo />
          </h1>
        </div>
        <AppNav current="storms" />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-5">
          <div className="text-right">
            <p className="text-[13px] tracking-[0.18em] text-[#b7aaa0] uppercase">Skip-trace spend</p>
            <p className="text-lg leading-none tabular-nums text-[#d4783b]">
              {formatUsd(usage?.allTime.usd ?? 0)}
            </p>
            <p className="mt-1 text-[13px] text-[#b7aaa0]">
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
                const latest = data.latestOccurredAt
                  ? new Date(data.latestOccurredAt).toLocaleDateString()
                  : "none";
                const checked = new Date(data.to).toLocaleDateString();
                setStatus(
                  data.eventsStored > 0 || data.reportsStored > 0
                    ? `Checked through ${checked} · ${data.eventsStored} new warnings, ${data.reportsStored} new reports. Latest ${latest}.`
                    : `Checked through ${checked}. Latest severe warning is still ${latest}.`,
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
        <div className="px-4 py-3">
          <p className="text-[14px] uppercase tracking-wider text-[#b7aaa0]">
            Last 12 months · {storms.length} events
            {storms.some(isRecentStorm)
              ? ` · ${storms.filter(isRecentStorm).length} in the last ${RECENT_STORM_HOURS}h`
              : ""}
          </p>
          <p className="mt-1 text-[14px] text-[#d4783b]">{formatStormSync(lastSyncedAt)}</p>
        </div>
        {storms.length === 0 ? (
          <p className="px-4 py-6 text-sm text-[#b7aaa0]">
            No events yet. Click <span className="text-[#f3ece3]">Sync storms</span> to pull IEM
            warnings for WFO LWX, clipped to the DMV.
          </p>
        ) : null}
        {storms.map((storm) => (
          <button
            key={storm.id}
            disabled={Boolean(busy)}
            onClick={() => selectStorm(storm.id)}
            className={`block w-full border-b border-[#3a342e] px-4 py-3 text-left disabled:opacity-40 ${
              storm.id === selectedStormId
                ? "bg-[#2a241f]"
                : isRecentStorm(storm)
                  ? "bg-[#2a2118] hover:bg-[#32271c]"
                  : "hover:bg-[#1c1917]"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-bold capitalize">
                {storm.event_type}
                {isRecentStorm(storm) ? (
                  <span className="ml-2 text-[13px] font-medium uppercase tracking-wider text-[#d4783b]">
                    Last {RECENT_STORM_HOURS}h
                  </span>
                ) : null}
              </span>
              <span className="text-[14px] text-[#b7aaa0]">{stormWhen(storm)}</span>
            </div>
            <p className="mt-1 text-[14px] text-[#b7aaa0]">
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
          onSelectLead={openLead}
        />
        {busy === "leads" &&
        scoreProgress?.status !== "completed" &&
        scoreProgress?.status !== "failed" ? (
          <div className="absolute inset-x-4 bottom-4 rounded border border-[#3a342e] bg-[#211e1b]/95 p-4 shadow-lg">
            <p className="text-[13px] uppercase tracking-[0.18em] text-[#b7aaa0]">Scoring this storm</p>
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
            <p className="mt-2 text-[14px] text-[#b7aaa0]">
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
        {selectedStorm ? (
          <div className="border-b border-[#3a342e] px-3 py-2">
            <p className="text-[13px] uppercase tracking-[0.18em] text-[#b7aaa0]">This event</p>
            <p className="text-sm text-[#f3ece3]">
              <span className="font-bold capitalize">{selectedStorm.event_type}</span>
              {" · "}
              {stormWhen(selectedStorm)}
            </p>
            <p className="text-[14px] text-[#b7aaa0]">{leads.length} leads on this event</p>
          </div>
        ) : null}
        <div className="flex gap-2 border-b border-[#3a342e] p-3">
          <button
            disabled={!selectedStormId || Boolean(busy)}
            onClick={() => {
              const stormId = selectedStormIdRef.current;
              if (!stormId) return;
              const seq = ++generateSeq.current;
              generatingStormId.current = stormId;
              scoreClosed.current = false;
              run("leads", async () => {
                setElapsed("0:00");
                setScoreProgress({
                  status: "running",
                  phase: "starting",
                  total: 0,
                  scored: 0,
                  message: `Starting… GIS homes, then public roof permits. ${HOME_AGE_INTENT_YEARS}+ years rank higher (cap ${INTENT_LEAD_CAP.toLocaleString()}).`,
                  startedAt: new Date().toISOString(),
                  error: null,
                });
                const res = await fetch(`/api/storms/${stormId}/generate-leads`, {
                  method: "POST",
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                await finishScoring(
                  stormId,
                  `Scored ${data.scored} homes (${HOME_AGE_INTENT_YEARS}+ years rank higher).`,
                  seq,
                );
              });
            }}
            className="flex-1 border border-[#3a342e] px-2 py-1.5 text-[14px] hover:border-[#d4783b] disabled:opacity-40"
          >
            {busy === "leads"
              ? scoreProgress && scoreProgress.total > 0
                ? `Scoring ${scoreProgress.scored.toLocaleString()}/${scoreProgress.total.toLocaleString()}`
                : "Finding homes…"
              : "Generate leads"}
          </button>
          <button
            disabled={!selectedStormId || Boolean(busy)}
            onClick={() => {
              const stormId = selectedStormIdRef.current;
              if (!stormId) return;
              run("trace", async () => {
                const res = await fetch(`/api/storms/${stormId}/trace`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ limit: TRACE_DEFAULT_LIMIT }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                if (selectedStormIdRef.current !== stormId) return;
                if (data.usage) setUsage(data.usage);
                else await loadUsage(stormId);
                setStatus(
                  `+${data.hits} hits / ${data.misses} misses (${formatUsd(Number(data.estimatedUsd ?? 0))}) · ${(data.alreadyHits ?? 0) + data.hits} with property info.`,
                );
                await loadLeads(stormId);
                setDetailTick((n) => n + 1);
              });
            }}
            className="flex-1 bg-[#d4783b] px-2 py-1.5 text-[14px] font-medium text-[#161412] disabled:opacity-40"
          >
            {busy === "trace"
              ? "Tracing…"
              : `Trace ${TRACE_DEFAULT_LIMIT} hits (${formatUsd(nextCost.usd)})`}
          </button>
        </div>
        {selectedStormId ? (
          <div className="border-b border-[#3a342e] px-3 py-2 text-[14px] text-[#b7aaa0]">
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
            className="border-b border-[#3a342e] px-3 py-2 text-center text-[14px] uppercase tracking-wider text-[#b7aaa0] hover:text-[#f3ece3]"
          >
            Export hits CSV
          </a>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {leads.map((lead) => (
            <button
              key={lead.id}
              onClick={() => openLead(lead.id)}
              className={`block w-full border-b border-[#3a342e] px-3 py-2 text-left ${
                lead.id === selectedLeadId ? "bg-[#2a241f]" : "hover:bg-[#1c1917]"
              }`}
            >
              <div className="flex justify-between gap-2 text-sm">
                <span className="truncate">{lead.situs_address ?? "No address"}</span>
                <span className="text-[#d4783b]">{Number(lead.score).toFixed(2)}</span>
              </div>
              <p className="truncate text-[14px] text-[#b7aaa0]">
                {lead.situs_city ?? lead.county_name ?? "DMV"} {lead.situs_zip ?? ""} ·{" "}
                {lead.county_name ?? "DMV"}
              </p>
              <p className="truncate text-[14px] text-[#b7aaa0]">
                {intentYearsLabel(lead)} · {lead.owner_name ?? "Owner pending trace"} ·{" "}
                {lead.primary_phone ?? "no phone"}
              </p>
            </button>
          ))}
        </div>
      </aside>
      <LeadModal
        open={leadModalOpen}
        lead={selectedLead}
        detail={leadDetail}
        parcelId={leadDetail?.lead.parcel_id ?? null}
        onClose={closeLead}
      />
    </div>
  );
}
