"use client";
import { useEffect, useState } from "react";
import {
  datePresetOptions,
  getDateRangePreset,
  type DateRangePreset,
} from "@/app/lib/dateRangePresets";
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
});
const initial = getDateRangePreset("this_month");
const cardDefs = [
  [
    "total_allocated",
    "Total Reserve Allocated",
    "All reserve sources",
    "from-blue-700 to-blue-500",
  ],
  [
    "available_reserve",
    "Available Reserve",
    "Uncommitted funding balance",
    "from-emerald-700 to-emerald-500",
  ],
  [
    "total_liability",
    "Committed Liability",
    "Earned, not yet released",
    "from-purple-800 to-purple-500",
  ],
  [
    "total_paid",
    "Released / Paid",
    "Released within selected period",
    "from-orange-700 to-orange-500",
  ],
  [
    "total_direct_retained",
    "Direct Retained",
    "Upgrade, cap, ineligible, and company-root decisions",
    "from-teal-800 to-teal-500",
  ],
  [
    "total_flashout",
    "Flashout Retained",
    "Returned to Hiroma",
    "from-red-800 to-red-500",
  ],
  [
    "total_deactivation_forfeited",
    "Deactivation Forfeited",
    "Liquidated member payables",
    "from-slate-800 to-slate-600",
  ],
  [
    "funding_shortfall",
    "Funding Shortfall",
    "Liability without funding",
    "from-rose-800 to-rose-500",
  ],
] as const;

