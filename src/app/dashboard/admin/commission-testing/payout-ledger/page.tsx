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
  }),
  initial = getDateRangePreset("this_month");
const cards = [
  [
    "total_requested",
    "Total Payout Activity",
    "All requests in period",
    "from-blue-700 to-blue-500",
  ],
  ["pending", "Pending", "Awaiting review", "from-amber-700 to-amber-500"],
  [
    "approved",
    "Approved",
    "Committed, not released",
    "from-sky-700 to-sky-500",
  ],
  [
    "released",
    "Released / Paid",
    "Actual cash outflow",
    "from-emerald-700 to-emerald-500",
  ],
  ["rejected", "Rejected", "Declined requests", "from-red-800 to-red-500"],
  [
    "unallocated",
    "Unallocated Source",
    "Wallet amount without source split",
    "from-purple-800 to-purple-500",
  ],
] as const;

type PayoutRow = {
  id: string;
  event_at: string;
  transaction_number?: string | null;
  full_name: string;
  username: string;
  amount: number;
  direct_referral: number;
  binary: number;
  product_binary: number;
  unallocated: number;
  status: string;
  payment_method?: string | null;
  payment_reference?: string | null;
};
type PayoutLedgerData = {
  summary?: Record<string, number>;
  payouts?: PayoutRow[];
  error?: string;
};
export default function PayoutLedgerPage() {
  const [from, setFrom] = useState(initial.from),
    [to, setTo] = useState(initial.to),
    [preset, setPreset] = useState<DateRangePreset>("this_month"),
    [status, setStatus] = useState("all"),
    [source, setSource] = useState("all"),
    [search, setSearch] = useState(""),
    [data, setData] = useState<PayoutLedgerData | null>(null),
    [loading, setLoading] = useState(true);
  const load = (f = from, t = to) => {
    setLoading(true);
    fetch(
      `/api/admin/commission-testing/payout-ledger?from=${f}&to=${t}&status=${status}&source=${source}&search=${encodeURIComponent(search)}`,
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
    setTimeout(() => load(r.from, r.to), 0);
  };
  const s = data?.summary || {};
  return (
    <main className="mx-auto w-full max-w-[1500px] p-6 sm:p-8 text-[#0D1B3E]">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-[#C9A84C]">
            Commission accounting
          </p>
          <h1 className="mt-1 text-2xl font-bold">Payout Ledger</h1>
          <p className="mt-1 text-sm text-slate-500">
            Trace every withdrawal from request through approval and actual
            release.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select
            value={preset}
            onChange={(e) => choose(e.target.value as DateRangePreset)}
            className="rounded-lg border px-3 py-2 text-sm"
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
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map(([key, label, note, bg]) => (
          <article
            key={key}
            className={`min-h-36 rounded-2xl bg-gradient-to-br ${bg} p-5 text-white shadow-sm`}
          >
            <p className="text-xs font-bold uppercase text-white/85">{label}</p>
            <p className="mt-3 text-2xl font-black">
              {loading ? "…" : peso.format(s[key] || 0)}
            </p>
            <p className="mt-2 text-xs text-white/80">{note}</p>
          </article>
        ))}
      </section>
      <section className="mt-5 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transaction, member, username, reference..."
            className="rounded-lg border px-3 py-2 text-sm"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="released">Released</option>
            <option value="rejected">Rejected</option>
          </select>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="all">All sources</option>
            <option value="direct_referral">Direct Referral</option>
            <option value="binary">Binary Commission</option>
            <option value="product_binary">Product Binary</option>
          </select>
          <button
            onClick={() => load()}
            className="rounded-lg bg-[#0D1B3E] px-4 py-2 text-sm font-semibold text-white"
          >
            Search
          </button>
        </div>
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-bold">Payout Source Breakdown</h2>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
            <p className="rounded-xl bg-emerald-50 p-3">
              Direct Referral
              <br />
              <b>{peso.format(s.direct_referral || 0)}</b>
            </p>
            <p className="rounded-xl bg-blue-50 p-3">
              Binary Commission
              <br />
              <b>{peso.format(s.binary || 0)}</b>
            </p>
            <p className="rounded-xl bg-purple-50 p-3">
              Product Binary
              <br />
              <b>{peso.format(s.product_binary || 0)}</b>
            </p>
            <p className="rounded-xl bg-amber-50 p-3">
              Unallocated / Other
              <br />
              <b>{peso.format(s.unallocated || 0)}</b>
            </p>
          </div>
        </div>
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {[
                  "Event date",
                  "Transaction",
                  "Member",
                  "Amount",
                  "Direct",
                  "Binary",
                  "Product Binary",
                  "Other",
                  "Status",
                  "Method / reference",
                ].map((x) => (
                  <th key={x} className="px-4 py-3">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.payouts || []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3">
                    {new Date(r.event_at).toLocaleString("en-PH")}
                  </td>
                  <td className="px-4 font-mono text-xs">
                    {r.transaction_number || r.id.slice(0, 12)}
                  </td>
                  <td className="px-4 font-semibold">
                    {r.full_name}
                    <small className="block text-slate-400">
                      @{r.username}
                    </small>
                  </td>
                  <td className="px-4 font-bold">{peso.format(r.amount)}</td>
                  <td className="px-4">{peso.format(r.direct_referral)}</td>
                  <td className="px-4">{peso.format(r.binary)}</td>
                  <td className="px-4">{peso.format(r.product_binary)}</td>
                  <td className="px-4">{peso.format(r.unallocated)}</td>
                  <td className="px-4">
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${r.status === "released" ? "bg-emerald-100 text-emerald-700" : r.status === "approved" ? "bg-sky-100 text-sky-700" : r.status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4">
                    {r.payment_method || "—"}
                    <small className="block text-slate-400">
                      {r.payment_reference || "No reference"}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
