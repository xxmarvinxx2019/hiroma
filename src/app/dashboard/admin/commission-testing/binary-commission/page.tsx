"use client";

import { useEffect, useState } from "react";
import {
  datePresetOptions,
  getDateRangePreset,
  type DateRangePreset,
} from "@/app/lib/dateRangePresets";

type BreakdownKey =
  | "pairs"
  | "earned"
  | "approved"
  | "paid"
  | "liability"
  | "flashout"
  | "reserve_allocated"
  | "reserve_movement";
type BreakdownRow = {
  package_name: string;
  pair_value: number;
  quantity: number;
  amount: number;
  details: string;
  data_quality: "exact" | "mixed" | "reconstructed";
};
type BinaryLedgerRow = {
  id: string; created_at: string; recipient_name: string; recipient_username: string;
  package_name: string; source_name: string; source_username: string; source_kind: string;
  source_leg: string; source_points: number; points_per_pair: number; completed_pairs: number;
  payable_pairs: number; cap_flashout_pairs: number; inactive_flashout_pairs: number;
  payable_amount: number; flashout_amount: number; pair_value: number; peso_per_point: number;
  opening_left_points: number | null; opening_right_points: number | null;
  closing_left_points: number | null; closing_right_points: number | null;
  consumed_left_points: number; consumed_right_points: number; pairing_day: string | null;
  opening_daily_count: number | null; closing_daily_count: number | null;
  cap_enabled: boolean; cap_limit: number | null; package_snapshot_source: string;
  source_event_id: string | null; normal_commission_id: string | null;
  flashout_commission_id: string | null; funded_amount: number; unfunded_amount: number;
  wallet_ledger_id: string | null; approved_amount: number; released_amount: number;
  payout_references: string | null;
  source_financial_id: string | null; source_package: string | null;
  source_channel: string | null; source_payment_status: string | null;
  source_paid_at: string | null; source_outlet_name: string | null;
  source_outlet_username: string | null; source_customer_payment: number;
  source_product_cost: number; source_direct_allocation: number;
  source_binary_allocation: number;
};
type LiabilityRow = {
  id: string; allocated_at: string; recipient_name: string; recipient_username: string;
  package_name: string; original_amount: number; released_amount: number;
  forfeited_amount: number; remaining_amount: number; commission_id: string; age_days: number;
};

type Data = {
  accounting_ready: boolean;
  migration_required: string | null;
  warning: string | null;
  summary: {
    completed_pairs: number;
    payable_pairs: number;
    total_binary_income: number;
    total_approved: number;
    total_paid: number;
    total_forfeited: number;
    opening_payable_liability: number;
    payable_liability: number;
    total_flashout: number;
    cap_flashout_pairs: number;
    inactive_flashout_pairs: number;
    members_reached_cap: number;
    funding_allocated: number;
    funding_opening_held: number;
    funding_earmarked: number;
    funding_uncommitted: number;
    funding_total_held: number;
    funding_earned_earmarked: number;
    funding_released: number;
    funding_flashout_reclassified: number;
    funding_shortfall_created: number;
    funding_shortfall: number;
    funding_surplus: number;
    funding_coverage_ratio: number;
  };
  points: { left: number; right: number; matched_waiting: number };
  cap_rows: Array<{
    package_name: string;
    completed_pairs: number;
    payable_pairs: number;
    flashout_pairs: number;
    flashout_amount: number;
    members_reached_cap: number;
  }>;
  ledger: BinaryLedgerRow[];
  ledger_page: { page: number; page_size: number; total: number; total_pages: number };
  liability_ledger: LiabilityRow[];
  reconciliation: {
    event_count: number; pair_mismatch_count: number; money_mismatch_count: number;
    completed_pairs: number; classified_pairs: number; expected_value: number; classified_value: number;
  };
  breakdowns: Record<BreakdownKey, BreakdownRow[]>;
  notes: Record<string, string>;
};

const initialRange = getDateRangePreset("this_month");
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});

