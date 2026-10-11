"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUsd } from "@storm-leads/core";
import { signOut } from "@/app/login/actions";
import { AppNav } from "./AppNav";
import { Logo } from "./Logo";
import { LeadModal } from "./LeadModal";

type TracedRow = {
  id: string;
  situs_address: string | null;
  situs_city: string | null;
  situs_zip: string | null;
  county_name: string;
  owner_name: string | null;
  owner_age: number | null;
  phone_count: number;
  dnc_count: number;
  tcpa_count: number;
  stopped_count: number;
  best_mobile: string | null;
  sms_eligible: boolean;
  hot_lead: boolean;
  opted_in_count: number;
  last_traced_at: string | null;
  last_reached_at: string | null;
  storm_count: number;
  last_storm_at: string | null;
  year_built: number | null;
  last_reroof_year: number | null;
};

type ParcelDetail = {
  parcel: TracedRow & {
    owner_dob: string | null;
    owner_is_property_owner: boolean | null;
    owner_deceased: boolean | null;
    owner_litigator: boolean | null;
    mailing_address: string | null;
    owner_emails: string[] | null;
  };
  phones: Array<{
    id: string;
    number: string;
    line_type: string | null;
    carrier: string | null;
    dnc: boolean | null;
    tcpa: boolean | null;
    suppressed: boolean;
  }>;
  latestLead: {
    score: string | number;
    score_breakdown: { factors?: Record<string, number> } | null;
    event_type: string;
    occurred_at: string;
  } | null;
};

type ListResponse = {
  parcels: TracedRow[];
  total: number;
  limit: number;
  offset: number;
  counties: Array<{ fips: string; name: string }>;
};

