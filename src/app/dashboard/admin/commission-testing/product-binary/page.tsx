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
const cards = [
  [
    "eligible_units",
    "Total Products Sold",
    "Eligible Admin product sales",
    "emerald",
  ],
  [
    "completed_pairs",
    "Total Product Pairs",
    "2 PU left + 2 PU right = 1 pair",
    "blue",
  ],
  [
    "product_binary_allocation",
    "Product Binary Reserve",
    "₱20 maximum allocated per eligible product",
    "purple",
  ],
  ["paid", "Product Binary Paid", "Released Product Binary payouts", "orange"],
  [
    "total_flashout",
    "Product Binary Flashout",
    "Cap or inactive excess retained by Hiroma",
    "red",
  ],
  ["average_rate", "Average Pair Rate", "Rank-based rate; maximum ₱20", "sky"],
] as const;
const bg: Record<string, string> = {
  emerald: "from-emerald-700 to-emerald-500",
  blue: "from-blue-700 to-blue-500",
  indigo: "from-indigo-800 to-indigo-500",
  amber: "from-amber-700 to-amber-500",
  sky: "from-sky-700 to-sky-500",
  orange: "from-orange-700 to-orange-500",
  purple: "from-purple-800 to-purple-500",
  red: "from-red-800 to-red-500",
  teal: "from-teal-800 to-teal-500",
  green: "from-green-800 to-green-500",
};
type ProductBinaryRank = {
  rank_name: string;
  pair_rate: number;
  members: number;
  completed_pairs: number;
  payable_pairs: number;
  earned: number;
  flashout_pairs: number;
  flashout: number;
};
type ProductBinaryLedgerRow = {
  id: string;
  created_at: string;
  recipient_name: string;
  recipient_username: string;
  source_name: string;
  source_leg: string;
  package_name_snapshot: string;
  rank_name_snapshot: string;
  source_pu: number;
  completed_pairs: number;
  pair_rate_amount: number;
  payable_amount: number;
  flashout_amount: number;
  closing_left_pu: number;
  closing_right_pu: number;
};
type ProductBinaryData = {
  summary?: Record<string, number>;
  ranks?: ProductBinaryRank[];
  ledger?: ProductBinaryLedgerRow[];
  error?: string;
  migration_required?: string;
};
export default function ProductBinaryPage() {
  const [from, setFrom] = useState(initial.from),
    [to, setTo] = useState(initial.to),
    [preset, setPreset] = useState<DateRangePreset>("this_month");
  const [data, setData] = useState<ProductBinaryData | null>(null),
    [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    fetch(`/api/admin/commission-testing/product-binary?from=${from}&to=${to}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then((x) => setData(x.body))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const applyPreset = (v: DateRangePreset) => {
    setPreset(v);
    if (v === "custom") return;
    const r = getDateRangePreset(v);
    setFrom(r.from);
    setTo(r.to);
    setTimeout(() => {
      fetch(
        `/api/admin/commission-testing/product-binary?from=${r.from}&to=${r.to}`,
      )
        .then((r) => r.json())
        .then(setData);
    }, 0);
  };
  const s = data?.summary || {};
  return (
    <main className="mx-auto w-full max-w-[1500px] p-5 sm:p-8 text-[#0D1B3E]">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-[#C99A27]">
            Commission accounting
          </p>
          <h1 className="mt-1 text-2xl font-bold">Product Binary</h1>
          <p className="mt-1 text-sm text-slate-500">
            Audit product PU, rank-based pairs, liability, payouts, carryover,
            margin, and Hiroma flashout.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select
            value={preset}
            onChange={(e) => applyPreset(e.target.value as DateRangePreset)}
            className="rounded-lg border bg-white px-3 py-2 text-sm"
          >
            {datePresetOptions.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
          <label className="text-xs">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setPreset("custom");
                setFrom(e.target.value);
              }}
              className="block rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setPreset("custom");
                setTo(e.target.value);
              }}
              className="block rounded-lg border px-3 py-2 text-sm"
            />
          </label>
          <button
            onClick={load}
            className="rounded-lg bg-[#0D1B3E] px-4 py-2.5 text-sm font-semibold text-white"
          >
            Apply filter
          </button>
        </div>
      </div>
      {data?.error && (
        <div className="mt-5 rounded-xl border border-red-300 bg-red-50 p-4 text-red-700">
          {data.error} Run migration: {data.migration_required}
        </div>
      )}
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map(([key, label, note, color]) => (
          <article
            key={key}
            className={`min-h-36 rounded-2xl bg-gradient-to-br ${bg[color]} p-5 text-white shadow-sm`}
          >
            <p className="text-xs font-bold uppercase tracking-wide text-white/85">
              {label}
            </p>
            <p className="mt-3 text-2xl font-black">
              {loading
                ? "…"
                : ["eligible_units", "completed_pairs"].includes(key)
                  ? Number(s[key] || 0).toLocaleString()
                  : peso.format(s[key] || 0)}
            </p>
            <p className="mt-2 text-xs leading-5 text-white/80">{note}</p>
          </article>
        ))}
      </section>
      <section className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-bold">Carry-over Product Units</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-xs text-slate-500">Left PU</p>
              <b className="text-xl">
                {Number(s.left_carryover_pu || 0).toLocaleString()}
              </b>
            </div>
            <div className="rounded-xl bg-blue-50 p-4">
              <p className="text-xs text-slate-500">Right PU</p>
              <b className="text-xl">
                {Number(s.right_carryover_pu || 0).toLocaleString()}
              </b>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Unpaired PU carries forward. It is volume, not cash liability.
          </p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="font-bold">
            Product Binary Reserve & Accounting Breakdown
          </h2>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <p className="rounded-xl bg-slate-50 p-3">
              <span className="text-slate-500">Opening available reserve</span>
              <br />
              <b>{peso.format(s.opening_available_fund || 0)}</b>
            </p>
            <p className="rounded-xl bg-purple-50 p-3">
              <span className="text-slate-500">New ₱20 allocations</span>
              <br />
              <b>{peso.format(s.product_binary_allocation || 0)}</b>
            </p>
            <p className="rounded-xl bg-indigo-50 p-3">
              <span className="text-slate-500">Product Binary earned</span>
              <br />
              <b>{peso.format(s.earned || 0)}</b>
            </p>
            <p className="rounded-xl bg-emerald-50 p-3">
              <span className="text-slate-500">Closing available reserve</span>
              <br />
              <b>{peso.format(s.available_fund || 0)}</b>
            </p>
            <p className="rounded-xl bg-sky-50 p-3">
              <span className="text-slate-500">Approved, unreleased</span>
              <br />
              <b>{peso.format(s.approved || 0)}</b>
            </p>
            <p className="rounded-xl bg-amber-50 p-3">
              <span className="text-slate-500">Outstanding liability</span>
              <br />
              <b>{peso.format(s.payable_liability || 0)}</b>
            </p>
            <p className="rounded-xl bg-green-50 p-3">
              <span className="text-slate-500">Clean Hiroma margin</span>
              <br />
              <b>{peso.format(s.clean_product_margin || 0)}</b>
            </p>
            <p
              className={`rounded-xl p-3 ${(s.funding_coverage || 0) < 0 ? "bg-red-50 text-red-700" : "bg-teal-50 text-teal-800"}`}
            >
              <span>Reserve coverage</span>
              <br />
              <b>{peso.format(s.funding_coverage || 0)}</b>
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-xs text-slate-500">
            <span>
              Cap flashout pairs: <b>{s.cap_flashout_pairs || 0}</b>
            </span>
            <span>
              Inactive flashout pairs: <b>{s.inactive_flashout_pairs || 0}</b>
            </span>
            <span>
              Funding shortfall created:{" "}
              <b>{peso.format(s.unfunded_usage || 0)}</b>
            </span>
          </div>
        </div>
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-bold">Pairing Summary by Rank</h2>
          <p className="text-xs text-slate-500">
            Exact rate snapshot used when each pair completed.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {[
                  "Rank",
                  "Pair rate",
                  "Members",
                  "Completed",
                  "Payable",
                  "Earned",
                  "Flashout pairs",
                  "Flashout",
                ].map((x) => (
                  <th key={x} className="px-4 py-3">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.ranks || []).map((r) => (
                <tr key={r.rank_name} className="border-t">
                  <td className="px-4 py-3 font-semibold">{r.rank_name}</td>
                  <td className="px-4">{peso.format(r.pair_rate)}</td>
                  <td className="px-4">{r.members}</td>
                  <td className="px-4">{r.completed_pairs}</td>
                  <td className="px-4">{r.payable_pairs}</td>
                  <td className="px-4">{peso.format(r.earned)}</td>
                  <td className="px-4">{r.flashout_pairs}</td>
                  <td className="px-4">{peso.format(r.flashout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b p-5">
          <h2 className="font-bold">Exact Product Binary Audit Ledger</h2>
          <p className="text-xs text-slate-500">
            One immutable row per affected upline and triggering delivered
            order.
          </p>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                {[
                  "Date",
                  "Receiver",
                  "Source / leg",
                  "Package / rank",
                  "PU",
                  "Pairs",
                  "Rate",
                  "Payable",
                  "Flashout",
                  "Closing L/R",
                ].map((x) => (
                  <th key={x} className="px-4 py-3">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.ledger || []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-3">
                    {new Date(r.created_at).toLocaleString("en-PH")}
                  </td>
                  <td className="px-4 font-semibold">
                    {r.recipient_name}
                    <small className="block text-slate-400">
                      @{r.recipient_username}
                    </small>
                  </td>
                  <td className="px-4">
                    {r.source_name}
                    <small className="block uppercase text-slate-400">
                      {r.source_leg}
                    </small>
                  </td>
                  <td className="px-4">
                    {r.package_name_snapshot}
                    <small className="block text-slate-400">
                      {r.rank_name_snapshot}
                    </small>
                  </td>
                  <td className="px-4">{r.source_pu}</td>
                  <td className="px-4">{r.completed_pairs}</td>
                  <td className="px-4">{peso.format(r.pair_rate_amount)}</td>
                  <td className="px-4 text-emerald-700">
                    {peso.format(r.payable_amount)}
                  </td>
                  <td className="px-4 text-red-600">
                    {peso.format(r.flashout_amount)}
                  </td>
                  <td className="px-4">
                    {r.closing_left_pu} / {r.closing_right_pu}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {Number(s.legacy_events || 0) > 0 && (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Legacy preserved:</b> {s.legacy_events} old credits (
          {peso.format(s.legacy_earned || 0)}) remain financially valid but are
          excluded from exact pair/rank/carryover counts.
        </div>
      )}
    </main>
  );
}
