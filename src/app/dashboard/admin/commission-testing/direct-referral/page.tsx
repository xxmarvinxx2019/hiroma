"use client";

import { useEffect, useMemo, useState } from "react";
import {
  datePresetOptions,
  getDateRangePreset,
  type DateRangePreset,
} from "@/app/lib/dateRangePresets";

type LedgerRow = {
  id: string;
  date: string;
  amount: number;
  paid_to_end: number;
  forfeited_to_end: number;
  remaining_to_end: number;
  referrer_name: string;
  referrer_username: string;
  referred_name: string | null;
  referred_username: string | null;
};

type SettlementAuditRow = {
  id: string;
  created_at: string;
  settlement_day: string;
  source_event_id: string;
  registration_financial_id: string;
  sponsor_name: string;
  sponsor_username: string;
  referred_name: string;
  referred_username: string;
  outlet_name: string;
  outlet_username: string;
  registration_channel: string;
  package_name: string;
  payment_status: string;
  paid_at: string | null;
  customer_payment: number;
  product_acquisition_cost: number;
  reseller_value: number;
  pin_allocation: number;
  outlet_registration_profit: number;
  direct_referral_allocation: number;
  binary_commission_allocation: number;
  sponsor_package_name: string;
  sponsor_bonus: number;
  cap_enabled: boolean;
  cap_limit: number;
  opening_daily_count: number;
  closing_daily_count: number;
  recipient_eligible: boolean;
  disposition: string;
  payable_amount: number;
  retained_amount: number;
  normal_commission_id: string | null;
  retained_commission_id: string | null;
};

type DirectReferralData = {
  summary: {
    total_direct_referrals: number;
    total_direct_referral_income: number;
    total_flashout: number;
    flashout_events: number;
    total_paid: number;
    total_approved: number;
    total_reserve_liability: number;
  };
  ledger: LedgerRow[];
  liability_ledger: LedgerRow[];
  settlement_audit: SettlementAuditRow[];
  reconciliation: {
    event_count: number;
    source_allocation: number;
    payable_amount: number;
    retained_amount: number;
    mismatch_count: number;
  };
  data_notes: {
    total_paid: string;
    total_approved: string;
    total_reserve_liability: string;
    historical: string;
    flashout: string;
  };
};

const initialRange = getDateRangePreset("this_month");
const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});