function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return raw;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function when(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export function TracedList() {
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [county, setCounty] = useState("");
  const [smsOnly, setSmsOnly] = useState(false);
  const [neverOnly, setNeverOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [spend, setSpend] = useState<{ usd: number; credits: number } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ParcelDetail | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ((prev) => {
        const next = qInput.trim();
        if (prev !== next) setOffset(0);
        return next;
      });
    }, 300);
    return () => window.clearTimeout(t);
  }, [qInput]);

  const query = useMemo(() => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (county) sp.set("county", county);
    if (smsOnly) sp.set("sms", "1");
    if (neverOnly) sp.set("never", "1");
    sp.set("limit", "50");
    sp.set("offset", String(offset));
    return sp.toString();
  }, [q, county, smsOnly, neverOnly, offset]);

  const exportHref = useMemo(() => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (county) sp.set("county", county);
    if (smsOnly) sp.set("sms", "1");
    if (neverOnly) sp.set("never", "1");
    const qs = sp.toString();
    return qs ? `/api/traced/export?${qs}` : "/api/traced/export";
  }, [q, county, smsOnly, neverOnly]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/traced?${query}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load traced homes");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load traced homes");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    fetch("/api/usage")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) return;
        setSpend({
          usd: Number(body.allTime?.usd ?? 0),
          credits: Number(body.allTime?.credits ?? 0),
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/parcels/${openId}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load parcel");
        if (!cancelled) setDetail(body);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  const rows = data?.parcels ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 50;
  const selected = rows.find((r) => r.id === openId) ?? detail?.parcel ?? null;
  const modalHome = selected
    ? {
        ...selected,
        county_name: selected.county_name,
        score: detail?.latestLead?.score ?? null,
        score_breakdown: detail?.latestLead?.score_breakdown ?? null,
        owner_name: detail?.parcel.owner_name ?? selected.owner_name,
      }
    : null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center border-b border-[#3a342e] px-5 py-6">
        <div className="min-w-0 flex-1">
          <Logo className="block h-20 w-auto" />
        </div>
        <AppNav current="traced" />
        <div className="flex min-w-0 flex-1 items-center justify-end gap-5">
          <div className="text-right">
            <p className="text-[13px] tracking-[0.18em] text-[#b7aaa0] uppercase">Skip-trace spend</p>
            <p className="text-lg leading-none tabular-nums text-[#d4783b]">{formatUsd(spend?.usd ?? 0)}</p>
            <p className="mt-1 text-[13px] text-[#b7aaa0]">{spend?.credits ?? 0} credits</p>
          </div>
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

      <div className="flex flex-wrap items-center gap-3 border-b border-[#3a342e] px-5 py-3 text-xs">
        <input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Search name, address, phone"
          className="w-64 border border-[#3a342e] bg-[#161412] px-2 py-1.5 text-[#f3ece3] outline-none focus:border-[#d4783b]"
        />
        <select
          value={county}
          onChange={(e) => {
            setOffset(0);
            setCounty(e.target.value);
          }}
          className="border border-[#3a342e] bg-[#161412] px-2 py-1.5 text-[#f3ece3]"
        >
          <option value="">All counties</option>
          {(data?.counties ?? []).map((c) => (
            <option key={c.fips} value={c.fips}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[#b7aaa0]">
          <input
            type="checkbox"
            checked={smsOnly}
            onChange={(e) => {
              setOffset(0);
              setSmsOnly(e.target.checked);
            }}
          />
          SMS-eligible
        </label>
        <label className="flex items-center gap-1.5 text-[#b7aaa0]">
          <input
            type="checkbox"
            checked={neverOnly}
            onChange={(e) => {
              setOffset(0);
              setNeverOnly(e.target.checked);
            }}
          />
          Never contacted
        </label>
        <div className="ml-auto flex items-center gap-3">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-[#3a342e] bg-[#211e1b] px-3 py-1">
            <span className="tabular-nums text-[#d4783b]">
              {loading ? "…" : total.toLocaleString()}
            </span>
            <span className="uppercase tracking-wider text-[#b7aaa0]">total</span>
          </p>
          <a
            href={exportHref}
            className="uppercase tracking-wider text-[#b7aaa0] hover:text-[#f3ece3]"
          >
            Export CSV
          </a>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? <p className="px-5 py-4 text-sm text-[#d4783b]">{error}</p> : null}
        {!error && !loading && rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-[#b7aaa0]">
            No traced homes yet. Generate leads on a storm, then Trace.
          </p>
        ) : null}
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#211e1b] text-[13px] uppercase tracking-wider text-[#b7aaa0]">
            <tr>
              <th className="px-5 py-2 font-medium">Address</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Phones</th>
              <th className="px-3 py-2 font-medium">SMS</th>
              <th className="px-3 py-2 font-medium">Reached</th>
              <th className="px-3 py-2 font-medium">Storms</th>
              <th className="px-5 py-2 font-medium">Traced</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => setOpenId(row.id)}
                className={`cursor-pointer border-t border-[#3a342e] hover:bg-[#1c1917] ${
                  row.id === openId ? "bg-[#2a241f]" : ""
                }`}
              >
                <td className="px-5 py-2">
                  <p className="text-[#f3ece3]">{row.situs_address ?? "No address"}</p>
                  <p className="text-[14px] text-[#b7aaa0]">
                    {row.situs_city ?? row.county_name} {row.situs_zip ?? ""} · {row.county_name}
                  </p>
                </td>
                <td className="px-3 py-2">
                  <p className="flex items-center gap-2">
                    <span>{row.owner_name ?? "—"}</span>
                    {row.hot_lead ? (
                      <span className="rounded bg-[#d4783b] px-1.5 py-0.5 text-[13px] font-medium text-[#161412]">
                        Hot
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[14px] text-[#b7aaa0]">{row.owner_age != null ? `Age ${row.owner_age}` : ""}</p>
                </td>
                <td className="px-3 py-2 text-[14px] text-[#b7aaa0]">
                  <p>{row.phone_count} numbers</p>
                  <p>
                    {row.best_mobile ? formatPhoneNumber(row.best_mobile) : "no clean mobile"}
                    {row.dnc_count ? ` · ${row.dnc_count} DNC` : ""}
                    {row.stopped_count ? ` · ${row.stopped_count} STOP` : ""}
                  </p>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[13px] font-medium ${
                      row.sms_eligible ? "bg-[#2f5c45] text-[#d7efe3]" : "bg-[#3a342e] text-[#b7aaa0]"
                    }`}
                  >
                    {row.sms_eligible ? "Eligible" : "Blocked"}
                  </span>
                  {row.opted_in_count > 0 ? (
                    <p className="mt-1 text-[13px] text-[#d4783b]">Asked for texts</p>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-[14px] text-[#b7aaa0]">
                  {row.last_reached_at ? when(row.last_reached_at) : "Never"}
                </td>
                <td className="px-3 py-2 text-[14px] text-[#b7aaa0]">
                  {row.storm_count}
                  {row.last_storm_at ? ` · ${when(row.last_storm_at)}` : ""}
                </td>
                <td className="px-5 py-2 text-[14px] text-[#b7aaa0]">{when(row.last_traced_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-[#3a342e] px-5 py-2 text-[14px] text-[#b7aaa0]">
        <p>
          {loading ? "Loading…" : `${total.toLocaleString()} traced homes`}
          {smsOnly ? " · SMS-eligible" : ""}
        </p>
        <div className="flex gap-2">
          <button
            disabled={offset <= 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="border border-[#3a342e] px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
            className="border border-[#3a342e] px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <LeadModal
        open={Boolean(openId && modalHome)}
        lead={modalHome}
        parcelId={openId}
        detail={
          detail
            ? {
                lead: {
                  ...detail.parcel,
                  score: detail.latestLead?.score ?? null,
                  score_breakdown: detail.latestLead?.score_breakdown ?? null,
                },
                phones: detail.phones,
              }
            : null
        }
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
