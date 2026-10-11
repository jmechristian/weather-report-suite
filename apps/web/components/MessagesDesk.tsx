"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "@/app/login/actions";
import { AppNav } from "./AppNav";
import { Logo } from "./Logo";

type Reply = {
  id: string;
  phone: string;
  body: string | null;
  occurred_at: string;
  status: string | null;
  parcel_id: string | null;
  owner_name: string | null;
  situs_address: string | null;
  hot_lead: boolean | null;
  hot_hold: boolean | null;
};

type Campaign = {
  id: string;
  status: string;
  requested: number;
  sent: number;
  skipped: number;
  failed: number;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

type Volume = { phone: string; sent: number; last_sent: string };

type Desk = {
  homeowner: string;
  adminAlert: string;
  keywords: string[];
  twilioConfigured: boolean;
  sendable: number;
  alreadySent: number;
  campaigns: Campaign[];
  replies: Reply[];
  volume: Volume[];
};

function when(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MessagesDesk() {
  const [data, setData] = useState<Desk | null>(null);
  const [homeowner, setHomeowner] = useState("");
  const [adminAlert, setAdminAlert] = useState("");
  const [keywords, setKeywords] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testTemplate, setTestTemplate] = useState<"homeowner" | "admin_alert">("homeowner");
  const [includeAlreadySent, setIncludeAlreadySent] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/messages");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Failed to load messages");
    setData(body);
    setHomeowner(body.homeowner ?? "");
    setAdminAlert(body.adminAlert ?? "");
    setKeywords((body.keywords ?? []).join(", "));
  }, []);

  useEffect(() => {
    load().catch((err) => setStatus(err instanceof Error ? err.message : "Failed to load"));
  }, [load]);

  async function save() {
    setBusy("save");
    setStatus(null);
    try {
      const res = await fetch("/api/messages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeowner,
          adminAlert,
          keywords: keywords.split(",").map((word) => word.trim()).filter(Boolean),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setStatus("Saved.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    setStatus(null);
    try {
      const res = await fetch("/api/messages/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo, template: testTemplate }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Test failed");
      setStatus("Test sent.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Test failed");
    } finally {
      setBusy(null);
    }
  }

  async function sendOptedIn() {
    const count = includeAlreadySent
      ? (data?.sendable ?? 0) + (data?.alreadySent ?? 0)
      : (data?.sendable ?? 0);
    if (!count) return;
    if (!window.confirm(`Text ${count} opted-in number${count === 1 ? "" : "s"}?`)) return;
    setBusy("send");
    setStatus(null);
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeAlreadySent }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Send failed");
      setStatus(`Sent ${body.sent}. Skipped ${body.skipped}. Failed ${body.failed}.`);
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(null);
    }
  }

  async function setHot(parcelId: string, hot: boolean) {
    setBusy(parcelId);
    try {
      const res = await fetch("/api/messages/hot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcelId, hot }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not update");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(null);
    }
  }

  const sendable = data?.sendable ?? 0;
  const alreadySent = data?.alreadySent ?? 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center border-b border-[#3a342e] px-5 py-6">
        <div className="min-w-0 flex-1">
          <Logo />
        </div>
        <AppNav current="messages" />
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

      <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
        {status ? <p className="mb-4 text-sm text-[#d4783b]">{status}</p> : null}
        {!data?.twilioConfigured ? (
          <p className="mb-4 text-sm text-[#b7aaa0]">
            Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER before a text can go out.
            Point Twilio's inbound webhook at /api/webhooks/twilio, and set TWILIO_WEBHOOK_URL to that public URL.
          </p>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-2">
          <section>
            <h1 className="text-xl">Messages</h1>
            <p className="mt-2 text-sm text-[#b7aaa0]">
              Texts go only to numbers marked as asked-for on a home. {"{owner}"} and {"{address}"} fill in per home.
              The admin alert is for tests until hot-lead notices are turned on.
            </p>
            <label className="mt-4 block text-xs uppercase tracking-wider text-[#b7aaa0]">
              Homeowner text
              <textarea
                value={homeowner}
                onChange={(e) => setHomeowner(e.target.value)}
                rows={5}
                className="mt-2 w-full border border-[#3a342e] bg-[#161412] px-3 py-2 text-sm text-[#f3ece3] outline-none focus:border-[#d4783b]"
              />
            </label>
            <label className="mt-4 block text-xs uppercase tracking-wider text-[#b7aaa0]">
              Admin alert
              <textarea
                value={adminAlert}
                onChange={(e) => setAdminAlert(e.target.value)}
                rows={3}
                className="mt-2 w-full border border-[#3a342e] bg-[#161412] px-3 py-2 text-sm text-[#f3ece3] outline-none focus:border-[#d4783b]"
              />
            </label>
            <label className="mt-4 block text-xs uppercase tracking-wider text-[#b7aaa0]">
              Hot-lead words
              <input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                className="mt-2 w-full border border-[#3a342e] bg-[#161412] px-3 py-2 text-sm text-[#f3ece3] outline-none focus:border-[#d4783b]"
              />
            </label>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => save()}
              className="mt-4 border border-[#3a342e] px-3 py-1.5 text-xs uppercase tracking-wider hover:border-[#d4783b] disabled:opacity-40"
            >
              {busy === "save" ? "Saving…" : "Save messages"}
            </button>

            <div className="mt-8 border border-[#3a342e] p-4">
              <p className="text-xs uppercase tracking-wider text-[#b7aaa0]">Send a test</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="Your mobile"
                  className="border border-[#3a342e] bg-[#161412] px-3 py-1.5 text-sm outline-none focus:border-[#d4783b]"
                />
                <select
                  value={testTemplate}
                  onChange={(e) => setTestTemplate(e.target.value === "admin_alert" ? "admin_alert" : "homeowner")}
                  className="border border-[#3a342e] bg-[#161412] px-2 py-1.5 text-sm"
                >
                  <option value="homeowner">Homeowner text</option>
                  <option value="admin_alert">Admin alert</option>
                </select>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => sendTest()}
                  className="border border-[#3a342e] px-3 py-1.5 text-xs uppercase tracking-wider hover:border-[#d4783b] disabled:opacity-40"
                >
                  {busy === "test" ? "Sending…" : "Send test"}
                </button>
              </div>
            </div>

            <div className="mt-8 border border-[#3a342e] p-4">
              <p className="text-xs uppercase tracking-wider text-[#b7aaa0]">Opted-in numbers</p>
              <p className="mt-2 text-sm">
                <span className="tabular-nums text-[#d4783b]">{sendable}</span> ready
                {alreadySent ? ` · ${alreadySent} already texted` : ""}
              </p>
              <label className="mt-3 flex items-center gap-2 text-sm text-[#b7aaa0]">
                <input
                  type="checkbox"
                  checked={includeAlreadySent}
                  onChange={(e) => setIncludeAlreadySent(e.target.checked)}
                />
                Send again to numbers already texted
              </label>
              <button
                type="button"
                disabled={Boolean(busy) || (includeAlreadySent ? sendable + alreadySent : sendable) === 0}
                onClick={() => sendOptedIn()}
                className="mt-3 border border-[#d4783b] px-3 py-1.5 text-xs uppercase tracking-wider text-[#d4783b] disabled:opacity-40"
              >
                {busy === "send" ? "Sending…" : "Send texts"}
              </button>
            </div>
          </section>

          <section>
            <h2 className="text-xl">Replies</h2>
            <ul className="mt-3 divide-y divide-[#3a342e] border border-[#3a342e]">
              {(data?.replies ?? []).length === 0 ? (
                <li className="px-3 py-3 text-sm text-[#b7aaa0]">No replies yet.</li>
              ) : (
                data?.replies.map((reply) => (
                  <li key={reply.id} className="px-3 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p>{reply.owner_name ?? reply.phone}</p>
                        <p className="text-[14px] text-[#b7aaa0]">
                          {reply.situs_address ?? reply.phone} · {when(reply.occurred_at)}
                          {reply.status ? ` · ${reply.status}` : ""}
                        </p>
                        <p className="mt-1">{reply.body}</p>
                      </div>
                      {reply.parcel_id ? (
                        <button
                          type="button"
                          disabled={busy === reply.parcel_id}
                          onClick={() => setHot(reply.parcel_id!, !reply.hot_lead)}
                          className={`shrink-0 border px-2 py-1 text-[13px] uppercase tracking-wider ${
                            reply.hot_lead
                              ? "border-[#d4783b] text-[#d4783b]"
                              : "border-[#3a342e] text-[#b7aaa0]"
                          }`}
                        >
                          {reply.hot_lead ? "Hot" : "Mark hot"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))
              )}
            </ul>

            <h2 className="mt-8 text-xl">Sends</h2>
            <ul className="mt-3 text-sm text-[#b7aaa0]">
              {(data?.campaigns ?? []).map((campaign) => (
                <li key={campaign.id} className="border-t border-[#3a342e] py-2">
                  {when(campaign.started_at)} · {campaign.sent} sent · {campaign.skipped} skipped · {campaign.failed}{" "}
                  failed
                  {campaign.error ? ` · ${campaign.error}` : ""}
                </li>
              ))}
            </ul>
            <h2 className="mt-8 text-xl">By number</h2>
            <ul className="mt-3 text-sm text-[#b7aaa0]">
              {(data?.volume ?? []).map((row) => (
                <li key={row.phone} className="border-t border-[#3a342e] py-2">
                  <span className="text-[#f3ece3]">{row.phone}</span> · {row.sent} text
                  {row.sent === 1 ? "" : "s"} · last {when(row.last_sent)}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