export default function BinaryCommissionPage() {
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [activePreset, setActivePreset] =
    useState<DateRangePreset>("this_month");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBreakdown, setSelectedBreakdown] =
    useState<BreakdownKey | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<BinaryLedgerRow | null>(null);
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState("all");
  const [showLiability, setShowLiability] = useState(false);
  const [exporting, setExporting] = useState(false);

  const reportUrl = (start: string, end: string, page = 1, pageSize = 100) => {
    const params = new URLSearchParams({ from: start, to: end, page: String(page), page_size: String(pageSize), search: search.trim(), event_filter: eventFilter });
    return `/api/admin/commission-testing/binary-commission?${params.toString()}`;
  };
  const load = async (start = from, end = to, page = 1) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        reportUrl(start, end, page),
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error || "Unable to load binary commission data.",
        );
      setData(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load binary commission data.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(initialRange.from, initialRange.to);
    // Initial report range is intentionally fixed to the current month.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedEvent && !selectedBreakdown) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSelectedEvent(null); setSelectedBreakdown(null); }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selectedBreakdown, selectedEvent]);

  const applyPreset = (preset: Exclude<DateRangePreset, "custom">) => {
    const range = getDateRangePreset(preset);
    setFrom(range.from);
    setTo(range.to);
    setActivePreset(preset);
    void load(range.from, range.to);
  };

  const cards = data
    ? [
        {
          key: "pairs" as const,
          label: "Total Binary Pairs",
          value: data.summary.completed_pairs.toLocaleString(),
          note: "Pairs completed in the selected period",
          color: "text-emerald-700",
          bg: "from-emerald-700 to-emerald-500",
        },
        {
          key: "earned" as const,
          label: "Total Binary Earned",
          value: peso.format(data.summary.total_binary_income),
          note: `${data.summary.payable_pairs.toLocaleString()} exact payable pairs`,
          color: "text-blue-700",
          bg: "from-blue-700 to-blue-500",
        },
        {
          key: "approved" as const,
          label: "Approved (Unreleased)",
          value: data.accounting_ready
            ? peso.format(data.summary.total_approved)
            : "Migration pending",
          note: "Approved binary payout not yet released",
          color: "text-sky-700",
          bg: "from-sky-700 to-sky-500",
        },
        {
          key: "paid" as const,
          label: "Total Binary Paid",
          value: data.accounting_ready
            ? peso.format(data.summary.total_paid)
            : "Migration pending",
          note: "Binary payouts released in the selected period",
          color: "text-amber-700",
          bg: "from-orange-700 to-orange-500",
        },
        {
          key: "liability" as const,
          label: "Unpaid Binary Movement",
          value: data.accounting_ready
            ? peso.format(
                data.summary.total_binary_income - data.summary.total_paid,
              )
            : "Migration pending",
          note: "Binary earned minus binary released",
          color: data.summary.total_binary_income - data.summary.total_paid >= 0
            ? "text-violet-700"
            : "text-emerald-700",
          bg: "from-purple-800 to-purple-500",
        },
        {
          key: "flashout" as const,
          label: "Total Binary Flashout",
          value: peso.format(data.summary.total_flashout),
          note: `${data.summary.cap_flashout_pairs} cap + ${data.summary.inactive_flashout_pairs} inactive pairs`,
          color: "text-red-700",
          bg: "from-red-800 to-red-500",
        },
        {
          key: "reserve_allocated" as const,
          label: "Binary Reserve Added",
          value: peso.format(data.summary.funding_allocated),
          note: "Reserve from registrations and upgrades",
          color: "text-teal-700",
          bg: "from-teal-800 to-teal-500",
        },
        {
          key: "reserve_movement" as const,
          label: "Binary Reserve Movement",
          value: data.accounting_ready
            ? peso.format(
                data.summary.funding_allocated -
                  data.summary.funding_released -
                  data.summary.funding_flashout_reclassified,
              )
            : "Migration pending",
          note: "Reserve added minus paid and binary flashout",
          color: "text-emerald-700",
          bg: "from-green-800 to-green-500",
        },
      ]
    : [];
  const activeCard = cards.find((card) => card.key === selectedBreakdown);
  const activeRows =
    data && selectedBreakdown ? data.breakdowns[selectedBreakdown] || [] : [];
  const activeTotal = activeRows.reduce((sum, row) => sum + row.amount, 0);
  const activeQuantity = activeRows.reduce(
    (sum, row) => sum + row.quantity,
    0,
  );
  const filteredLedger = data?.ledger || [];
  const exportCsv = async () => {
    setExporting(true);
    try {
      const allRows: BinaryLedgerRow[] = [];
      let exportPage = 1;
      let totalPages = 1;
      do {
        const response = await fetch(reportUrl(from, to, exportPage, 500), { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to export Binary Commission data.");
        allRows.push(...(payload.ledger || []));
        totalPages = payload.ledger_page?.total_pages || 1;
        exportPage += 1;
      } while (exportPage <= totalPages);
    const safe = (value: unknown) => { const text=String(value ?? ""); const protectedText=/^[=+\-@]/.test(text) ? `'${text}` : text; return `"${protectedText.replaceAll('"','""')}"`; };
    const headings=["Created","Receiver","Receiver username","Source","Source username","Source kind","Source event ID","Source financial ID","Outlet","Outlet username","Package / channel","Payment status","Paid at","Customer payment","Product cost","Direct allocation","Binary allocation","Leg","Source points","Opening left","Opening right","Completed pairs","Payable pairs","Cap flashout pairs","Inactive flashout pairs","Closing left","Closing right","Pair value","Payable amount","Flashout amount","Funded","Unfunded","Approved awaiting release","Released","Commission ID","Flashout commission ID","Wallet ledger ID","Payout references"];
    const rows=allRows.map((r)=>[r.created_at,r.recipient_name,r.recipient_username,r.source_name,r.source_username,r.source_kind,r.source_event_id,r.source_financial_id,r.source_outlet_name,r.source_outlet_username,`${r.source_package || r.package_name} / ${r.source_channel || r.source_kind}`,r.source_payment_status,r.source_paid_at,r.source_customer_payment,r.source_product_cost,r.source_direct_allocation,r.source_binary_allocation,r.source_leg,r.source_points,r.opening_left_points,r.opening_right_points,r.completed_pairs,r.payable_pairs,r.cap_flashout_pairs,r.inactive_flashout_pairs,r.closing_left_points,r.closing_right_points,r.pair_value,r.payable_amount,r.flashout_amount,r.funded_amount,r.unfunded_amount,r.approved_amount,r.released_amount,r.normal_commission_id,r.flashout_commission_id,r.wallet_ledger_id,r.payout_references]);
    const blob=new Blob([[headings,...rows].map((row)=>row.map(safe).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob); const anchor=document.createElement("a"); anchor.href=url; anchor.download=`binary-commission-audit-${from}-to-${to}.csv`; anchor.click(); URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to export Binary Commission data.");
    } finally { setExporting(false); }
  };

  return (
    <main className="mx-auto w-full max-w-7xl p-6 sm:p-8">
      <header className="flex flex-col gap-4 border-b border-[#0D1B3E]/10 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">
            Commission Audit
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[#0D1B3E]">
            Binary Commission
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Audit completed pairs, member earnings, payout liability, company
            funding, carryover points, and Hiroma flashout.
          </p>
        </div>
        <div className="flex max-w-3xl flex-wrap items-end justify-end gap-2">
          <label className="text-xs font-medium text-gray-500">
            Date range
            <select
              value={activePreset}
              onChange={(event) => {
                const preset = event.target.value as DateRangePreset;
                if (preset === "custom") setActivePreset("custom");
                else applyPreset(preset);
              }}
              className="mt-1 block min-w-44 rounded-lg border border-[#0D1B3E]/15 bg-white px-3 py-2 text-sm text-[#0D1B3E]"
            >
              {datePresetOptions.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          {activePreset === "custom" ? (
            <>
              <label className="text-xs font-medium text-gray-500">
                From
                <input
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className="mt-1 block rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-xs font-medium text-gray-500">
                To
                <input
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  className="mt-1 block rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-lg bg-[#0D1B3E] px-4 py-2 text-sm font-semibold text-white"
              >
                Apply filter
              </button>
            </>
          ) : (
            <p className="pb-2 text-xs text-gray-400">
              {from} – {to}
            </p>
          )}
        </div>
      </header>

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data?.warning && (
        <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          <span className="font-semibold">Database update pending.</span>{" "}
          {data.warning}
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-bold text-[#0D1B3E]">
          Selected Period Activity
        </h2>
        <p className="mt-1 text-xs text-gray-400">
          Every card below covers {from} through {to}.
        </p>
      </div>
      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="h-32 animate-pulse rounded-xl bg-slate-100"
              />
            ))
          : cards.map((card) => (
              <button
                key={card.key}
                type="button"
                onClick={() => setSelectedBreakdown(card.key)}
                aria-haspopup="dialog"
                className={`group min-h-32 rounded-2xl bg-gradient-to-br ${card.bg} p-5 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#C9A84C]`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-white/85">
                    {card.label}
                  </p>
                  <span className="text-xs font-semibold text-white/80 opacity-0 transition group-hover:opacity-100">
                    View details →
                  </span>
                </div>
                <p className="mt-3 text-xl font-black text-white">
                  {card.value}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/80">
                  {card.note}
                </p>
              </button>
            ))}
      </section>

      {data && (
        <div className="mt-6">
          <h2 className="text-sm font-bold text-[#0D1B3E]">
            Opening and Closing Position
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            Opening balances are immediately before {from}; closing balances
            are as of {to}.
          </p>
        </div>
      )}

      {data && (
        <section className="mt-6 grid gap-4 xl:grid-cols-3">
          <article className="rounded-xl border border-[#0D1B3E]/10 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-[#0D1B3E]">
              Network Point Position
            </h2>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              {[
                ["Left carryover", data.points.left],
                ["Right carryover", data.points.right],
                ["Matched waiting", data.points.matched_waiting],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="mt-1 font-bold text-[#0D1B3E]">
                    {Number(value).toLocaleString()} pts
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-gray-400">
              Carryover points are network volume, not cash liability. Only
              completed payable pairs create member liability.
            </p>
          </article>
          <article className="rounded-xl border border-[#0D1B3E]/10 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-[#0D1B3E]">
              Member Liability Movement
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt>Opening payable</dt>
                <dd className="font-semibold">
                  {peso.format(data.summary.opening_payable_liability)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>+ Earned this period</dt>
                <dd className="font-semibold text-blue-700">
                  {peso.format(data.summary.total_binary_income)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>- Released this period</dt>
                <dd className="font-semibold text-amber-700">
                  {peso.format(data.summary.total_paid)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>- Forfeited on deactivation</dt>
                <dd className="font-semibold text-gray-600">
                  {peso.format(data.summary.total_forfeited)}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-2">
                <dt>Closing payable liability</dt>
                <dd className="font-bold text-violet-700">
                  {peso.format(data.summary.payable_liability)}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs leading-5 text-gray-400">
              Approved but unreleased ({peso.format(data.summary.total_approved)})
              is included in closing liability and is not yet paid.
            </p>
            <button type="button" onClick={() => setShowLiability((value) => !value)} className="mt-3 rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50">
              {showLiability ? "Hide liability records" : `View records behind ${peso.format(data.summary.payable_liability)}`}
            </button>
          </article>
          <article className="rounded-xl border border-[#0D1B3E]/10 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-[#0D1B3E]">
              Binary Reserve Movement
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt>Opening reserve held</dt>
                <dd className="font-semibold">
                  {peso.format(data.summary.funding_opening_held)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>+ New package allocations</dt>
                <dd className="font-semibold">
                  {peso.format(data.summary.funding_allocated)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>- Released member payouts</dt>
                <dd className="font-semibold text-amber-700">
                  {peso.format(data.summary.funding_released)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>- Flashout retained by Hiroma</dt>
                <dd className="font-semibold text-red-700">
                  {peso.format(data.summary.funding_flashout_reclassified)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>Unfunded earnings created</dt>
                <dd
                  className={
                    data.summary.funding_shortfall_created
                      ? "font-semibold text-red-700"
                      : "font-semibold text-emerald-700"
                  }
                >
                  {peso.format(data.summary.funding_shortfall_created)}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-2">
                <dt>Closing total reserve held</dt>
                <dd className="font-bold text-teal-700">
                  {peso.format(data.summary.funding_total_held)}
                </dd>
              </div>
            </dl>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-gray-500">
              <p>
                Earmarked for unpaid earnings: {peso.format(data.summary.funding_earmarked)}
              </p>
              <p>
                Uncommitted reserve: {peso.format(data.summary.funding_uncommitted)}
              </p>
              <p>
                Coverage: {data.summary.funding_coverage_ratio.toFixed(1)}% ·{" "}
                {data.summary.funding_shortfall > 0
                  ? `Shortfall ${peso.format(data.summary.funding_shortfall)}`
                  : `Surplus ${peso.format(data.summary.funding_surplus)}`}
              </p>
            </div>
          </article>
        </section>
      )}

      {showLiability && data && <BinaryLiabilityTable rows={data.liability_ledger} headline={data.summary.payable_liability} />}

      <section className="mt-6 overflow-hidden rounded-xl border border-[#0D1B3E]/10 bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-bold text-[#0D1B3E]">
            Daily Cap by Package
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-gray-500">
              <tr>
                <th className="px-5 py-3">Package</th>
                <th className="px-5 py-3">Completed</th>
                <th className="px-5 py-3">Payable</th>
                <th className="px-5 py-3">Flashout</th>
                <th className="px-5 py-3">Members capped</th>
                <th className="px-5 py-3">Flashout amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!loading && data?.cap_rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-gray-400"
                  >
                    No exact binary pair events for this period.
                  </td>
                </tr>
              )}
              {data?.cap_rows.map((row) => (
                <tr key={row.package_name}>
                  <td className="px-5 py-3 font-semibold text-[#0D1B3E]">
                    {row.package_name}
                  </td>
                  <td className="px-5 py-3">{row.completed_pairs}</td>
                  <td className="px-5 py-3 text-emerald-700">
                    {row.payable_pairs}
                  </td>
                  <td className="px-5 py-3 text-red-700">
                    {row.flashout_pairs}
                  </td>
                  <td className="px-5 py-3">{row.members_reached_cap}</td>
                  <td className="px-5 py-3 font-semibold text-red-700">
                    {peso.format(row.flashout_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-[#0D1B3E]/10 bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="text-sm font-bold text-[#0D1B3E]">
            Binary Pair Audit Ledger
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            One immutable row per affected upline and triggering registration or
            upgrade.
          </p>
          {data && <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${data.reconciliation.pair_mismatch_count + data.reconciliation.money_mismatch_count === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-700"}`}>
            <b>{data.reconciliation.pair_mismatch_count + data.reconciliation.money_mismatch_count === 0 ? "Reconciled" : "Discrepancy detected"}</b>: {data.reconciliation.completed_pairs} completed pairs = {data.reconciliation.classified_pairs} payable/flashout pairs; {peso.format(data.reconciliation.expected_value)} expected = {peso.format(data.reconciliation.classified_value)} classified. {data.reconciliation.event_count} event{data.reconciliation.event_count === 1 ? "" : "s"} checked.
          </div>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search receiver, source, package, or reference…" className="min-w-0 flex-1 rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-sm" />
            <select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} className="rounded-lg border border-[#0D1B3E]/15 bg-white px-3 py-2 text-sm"><option value="all">All events</option><option value="payable">Payable pairs</option><option value="cap">Cap flashout</option><option value="inactive">Inactive flashout</option><option value="no_pair">No pair completed</option></select>
            <button type="button" onClick={() => void load(from, to, 1)} className="rounded-lg border border-[#0D1B3E]/20 bg-white px-4 py-2 text-sm font-semibold text-[#0D1B3E]">Apply</button>
            <button type="button" disabled={!data?.ledger_page.total || exporting} onClick={() => void exportCsv()} className="rounded-lg bg-[#0D1B3E] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{exporting ? "Exporting all pages…" : "Export complete filtered CSV"}</button>
          </div>
          <p className="mt-2 text-xs text-gray-400">Showing {filteredLedger.length} events on page {data?.ledger_page.page || 1} of {data?.ledger_page.total_pages || 1}; {data?.ledger_page.total || 0} filtered events in total.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Receiver</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Leg / points</th>
                <th className="px-4 py-3">Pairs</th>
                <th className="px-4 py-3">Payable</th>
                <th className="px-4 py-3">Flashout</th><th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!loading && filteredLedger.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-5 py-12 text-center text-gray-400"
                  >
                    No exact binary audit events for this period.
                  </td>
                </tr>
              )}
              {filteredLedger.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    {new Date(row.created_at).toLocaleString("en-PH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#0D1B3E]">
                      {row.recipient_name}
                    </p>
                    <p className="text-xs text-gray-400">
                      @{row.recipient_username} · {row.package_name}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{row.source_name}</p>
                    <p className="text-xs text-gray-400">
                      @{row.source_username} · {row.source_kind}
                    </p>
                  </td>
                  <td className="px-4 py-3 capitalize">
                    {row.source_leg} · {row.source_points.toLocaleString()} pts
                  </td>
                  <td className="px-4 py-3">
                    {row.completed_pairs}
                    <p className="text-xs text-gray-400">
                      {row.points_per_pair} pts/pair
                    </p>
                  </td>
                  <td className="px-4 py-3 text-emerald-700">
                    {row.payable_pairs} · {peso.format(row.payable_amount)}
                  </td>
                  <td className="px-4 py-3 text-red-700">
                    {row.cap_flashout_pairs + row.inactive_flashout_pairs} ·{" "}
                    {peso.format(row.flashout_amount)}
                  </td>
                  <td className="px-4 py-3"><button type="button" onClick={() => setSelectedEvent(row)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-[#0D1B3E] hover:bg-slate-50">View audit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.ledger_page.total_pages > 1 && <div className="flex items-center justify-between border-t bg-slate-50 px-5 py-3 text-sm"><button type="button" disabled={loading || data.ledger_page.page <= 1} onClick={() => void load(from,to,data.ledger_page.page-1)} className="rounded-lg border bg-white px-4 py-2 font-semibold disabled:opacity-40">Previous</button><span>Page {data.ledger_page.page} of {data.ledger_page.total_pages}</span><button type="button" disabled={loading || data.ledger_page.page >= data.ledger_page.total_pages} onClick={() => void load(from,to,data.ledger_page.page+1)} className="rounded-lg border bg-white px-4 py-2 font-semibold disabled:opacity-40">Next</button></div>}
      </section>

      <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <p className="font-semibold">Accounting policy</p>
        <p className="mt-1 leading-6">
          {data?.notes.payout_policy} {data?.notes.history}
        </p>
      </section>

      {selectedBreakdown && activeCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#06102A]/65 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="binary-breakdown-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedBreakdown(null);
          }}
        >
          <section className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#C9A84C]">
                  Binary Commission Breakdown
                </p>
                <h2
                  id="binary-breakdown-title"
                  className="mt-1 text-xl font-bold text-[#0D1B3E]"
                >
                  {activeCard.label}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {from} through {to} / {activeCard.note}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBreakdown(null)}
                aria-label="Close breakdown"
                className="rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-sm font-semibold text-[#0D1B3E] hover:bg-slate-50"
              >
                Close
              </button>
            </header>

            <div className="overflow-auto">
              <table className="min-w-[900px] w-full text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-5 py-3">Package</th>
                    <th className="px-5 py-3">Pair value</th>
                    <th className="px-5 py-3">Quantity</th>
                    <th className="px-5 py-3">Amount</th>
                    <th className="px-5 py-3">Explanation</th>
                    <th className="px-5 py-3">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#0D1B3E]/10">
                  {activeRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-gray-400">
                        No records for this card in the selected period.
                      </td>
                    </tr>
                  ) : (
                    activeRows.map((row, index) => (
                      <tr key={`${row.package_name}-${row.pair_value}-${index}`}>
                        <td className="px-5 py-4 font-semibold text-[#0D1B3E]">
                          {row.package_name}
                        </td>
                        <td className="px-5 py-4">
                          {row.pair_value > 0 ? peso.format(row.pair_value) : "Not available"}
                        </td>
                        <td className="px-5 py-4">{row.quantity.toLocaleString()}</td>
                        <td className="px-5 py-4 font-semibold">
                          {peso.format(row.amount)}
                        </td>
                        <td className="px-5 py-4 text-gray-500">{row.details}</td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
                              row.data_quality === "exact"
                                ? "bg-emerald-50 text-emerald-700"
                                : row.data_quality === "mixed"
                                  ? "bg-amber-50 text-amber-700"
                                  : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {row.data_quality}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {activeRows.length > 0 && (
                  <tfoot className="border-t-2 border-[#0D1B3E] bg-slate-50 font-bold text-[#0D1B3E]">
                    <tr>
                      <td className="px-5 py-4" colSpan={2}>Total</td>
                      <td className="px-5 py-4">{activeQuantity.toLocaleString()}</td>
                      <td className="px-5 py-4">{peso.format(activeTotal)}</td>
                      <td className="px-5 py-4 text-xs font-normal text-gray-500" colSpan={2}>
                        Exact means captured at transaction time. Reconstructed means the old record did not contain a package snapshot.
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        </div>
      )}

      {selectedEvent && <BinaryEventModal row={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </main>
  );
}

function BinaryLiabilityTable({ rows, headline }: { rows: LiabilityRow[]; headline: number }) {
  const loaded=rows.reduce((sum,row)=>sum+Number(row.remaining_amount||0),0);
  return <section className="mt-6 overflow-hidden rounded-xl border border-violet-200 bg-white shadow-sm"><div className="border-b px-5 py-4"><h2 className="text-sm font-bold text-[#0D1B3E]">Records Behind Closing Binary Liability</h2><p className="mt-1 text-xs text-gray-500">Original earning − released payout − lawful deactivation forfeiture = remaining unpaid. Age supports stale-liability review.</p></div><div className="overflow-x-auto"><table className="min-w-[940px] w-full text-left text-xs"><thead className="bg-violet-50 text-gray-600"><tr>{["Created","Age","Receiver","Package","Original","Released","Forfeited","Remaining","Commission ID"].map((x)=><th key={x} className="px-3 py-2">{x}</th>)}</tr></thead><tbody className="divide-y">{rows.map((r)=><tr key={r.id}><td className="px-3 py-2">{new Date(r.allocated_at).toLocaleString("en-PH")}</td><td className="px-3 py-2">{r.age_days} days</td><td className="px-3 py-2"><b>{r.recipient_name}</b><small className="block text-gray-400">@{r.recipient_username}</small></td><td className="px-3 py-2">{r.package_name}</td><td className="px-3 py-2">{peso.format(r.original_amount)}</td><td className="px-3 py-2">{peso.format(r.released_amount)}</td><td className="px-3 py-2">{peso.format(r.forfeited_amount)}</td><td className="px-3 py-2 font-bold text-violet-700">{peso.format(r.remaining_amount)}</td><td className="max-w-44 break-all px-3 py-2 text-gray-400">{r.commission_id}</td></tr>)}{rows.length===0&&<tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">No unpaid Binary Commission records as of this date.</td></tr>}</tbody><tfoot className="border-t bg-slate-50 font-bold"><tr><td colSpan={7} className="px-3 py-2 text-right">Loaded / headline liability</td><td colSpan={2} className={Math.abs(loaded-headline)<0.005?"px-3 py-2 text-emerald-700":"px-3 py-2 text-red-700"}>{peso.format(loaded)} / {peso.format(headline)}</td></tr></tfoot></table></div>{rows.length>=500&&<p className="border-t bg-amber-50 px-4 py-3 text-xs text-amber-800">Showing the oldest 500 open lots. Use a narrower end date for a bounded review.</p>}</section>;
}

function BinaryEventModal({ row, onClose }: { row: BinaryLedgerRow; onClose: () => void }) {
  const groups: Array<[string,Array<[string,string]>]>=[
    ["Source and recipient",[["Receiver",`${row.recipient_name} (@${row.recipient_username})`],["Source member",`${row.source_name} (@${row.source_username})`],["Source kind",row.source_kind],["Source event ID",row.source_event_id||"Legacy / unavailable"],["Source financial ID",row.source_financial_id||"Legacy / unavailable"],["Outlet",row.source_outlet_name?`${row.source_outlet_name} (@${row.source_outlet_username})`:"Legacy / unavailable"],["Package / channel",`${row.source_package||row.package_name} / ${row.source_channel||row.source_kind}`],["Payment status / paid at",`${row.source_payment_status||"Unknown"} / ${row.source_paid_at?new Date(row.source_paid_at).toLocaleString("en-PH"):"Unavailable"}`],["Leg",row.source_leg],["Package snapshot",row.package_name],["Snapshot quality",row.package_snapshot_source]]],
    ["Source transaction economics",[["Customer payment",peso.format(row.source_customer_payment)],["Product acquisition cost",peso.format(row.source_product_cost)],["Direct Referral allocation",peso.format(row.source_direct_allocation)],["Binary reserve allocation",peso.format(row.source_binary_allocation)]]],
    ["Points and pair calculation",[["Source points",String(row.source_points)],["Opening left / right",`${row.opening_left_points??"—"} / ${row.opening_right_points??"—"}`],["Consumed left / right",`${row.consumed_left_points} / ${row.consumed_right_points}`],["Closing left / right",`${row.closing_left_points??"—"} / ${row.closing_right_points??"—"}`],["Points per pair",String(row.points_per_pair)],["Peso per point",peso.format(row.peso_per_point)],["Pair value",peso.format(row.pair_value)],["Completed pairs",String(row.completed_pairs)]]],
    ["Payable and flashout",[["Payable pairs",String(row.payable_pairs)],["Cap flashout pairs",String(row.cap_flashout_pairs)],["Inactive flashout pairs",String(row.inactive_flashout_pairs)],["Payable amount",peso.format(row.payable_amount)],["Flashout retained by Hiroma",peso.format(row.flashout_amount)],["Daily cap",row.cap_enabled?`${row.cap_limit??0} pairs/day`:"Disabled"],["Daily count before / after",`${row.opening_daily_count??"—"} / ${row.closing_daily_count??"—"}`]]],
    ["Funding, wallet, and payout",[["Funded from reserve",peso.format(row.funded_amount)],["Unfunded amount",peso.format(row.unfunded_amount)],["Approved awaiting release",peso.format(row.approved_amount)],["Released as of selected date",peso.format(row.released_amount)],["Payout references",row.payout_references||"None"],["Commission ID",row.normal_commission_id||"None"],["Flashout commission ID",row.flashout_commission_id||"None"],["Wallet ledger ID",row.wallet_ledger_id||"None"],["Pair event ID",row.id]]],
  ];
  return <div role="dialog" aria-modal="true" aria-labelledby="binary-event-title" className="fixed inset-0 z-50 flex items-center justify-center bg-[#06102A]/65 p-4" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}><section className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><header className="sticky top-0 flex justify-between border-b bg-white px-5 py-4"><div><h2 id="binary-event-title" className="font-bold text-[#0D1B3E]">Binary Commission audit details</h2><p className="text-xs text-gray-500">Immutable pair, funding, wallet, and payout evidence</p></div><button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm">Close</button></header><div className="grid gap-4 p-5 md:grid-cols-2">{groups.map(([title,items])=><section key={title} className="rounded-xl border p-4"><h3 className="text-sm font-bold text-[#0D1B3E]">{title}</h3><dl className="mt-3 divide-y">{items.map(([label,value])=><div key={label} className="grid gap-1 py-2 text-xs sm:grid-cols-[170px_1fr]"><dt className="text-gray-500">{label}</dt><dd className="break-all font-medium text-[#0D1B3E]">{value}</dd></div>)}</dl></section>)}</div></section></div>;
}