export default function DirectReferralTestingPage() {
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [activePreset, setActivePreset] =
    useState<DateRangePreset>("this_month");
  const [data, setData] = useState<DirectReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<SettlementAuditRow | null>(null);
  const [auditSearch, setAuditSearch] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [showLiabilitySources, setShowLiabilitySources] = useState(false);

  const loadData = async (start = from, end = to) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/commission-testing/direct-referral?from=${start}&to=${end}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error || "Unable to load direct referral data.",
        );
      setData(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load direct referral data.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    fetch(
      `/api/admin/commission-testing/direct-referral?from=${initialRange.from}&to=${initialRange.to}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(
            payload.error || "Unable to load direct referral data.",
          );
        if (!cancelled) setData(payload);
      })
      .catch((requestError) => {
        if (!cancelled)
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Unable to load direct referral data.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedEvent) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedEvent(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedEvent]);

  const applyPreset = (preset: Exclude<DateRangePreset, "custom">) => {
    const range = getDateRangePreset(preset);
    setFrom(range.from);
    setTo(range.to);
    setActivePreset(preset);
    void loadData(range.from, range.to);
  };

  const cards = data
    ? [
        {
          label: "Referrals That Earned Commission",
          value: data.summary.total_direct_referrals.toLocaleString(),
          note: "Number of new referral commissions created in this period",
          color: "text-emerald-700",
          bg: "from-emerald-700 to-emerald-500",
          icon: "👥",
        },
        {
          label: "New Referral Earnings",
          value: peso.format(data.summary.total_direct_referral_income),
          note: "New earnings credited to resellers in this period",
          color: "text-blue-700",
          bg: "from-blue-700 to-blue-500",
          icon: "₱",
        },
        {
          label: "Referral Earnings Released",
          value: peso.format(data.summary.total_paid),
          note: data.data_notes.total_paid,
          color: "text-amber-700",
          bg: "from-orange-700 to-orange-500",
          icon: "💳",
        },
        {
          label: "Approved, Awaiting Payment",
          value: peso.format(data.summary.total_approved),
          note: data.data_notes.total_approved,
          color: "text-sky-700",
          bg: "from-sky-700 to-sky-500",
          icon: "⏳",
        },
        {
          label: "Change in Unpaid Referral Earnings",
          value: peso.format(
            data.summary.total_direct_referral_income - data.summary.total_paid,
          ),
          note: "New reseller earnings minus payments released in this period",
          color: "text-violet-700",
          bg: "from-purple-800 to-purple-500",
          icon: "🛡️",
        },
        {
          label: "Referral Earnings Retained by Hiroma",
          value: peso.format(data.summary.total_flashout),
          note: `${data.summary.flashout_events} excess / retained event${data.summary.flashout_events === 1 ? "" : "s"}`,
          color: "text-red-700",
          bg: "from-red-800 to-red-500",
          icon: "🔥",
        },
      ]
    : [];

  const decisionLabel = (value: string) => ({
    paid: "Paid to sponsor",
    paid_with_package_remainder: "Paid; package difference retained",
    retained_cap: "Retained: daily cap reached",
    retained_ineligible: "Retained: sponsor not eligible",
    retained_package_difference: "Retained: package difference",
    retained_system_root: "Retained: Hiroma system referral",
  })[value] || value.replaceAll("_", " ");

  const filteredEvents = useMemo(() => {
    const query = auditSearch.trim().toLocaleLowerCase("en-PH");
    return (data?.settlement_audit || []).filter((event) => {
      if (decisionFilter !== "all" && event.disposition !== decisionFilter) return false;
      if (!query) return true;
      return [event.referred_name,event.referred_username,event.sponsor_name,event.sponsor_username,event.outlet_name,event.outlet_username,event.package_name,event.registration_channel,event.disposition,event.source_event_id,event.registration_financial_id,event.id].some((value) => String(value || "").toLocaleLowerCase("en-PH").includes(query));
    });
  }, [auditSearch, data?.settlement_audit, decisionFilter]);

  const exportAuditCsv = () => {
    const safe = (value: unknown) => {
      const text = String(value ?? "");
      const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${guarded.replaceAll('"', '""')}"`;
    };
    const headings = ["Recorded at","Settlement day","New reseller","New reseller username","Sponsor","Sponsor username","Outlet","Outlet username","Channel","Package","Customer payment","Product value at reseller price","Product acquisition cost","PIN allocation","Outlet registration profit","Direct Referral allocation","Binary allocation","Sponsor package","Sponsor bonus rule","Eligible","Cap enabled","Cap limit","Daily count before","Daily count after","Decision","Payable to sponsor","Retained by Hiroma","Registration financial ID","Settlement event ID","Registration source ID","Payable commission ID","Retained commission ID"];
    const rows = filteredEvents.map((event) => [event.created_at,event.settlement_day,event.referred_name,event.referred_username,event.sponsor_name,event.sponsor_username,event.outlet_name,event.outlet_username,event.registration_channel,event.package_name,event.customer_payment,event.reseller_value,event.product_acquisition_cost,event.pin_allocation,event.outlet_registration_profit,event.direct_referral_allocation,event.binary_commission_allocation,event.sponsor_package_name,event.sponsor_bonus,event.recipient_eligible,event.cap_enabled,event.cap_limit,event.opening_daily_count,event.closing_daily_count,decisionLabel(event.disposition),event.payable_amount,event.retained_amount,event.registration_financial_id,event.id,event.source_event_id,event.normal_commission_id,event.retained_commission_id]);
    const csv = [headings, ...rows].map((row) => row.map(safe).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `direct-referral-audit-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="mx-auto w-full max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-4 border-b border-[#0D1B3E]/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">
            Commission Audit
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[#0D1B3E]">
            Direct Referral
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Review reseller referral earnings, released payments, and retained
            amounts by date range.
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
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  type="date"
                  className="mt-1 block rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-sm text-[#0D1B3E]"
                />
              </label>
              <label className="text-xs font-medium text-gray-500">
                To
                <input
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  type="date"
                  className="mt-1 block rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-sm text-[#0D1B3E]"
                />
              </label>
              <button
                type="button"
                onClick={() => void loadData()}
                className="rounded-lg bg-[#0D1B3E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#162b62]"
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
      </div>

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
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
      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {loading
          ? Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="h-36 animate-pulse rounded-xl border border-[#0D1B3E]/10 bg-slate-50"
              />
            ))
          : cards.map((card) => (
              <article
                key={card.label}
                className={`min-h-36 rounded-2xl bg-gradient-to-br ${card.bg} p-5 text-white shadow-sm`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-white/85">
                    {card.label}
                  </p>
                  <span className="text-lg">{card.icon}</span>
                </div>
                <p className="mt-3 text-xl font-black text-white">
                  {card.value}
                </p>
                <p className="mt-2 text-xs leading-5 text-white/80">
                  {card.note}
                </p>
              </article>
            ))}
      </section>

      {data && (
        <section className="mt-6 rounded-xl border border-[#0D1B3E]/10 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Total Unpaid Referral Earnings as of {to}
          </p>
          <p className="mt-2 text-2xl font-bold text-violet-700">
            {peso.format(data.summary.total_reserve_liability)}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            {data.data_notes.total_reserve_liability}
          </p>
          <button type="button" onClick={() => setShowLiabilitySources((current) => !current)} className="mt-3 rounded-lg border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50">
            {showLiabilitySources ? "Hide unpaid records" : `View records behind ${peso.format(data.summary.total_reserve_liability)}`}
          </button>
          {showLiabilitySources && <LiabilitySources rows={data.liability_ledger} />}
        </section>
      )}

      <section className="mt-6 overflow-hidden rounded-xl border border-[#0D1B3E]/10 bg-white shadow-sm">
        <div className="border-b border-[#0D1B3E]/10 px-5 py-4">
          <h2 className="text-sm font-bold text-[#0D1B3E]">Complete Registration-to-Referral Audit</h2>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            Every recorded Direct Referral decision in the selected period, including payable, capped,
            ineligible, package-difference, and Hiroma system-retained registrations.
          </p>
          {data && <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${data.reconciliation.mismatch_count === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-300 bg-red-50 text-red-700"}`}>
            <b>{data.reconciliation.mismatch_count === 0 ? "Reconciled" : "Reconciliation issue detected"}</b>: {peso.format(data.reconciliation.source_allocation)} allocation = {peso.format(data.reconciliation.payable_amount)} payable + {peso.format(data.reconciliation.retained_amount)} retained ({data.reconciliation.event_count} event{data.reconciliation.event_count === 1 ? "" : "s"}).
          </div>}
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Search reseller, sponsor, outlet, package, or reference…" className="min-w-0 flex-1 rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-sm text-[#0D1B3E]" />
            <select value={decisionFilter} onChange={(event) => setDecisionFilter(event.target.value)} className="rounded-lg border border-[#0D1B3E]/15 bg-white px-3 py-2 text-sm text-[#0D1B3E]">
              <option value="all">All decisions</option><option value="paid">Paid to sponsor</option><option value="paid_with_package_remainder">Paid with retained difference</option><option value="retained_cap">Daily cap reached</option><option value="retained_ineligible">Sponsor ineligible</option><option value="retained_package_difference">Package difference retained</option><option value="retained_system_root">Hiroma system referral</option>
            </select>
            <button type="button" disabled={filteredEvents.length === 0} onClick={exportAuditCsv} className="rounded-lg bg-[#0D1B3E] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Export filtered CSV</button>
          </div>
          <p className="mt-2 text-xs text-gray-400">Showing {filteredEvents.length} of {data?.settlement_audit.length || 0} loaded records.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1150px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Registration date</th>
                <th className="px-4 py-3">New reseller</th>
                <th className="px-4 py-3">Sponsor</th>
                <th className="px-4 py-3">Package / channel</th>
                <th className="px-4 py-3">Customer payment</th>
                <th className="px-4 py-3">Payable</th>
                <th className="px-4 py-3">Retained by Hiroma</th>
                <th className="px-4 py-3">Decision</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0D1B3E]/8">
              {!loading && filteredEvents.length === 0 && (
                <tr><td colSpan={9} className="px-5 py-12 text-center text-gray-400">No Direct Referral decisions for this period.</td></tr>
              )}
              {filteredEvents.map((event) => (
                <tr key={event.id} className="text-gray-600">
                  <td className="whitespace-nowrap px-4 py-3 text-xs">{new Date(event.created_at).toLocaleString("en-PH")}</td>
                  <td className="px-4 py-3"><b className="text-[#0D1B3E]">{event.referred_name}</b><small className="block text-gray-400">@{event.referred_username}</small></td>
                  <td className="px-4 py-3"><b className="text-[#0D1B3E]">{event.sponsor_name}</b><small className="block text-gray-400">@{event.sponsor_username}</small></td>
                  <td className="px-4 py-3"><b>{event.package_name}</b><small className="block capitalize text-gray-400">{event.registration_channel.replaceAll("_", " ")}</small></td>
                  <td className="whitespace-nowrap px-4 py-3">{peso.format(event.customer_payment)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-emerald-700">{peso.format(event.payable_amount)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-red-600">{peso.format(event.retained_amount)}</td>
                  <td className="px-4 py-3 text-xs">{decisionLabel(event.disposition)}</td>
                  <td className="px-4 py-3"><button type="button" onClick={() => setSelectedEvent(event)} className="rounded-lg border border-[#0D1B3E]/15 px-3 py-1.5 text-xs font-semibold text-[#0D1B3E] hover:bg-slate-50">View audit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(data?.settlement_audit.length || 0) >= 500 && <p className="border-t bg-amber-50 px-5 py-3 text-xs text-amber-800">Showing the latest 500 records. Narrow the date range to review the complete period.</p>}
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-[#0D1B3E]/10 bg-white shadow-sm">
        <div className="border-b border-[#0D1B3E]/10 px-5 py-4">
          <h2 className="text-sm font-bold text-[#0D1B3E]">
            Direct Referral Earnings Ledger
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            Every payable direct-referral credit created in the selected period,
            with its paid and remaining balance as of the selected end date.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Reseller Who Earned</th>
                <th className="px-5 py-3">New Member Referred</th>
                <th className="px-5 py-3">Referral Earning</th>
                <th className="px-5 py-3">Released to Reseller</th>
                <th className="px-5 py-3">Forfeited on Deactivation</th>
                <th className="px-5 py-3">Remaining Unpaid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0D1B3E]/8">
              {!loading && data?.ledger.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-12 text-center text-sm text-gray-400"
                  >
                    No payable direct-referral credits for this period.
                  </td>
                </tr>
              )}
              {data?.ledger.map((row) => (
                <tr key={row.id} className="text-gray-600">
                  <td className="whitespace-nowrap px-5 py-3 text-xs">
                    {new Date(row.date).toLocaleString("en-PH", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-medium text-[#0D1B3E]">
                      {row.referrer_name}
                    </p>
                    <p className="text-xs text-gray-400">
                      @{row.referrer_username}
                    </p>
                  </td>
                  <td className="px-5 py-3">
                    <p className="font-medium text-[#0D1B3E]">
                      {row.referred_name || "Unavailable"}
                    </p>
                    <p className="text-xs text-gray-400">
                      {row.referred_username
                        ? `@${row.referred_username}`
                        : "Legacy source"}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 font-semibold text-[#0D1B3E]">
                    {peso.format(row.amount)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-amber-700">
                    {peso.format(row.paid_to_end)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-gray-500">
                    {peso.format(row.forfeited_to_end)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-violet-700">
                    {peso.format(row.remaining_to_end)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
        <p className="font-semibold">Data integrity note</p>
        <p className="mt-1 leading-6">
          {data?.data_notes.historical || "Loading ledger policy…"} Flashout is
          excluded from the reserve because it is retained by Hiroma. This page
          is read-only and does not change live commission or payout amounts.
        </p>
      </section>

      {selectedEvent && (
        <div role="dialog" aria-modal="true" aria-labelledby="direct-referral-audit-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedEvent(null); }}>
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-start justify-between border-b bg-white px-5 py-4">
              <div><h2 id="direct-referral-audit-title" className="font-bold text-[#0D1B3E]">Direct Referral audit details</h2><p className="mt-1 text-xs text-gray-500">Registration and immutable settlement evidence</p></div>
              <button type="button" aria-label="Close audit details" onClick={() => setSelectedEvent(null)} className="rounded-lg border px-3 py-1.5 text-sm">Close</button>
            </div>
            <div className="grid gap-5 p-5 md:grid-cols-2">
              <AuditGroup title="People and registration" rows={[
                ["New reseller", `${selectedEvent.referred_name} (@${selectedEvent.referred_username})`],
                ["Sponsor", `${selectedEvent.sponsor_name} (@${selectedEvent.sponsor_username})`],
                ["Processing outlet", `${selectedEvent.outlet_name} (@${selectedEvent.outlet_username})`],
                ["Registration channel", selectedEvent.registration_channel.replaceAll("_", " ")],
                ["New reseller package", selectedEvent.package_name],
                ["Registration payment status", selectedEvent.payment_status],
                ["Paid at", selectedEvent.paid_at ? new Date(selectedEvent.paid_at).toLocaleString("en-PH") : "Not recorded"],
              ]} />
              <AuditGroup title="Registration financials" rows={[
                ["Customer payment", peso.format(selectedEvent.customer_payment)],
                ["Product value at reseller price", peso.format(selectedEvent.reseller_value)],
                ["Product acquisition cost", peso.format(selectedEvent.product_acquisition_cost)],
                ["PIN allocation", peso.format(selectedEvent.pin_allocation)],
                ["Outlet registration profit", peso.format(selectedEvent.outlet_registration_profit)],
                ["Direct Referral allocation", peso.format(selectedEvent.direct_referral_allocation)],
                ["Binary allocation", peso.format(selectedEvent.binary_commission_allocation)],
              ]} />
              <AuditGroup title="Direct Referral decision" rows={[
                ["Decision", decisionLabel(selectedEvent.disposition)],
                ["Sponsor package used", selectedEvent.sponsor_package_name],
                ["Sponsor bonus rule", peso.format(selectedEvent.sponsor_bonus)],
                ["Sponsor eligible", selectedEvent.recipient_eligible ? "Yes" : "No"],
                ["Daily cap enabled", selectedEvent.cap_enabled ? "Yes" : "No"],
                ["Daily cap", selectedEvent.cap_enabled ? `${selectedEvent.cap_limit} referrals` : "Not applicable"],
                ["Daily count before / after", `${selectedEvent.opening_daily_count} / ${selectedEvent.closing_daily_count}`],
                ["Paid to sponsor", peso.format(selectedEvent.payable_amount)],
                ["Retained by Hiroma", peso.format(selectedEvent.retained_amount)],
              ]} />
              <AuditGroup title="Immutable references" rows={[
                ["Settlement recorded", new Date(selectedEvent.created_at).toLocaleString("en-PH")],
                ["Settlement day", new Date(selectedEvent.settlement_day).toLocaleDateString("en-PH")],
                ["Settlement event ID", selectedEvent.id],
                ["Registration financial ID", selectedEvent.registration_financial_id],
                ["Registration source ID", selectedEvent.source_event_id],
                ["Payable commission ID", selectedEvent.normal_commission_id || "None"],
                ["Retained commission ID", selectedEvent.retained_commission_id || "None"],
              ]} />
            </div>
            <p className="border-t bg-slate-50 px-5 py-4 text-xs leading-5 text-gray-500">Outlet registration profit belongs to the outlet that processed the registration. PIN allocation is shown separately and must not be added again to customer payment.</p>
          </div>
        </div>
      )}
    </main>
  );
}

function AuditGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <section className="rounded-xl border border-[#0D1B3E]/10 p-4"><h3 className="text-sm font-bold text-[#0D1B3E]">{title}</h3><dl className="mt-3 divide-y divide-slate-100">{rows.map(([label, value]) => <div key={label} className="grid gap-1 py-2 text-xs sm:grid-cols-[170px_1fr]"><dt className="text-gray-500">{label}</dt><dd className="break-words font-medium capitalize text-[#0D1B3E]">{value}</dd></div>)}</dl></section>;
}

function LiabilitySources({ rows }: { rows: LedgerRow[] }) {
  const total = rows.reduce((sum, row) => sum + Number(row.remaining_to_end || 0), 0);
  return <div className="mt-4 overflow-x-auto rounded-xl border border-violet-100"><table className="min-w-[860px] w-full text-left text-xs"><thead className="bg-violet-50 text-gray-600"><tr><th className="px-3 py-2">Created</th><th className="px-3 py-2">Reseller who earned</th><th className="px-3 py-2">New member referred</th><th className="px-3 py-2">Original earning</th><th className="px-3 py-2">Released</th><th className="px-3 py-2">Forfeited</th><th className="px-3 py-2">Still unpaid</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.id}><td className="px-3 py-2">{new Date(row.date).toLocaleString("en-PH")}</td><td className="px-3 py-2">{row.referrer_name} <span className="text-gray-400">@{row.referrer_username}</span></td><td className="px-3 py-2">{row.referred_name || "Unavailable"}</td><td className="px-3 py-2">{peso.format(row.amount)}</td><td className="px-3 py-2">{peso.format(row.paid_to_end)}</td><td className="px-3 py-2">{peso.format(row.forfeited_to_end)}</td><td className="px-3 py-2 font-bold text-violet-700">{peso.format(row.remaining_to_end)}</td></tr>)}{rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">No unpaid source records as of this date.</td></tr>}</tbody><tfoot className="border-t bg-slate-50 font-bold"><tr><td colSpan={6} className="px-3 py-2 text-right">Loaded unpaid total</td><td className="px-3 py-2 text-violet-700">{peso.format(total)}</td></tr></tfoot></table>{rows.length >= 500 && <p className="border-t bg-amber-50 px-3 py-2 text-amber-800">Showing the oldest 500 unpaid records. Narrow the end date for a bounded review.</p>}</div>;
}
