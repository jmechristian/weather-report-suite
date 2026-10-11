"use client";

import { useEffect, useId, useRef, useState } from "react";
import { REROOF_FRESH_YEARS } from "@storm-leads/core";

type Lead = {
  id?: string;
  score?: string | number | null;
  situs_address: string | null;
  situs_city: string | null;
  situs_zip: string | null;
  county_name: string | null;
  owner_name: string | null;
  year_built: number | null;
  last_reroof_year: number | null;
  primary_phone?: string | null;
  score_breakdown?: {
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
  suppressed?: boolean | null;
  consented?: boolean | null;
};

type LeadDetail = {
  lead: Lead & {
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

const FACTOR_LABELS: Record<string, string> = {
  severity: "Storm severity",
  coreProximity: "Proximity",
  homeAge: "Home age (20+ yrs)",
  roofAge: "Home age (20+ yrs)",
  ownerOccupied: "Owner-occupied",
  propertyFit: "Property type",
  sourceConfidence: "Source",
};

function intentYearsLabel(lead: Lead): string {
  const built = lead.year_built ? `built ${lead.year_built}` : "year unknown";
  return lead.last_reroof_year ? `${built} · roof ${lead.last_reroof_year}` : built;
}

function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return raw;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function FlagBadge({
  value,
  onLabel,
  offLabel,
}: {
  value: boolean | null | undefined;
  onLabel: string;
  offLabel: string;
}) {
  if (value == null) return null;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[13px] font-medium ${
        value ? "bg-[#8a3a32] text-[#f3ece3]" : "bg-[#2f5c45] text-[#d7efe3]"
      }`}
    >
      {value ? onLabel : offLabel}
    </span>
  );
}

export function LeadModal({
  open,
  lead,
  detail,
  parcelId,
  onClose,
}: {
  open: boolean;
  lead: Lead | null;
  detail: LeadDetail | null;
  parcelId?: string | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [phones, setPhones] = useState<LeadPhone[]>([]);
  const [consentBusy, setConsentBusy] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    setPhones(detail?.phones ?? []);
  }, [detail]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !lead) return null;

  const owner = detail?.lead;

  async function setConsent(phone: LeadPhone, consented: boolean) {
    if (!parcelId) return;
    setConsentBusy(phone.id);
    setConsentError(null);
    try {
      const res = await fetch("/api/messages/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.number, parcelId, consented }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not update");
      setPhones((current) =>
        current.map((item) => (item.id === phone.id ? { ...item, consented } : item)),
      );
    } catch (err) {
      setConsentError(err instanceof Error ? err.message : "Could not update");
    } finally {
      setConsentBusy(null);
    }
  }
  const ownerName = owner?.owner_name ?? lead.owner_name;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#161412]/70 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative my-4 w-full max-w-2xl rounded border border-[#3a342e] bg-[#211e1b] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#3a342e] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl leading-tight text-[#f3ece3]">
              {lead.situs_address ?? "Lead"}
            </h2>
            <p className="mt-1 text-xs text-[#b7aaa0]">
              {lead.situs_city ?? lead.county_name ?? "DMV"} {lead.situs_zip ?? ""} ·{" "}
              {lead.county_name ?? "DMV"} · {intentYearsLabel(lead)}
              {lead.last_reroof_year ? "" : ` · no reroof in ${REROOF_FRESH_YEARS} yrs`}
              {lead.score != null && lead.score !== "" && Number.isFinite(Number(lead.score))
                ? ` · ${Number(lead.score).toFixed(2)}`
                : ""}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="shrink-0 border border-[#3a342e] px-2 py-1 text-[14px] uppercase tracking-wider text-[#b7aaa0] hover:border-[#d4783b] hover:text-[#f3ece3]"
          >
            Close
          </button>
        </div>

        <div className="max-h-[min(72vh,720px)] overflow-y-auto px-5 py-4 text-sm">
          {ownerName ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-lg text-[#f3ece3]">{ownerName}</p>
              {owner?.owner_age != null ? (
                <span className="rounded bg-[#3a3458] px-1.5 py-0.5 text-[13px] text-[#d7d4ef]">
                  Age {owner.owner_age}
                </span>
              ) : null}
              {owner?.owner_dob ? (
                <span className="rounded bg-[#2a4a63] px-1.5 py-0.5 text-[13px] text-[#d4e6f3]">
                  DOB {owner.owner_dob}
                </span>
              ) : null}
              {owner?.owner_is_property_owner ? (
                <span className="rounded bg-[#2f5c45] px-1.5 py-0.5 text-[13px] font-medium text-[#d7efe3]">
                  Property Owner
                </span>
              ) : null}
              {owner?.owner_deceased ? (
                <span className="rounded bg-[#5a3a32] px-1.5 py-0.5 text-[13px] text-[#f3ece3]">
                  Deceased
                </span>
              ) : null}
              {owner?.owner_litigator ? (
                <span className="rounded bg-[#8a3a32] px-1.5 py-0.5 text-[13px] text-[#f3ece3]">
                  Litigator
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-[#b7aaa0]">Owner pending trace</p>
          )}

          {phones.length ? (
            <div className="mt-4">
              <p className="text-[13px] uppercase tracking-wider text-[#b7aaa0]">Phones</p>
              {consentError ? <p className="mt-1 text-[14px] text-[#d4783b]">{consentError}</p> : null}
              <ul className="mt-2 divide-y divide-[#3a342e] rounded border border-[#3a342e]">
                {phones.map((phone) => (
                  <li key={phone.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <a className="text-[#d4783b]" href={`tel:${phone.number}`}>
                        {formatPhoneNumber(phone.number)}
                      </a>
                      <span className="text-[14px] text-[#b7aaa0]">{phone.line_type ?? ""}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <FlagBadge value={phone.dnc} onLabel="DNC" offLabel="Clean" />
                      <FlagBadge value={phone.tcpa} onLabel="TCPA" offLabel="Clear" />
                      {phone.suppressed ? (
                        <span className="rounded bg-[#8a3a32] px-1.5 py-0.5 text-[13px] font-medium text-[#f3ece3]">
                          STOP
                        </span>
                      ) : null}
                      {parcelId &&
                      !owner?.owner_deceased &&
                      !owner?.owner_litigator &&
                      phone.line_type?.toLowerCase() === "mobile" &&
                      phone.dnc === false &&
                      phone.tcpa === false &&
                      !phone.suppressed ? (
                        <button
                          type="button"
                          disabled={consentBusy === phone.id}
                          onClick={() => setConsent(phone, !phone.consented)}
                          className={`rounded px-1.5 py-0.5 text-[13px] font-medium ${
                            phone.consented
                              ? "bg-[#d4783b] text-[#161412]"
                              : "border border-[#3a342e] text-[#b7aaa0]"
                          }`}
                        >
                          {phone.consented ? "Asked for texts" : "They asked for texts"}
                        </button>
                      ) : null}
                      {phone.carrier ? (
                        <span className="text-[14px] text-[#b7aaa0]">{phone.carrier}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : lead.primary_phone ? (
            <a className="mt-3 inline-block text-[#d4783b]" href={`tel:${lead.primary_phone}`}>
              {formatPhoneNumber(lead.primary_phone)}
            </a>
          ) : null}

          {owner?.owner_emails?.length ? (
            <div className="mt-4">
              <p className="text-[13px] uppercase tracking-wider text-[#b7aaa0]">Emails</p>
              <ul className="mt-1">
                {owner.owner_emails.map((email) => (
                  <li key={email}>
                    <a className="text-[#d4783b]" href={`mailto:${email}`}>
                      {email}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {owner?.mailing_address ? (
            <div className="mt-4">
              <p className="text-[13px] uppercase tracking-wider text-[#b7aaa0]">Mailing address</p>
              <p className="mt-1 text-[#f3ece3]">{owner.mailing_address}</p>
            </div>
          ) : null}

          {lead.score_breakdown?.factors ? (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[#b7aaa0]">
              {Object.entries(lead.score_breakdown.factors).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt>{FACTOR_LABELS[k] ?? k}</dt>
                  <dd>{v.toFixed(2)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </div>
  );
}