type ReservePosition = {
  key: string;
  label: string;
  allocated: number;
  available: number;
  liability: number;
  paid: number;
  retained: number;
  flashout: number;
  forfeited: number;
  shortfall: number;
};
type ReserveMovement = {
  at: string;
  reserve_type: string;
  movement_type: string;
  reference: string;
  member_name?: string | null;
  username?: string | null;
  description: string;
  amount: number;
};
type ReserveLedgerData = {
  summary?: Record<string, number>;
  reserve_admission?: {
    mode: "monitor" | "enforce";
    status: "healthy" | "warning" | "blocked";
    allowed: boolean;
    reasons: string[];
    availableReserve: number;
    earmarkedReserve: number;
    payableLiability: number;
    coveragePercent: number;
    minimumAvailableReserve: number;
    minimumCoveragePercent: number;
    unusedPinExposure: number;
    unusedPinCount: number;
    carryoverPoints: number;
    recentEventCount: number;
    recentMaximumEventPayable: number;
    recentMaximumEventRecipients: number;
    unfundedAmount: number;
    unfundedCount: number;
  };
  integrity?: {
    unreconciled_wallets?: number;
    unsupported_positive_balance?: number;
    liability_deficit?: number;
    source_backed_liability?: number;
    wallet_balance?: number;
    unreconciled_registration_pins?: number;
    unreconciled_upgrade_pins?: number;
    unreconciled_pin_requests?: number;
    legacy_direct_referral_settlements?: number;
    unreconciled_direct_referral_settlements?: number;
    unreconciled_payouts?: number;
    legacy_product_binary_funding_lots?: number;
    legacy_product_binary_funding_amount?: number;
    legacy_deactivation_events?: number;
    unreconciled_deactivations?: number;
  };
  product_binary_jobs?: Array<{
    status: string;
    qualification_status: string;
    count: number;
    oldest?: string | null;
    last_error?: string;
  }>;
  reserves?: ReservePosition[];
  movements?: ReserveMovement[];
  error?: string;
};
export default function ReserveLedgerPage() {
  const [from, setFrom] = useState(initial.from),
    [to, setTo] = useState(initial.to),
    [preset, setPreset] = useState<DateRangePreset>("this_month"),
    [type, setType] = useState("all"),
    [data, setData] = useState<ReserveLedgerData | null>(null),
    [loading, setLoading] = useState(true);
  const load = (f = from, t = to, ty = type) => {
    setLoading(true);
    fetch(
      `/api/admin/commission-testing/reserve-ledger?from=${f}&to=${t}&type=${ty}`,
    )
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (v: DateRangePreset) => {
    setPreset(v);
    if (v === "custom") return;
    const r = getDateRangePreset(v);
    setFrom(r.from);
    setTo(r.to);
    load(r.from, r.to, type);
  };
  const s = data?.summary || {};
  return (
    <main className="mx-auto w-full max-w-[1450px] p-6 sm:p-8 text-[#0D1B3E]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-[#C9A84C]">
            Commission accounting
          </p>
          <h1 className="mt-1 text-2xl font-bold">Reserve Ledger</h1>
          <p className="mt-1 text-sm text-slate-500">
            Consolidated Direct Referral, Binary Commission, and Product Binary
            reserves.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select
            value={preset}
            onChange={(e) => choose(e.target.value as DateRangePreset)}
            className="rounded-lg border bg-white px-3 py-2 text-sm"
          >
            {datePresetOptions.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
          {preset === "custom" && (
            <>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-lg border px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-lg border px-3 py-2 text-sm"
              />
            </>
          )}
          <button
            onClick={() => load()}
            className="rounded-lg bg-[#0D1B3E] px-4 py-2 text-sm font-semibold text-white"
          >
            Apply filter
          </button>
        </div>
      </header>
      {data?.error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {data.error}
        </div>
      )}
      {!loading && data?.reserve_admission && (
        <section className={
          data.reserve_admission.status === "healthy"
            ? "mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"
            : data.reserve_admission.status === "blocked"
              ? "mt-5 rounded-2xl border border-rose-300 bg-rose-50 p-5"
              : "mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5"
        }>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-bold">Binary reserve admission monitor</h2>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Read-only operational health. It does not change package points,
                commissions, daily caps, or existing balances.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase shadow-sm">
              {data.reserve_admission.mode} · {data.reserve_admission.status}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-slate-500">Available for new pairs</p>
              <p className="mt-1 text-xl font-black">{peso.format(data.reserve_admission.availableReserve)}</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-slate-500">Earmarked for earned binary</p>
              <p className="mt-1 text-xl font-black">{peso.format(data.reserve_admission.earmarkedReserve)}</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-slate-500">Payable binary liability</p>
              <p className="mt-1 text-xl font-black">{peso.format(data.reserve_admission.payableLiability)}</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-slate-500">Protected coverage</p>
              <p className="mt-1 text-xl font-black">{data.reserve_admission.coveragePercent.toFixed(2)}%</p>
              <p className="text-xs text-slate-500">Policy minimum {data.reserve_admission.minimumCoveragePercent}%</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-slate-500">Unused PIN allocation exposure</p>
              <p className="mt-1 text-xl font-black">{peso.format(data.reserve_admission.unusedPinExposure)}</p>
              <p className="text-xs text-slate-500">{data.reserve_admission.unusedPinCount} unused PINs</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-slate-500">Carryover waiting for opposite leg</p>
              <p className="mt-1 text-xl font-black">{Math.round(data.reserve_admission.carryoverPoints).toLocaleString("en-PH")} pts</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-slate-500">Largest event, last 30 days</p>
              <p className="mt-1 text-xl font-black">{peso.format(data.reserve_admission.recentMaximumEventPayable)}</p>
              <p className="text-xs text-slate-500">Up to {data.reserve_admission.recentMaximumEventRecipients} recipients</p>
            </div>
            <div className="rounded-xl bg-white p-4">
              <p className="text-xs text-slate-500">Historical unfunded records</p>
              <p className="mt-1 text-xl font-black text-rose-700">{peso.format(data.reserve_admission.unfundedAmount)}</p>
              <p className="text-xs text-slate-500">{data.reserve_admission.unfundedCount} records</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-600">
            {data.reserve_admission.mode === "monitor"
              ? "Monitor-only: warnings are visible but PIN issuance continues. Enable enforcement only after Finance approves the thresholds."
              : "Enforced: new PIN issuance or release pauses when this policy is breached; existing member data is not altered."}
          </p>
          {data.reserve_admission.reasons.length > 0 && (
            <p className="mt-2 text-xs font-semibold text-amber-800">
              Signals: {data.reserve_admission.reasons.join(", ")}
            </p>
          )}
        </section>
      )}
      {!loading && data?.integrity && (
        <section className={`mt-5 rounded-2xl border p-5 ${
          Number(data.integrity.unreconciled_wallets || 0) > 0 ||
          Number(data.integrity.unreconciled_registration_pins || 0) > 0 ||
          Number(data.integrity.unreconciled_upgrade_pins || 0) > 0 ||
          Number(data.integrity.unreconciled_pin_requests || 0) > 0 ||
          Number(data.integrity.legacy_direct_referral_settlements || 0) > 0 ||
          Number(data.integrity.unreconciled_direct_referral_settlements || 0) > 0 ||
           Number(data.integrity.unreconciled_payouts || 0) > 0 ||
          Number(data.integrity.legacy_product_binary_funding_lots || 0) > 0 ||
          Number(data.integrity.legacy_deactivation_events || 0) > 0 ||
          Number(data.integrity.unreconciled_deactivations || 0) > 0 ||
          (data.product_binary_jobs || []).length > 0
            ? "border-amber-300 bg-amber-50"
            : "border-emerald-200 bg-emerald-50"
        }`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-bold">Financial integrity monitor</h2>
              <p className="mt-1 text-sm text-slate-600">
                Wallets reconcile against payable source lots; delivered Product Binary obligations stay queued until settled.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase shadow-sm">
              {Number(data.integrity.unreconciled_wallets || 0) === 0 &&
              Number(data.integrity.unreconciled_registration_pins || 0) === 0 &&
              Number(data.integrity.unreconciled_upgrade_pins || 0) === 0 &&
              Number(data.integrity.unreconciled_pin_requests || 0) === 0 &&
              Number(data.integrity.legacy_direct_referral_settlements || 0) === 0 &&
              Number(data.integrity.unreconciled_direct_referral_settlements || 0) === 0 &&
               Number(data.integrity.unreconciled_payouts || 0) === 0 &&
              Number(data.integrity.legacy_product_binary_funding_lots || 0) === 0 &&
              Number(data.integrity.legacy_deactivation_events || 0) === 0 &&
              Number(data.integrity.unreconciled_deactivations || 0) === 0 &&
              (data.product_binary_jobs || []).length === 0 ? "Clear" : "Attention required"}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Unreconciled wallets</p><p className="mt-1 text-xl font-black">{data.integrity.unreconciled_wallets || 0}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Unsupported balance</p><p className="mt-1 text-xl font-black">{peso.format(data.integrity.unsupported_positive_balance || 0)}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Liability deficit</p><p className="mt-1 text-xl font-black text-rose-700">{peso.format(data.integrity.liability_deficit || 0)}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Pending/failed settlements</p><p className="mt-1 text-xl font-black">{(data.product_binary_jobs || []).reduce((n, row) => n + Number(row.count || 0), 0)}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Legacy PINs to reconcile</p><p className="mt-1 text-xl font-black text-amber-700">{data.integrity.unreconciled_registration_pins || 0}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Legacy Upgrade PINs to cancel/reissue</p><p className="mt-1 text-xl font-black text-amber-700">{data.integrity.unreconciled_upgrade_pins || 0}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Legacy PIN requests to reconcile</p><p className="mt-1 text-xl font-black text-amber-700">{data.integrity.unreconciled_pin_requests || 0}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Legacy Direct Referral decisions</p><p className="mt-1 text-xl font-black text-amber-700">{data.integrity.legacy_direct_referral_settlements || 0}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Direct Referral settlement mismatches</p><p className="mt-1 text-xl font-black text-rose-700">{data.integrity.unreconciled_direct_referral_settlements || 0}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Payout lifecycle mismatches</p><p className="mt-1 text-xl font-black text-rose-700">{data.integrity.unreconciled_payouts || 0}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Legacy Product Binary sources quarantined</p><p className="mt-1 text-xl font-black text-amber-700">{data.integrity.legacy_product_binary_funding_lots || 0}</p><p className="text-xs text-slate-500">{peso.format(data.integrity.legacy_product_binary_funding_amount || 0)} historical gross allocation</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Legacy deactivations to reconcile</p><p className="mt-1 text-xl font-black text-amber-700">{data.integrity.legacy_deactivation_events || 0}</p></div>
            <div className="rounded-xl bg-white p-4"><p className="text-xs text-slate-500">Deactivation lifecycle mismatches</p><p className="mt-1 text-xl font-black text-rose-700">{data.integrity.unreconciled_deactivations || 0}</p></div>
          </div>
          {(data.product_binary_jobs || []).map((job) => (
            <p key={`${job.status}:${job.qualification_status}`} className="mt-3 text-xs text-slate-600">
              <strong className="uppercase">{job.status} · {job.qualification_status}</strong>: {job.count}
              {job.oldest ? ` · oldest ${new Date(job.oldest).toLocaleString("en-PH")}` : ""}
              {job.last_error ? ` · ${job.last_error}` : ""}
            </p>
          ))}
        </section>
      )}
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {cardDefs.map(([key, label, note, bg]) => (
          <article
            key={key}
            className={`min-h-36 rounded-2xl bg-gradient-to-br ${bg} p-5 text-white shadow-sm`}
          >
            <p className="text-xs font-bold uppercase tracking-wide text-white/85">
              {label}
            </p>
            <p className="mt-3 text-2xl font-black">
              {loading ? "…" : peso.format(s[key] || 0)}
            </p>
            <p className="mt-2 text-xs text-white/80">{note}</p>
          </article>
        ))}
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-bold">Reserve Position by Commission Type</h2>
          <p className="text-xs text-slate-500">
            Categories remain separate; consolidated totals do not remove their
            identity.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {[
                  "Reserve type",
                  "Allocated",
                  "Available",
                  "Committed liability",
                  "Released",
                  "Direct retained",
                  "Flashout",
                  "Deactivation forfeited",
                  "Shortfall",
                ].map((x) => (
                  <th key={x} className="px-5 py-3">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.reserves || []).map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="px-5 py-4 font-bold">{r.label}</td>
                  <td className="px-5">{peso.format(r.allocated)}</td>
                  <td className="px-5 text-emerald-700">
                    {peso.format(r.available)}
                  </td>
                  <td className="px-5 text-purple-700">
                    {peso.format(r.liability)}
                  </td>
                  <td className="px-5">{peso.format(r.paid)}</td>
                  <td className="px-5 text-teal-700">
                    {peso.format(r.retained)}
                  </td>
                  <td className="px-5 text-red-600">
                    {peso.format(r.flashout)}
                  </td>
                  <td className="px-5 text-slate-700">
                    {peso.format(r.forfeited)}
                  </td>
                  <td className="px-5 font-semibold text-rose-700">
                    {peso.format(r.shortfall)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
          <div>
            <h2 className="font-bold">Reserve Movement Ledger</h2>
            <p className="text-xs text-slate-500">
              Source-level allocation, commitment, release, and flashout
              records.
            </p>
          </div>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              load(from, to, e.target.value);
            }}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="all">All reserves</option>
            <option value="direct_referral">Direct Referral</option>
            <option value="binary">Binary Commission</option>
            <option value="product_binary">Product Binary</option>
          </select>
        </div>
        <div className="max-h-[550px] overflow-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {[
                  "Date",
                  "Reserve type",
                  "Movement",
                  "Reference",
                  "Member",
                  "Description",
                  "Amount",
                ].map((x) => (
                  <th key={x} className="px-4 py-3">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.movements || []).map((r, i) => (
                <tr key={`${r.reference}-${i}`} className="border-t">
                  <td className="px-4 py-3">
                    {new Date(r.at).toLocaleString("en-PH")}
                  </td>
                  <td className="px-4 font-semibold">
                    {String(r.reserve_type).replaceAll("_", " ")}
                  </td>
                  <td className="px-4">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs uppercase">
                      {r.movement_type}
                    </span>
                  </td>
                  <td className="px-4 font-mono text-xs">{r.reference}</td>
                  <td className="px-4">
                    {r.member_name || "Company"}
                    {r.username && (
                      <small className="block text-slate-400">
                        @{r.username}
                      </small>
                    )}
                  </td>
                  <td className="px-4 text-slate-600">{r.description}</td>
                  <td className="px-4 font-bold">{peso.format(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
