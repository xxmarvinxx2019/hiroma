"use client";

import { useEffect, useState } from "react";
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
  remaining_to_end: number;
  referrer_name: string;
  referrer_username: string;
  referred_name: string | null;
  referred_username: string | null;
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
          label: "Payable Direct Referrals",
          value: data.summary.total_direct_referrals.toLocaleString(),
          note: "Direct referrals with a payable credit in this period",
          color: "text-emerald-700",
          bg: "from-emerald-700 to-emerald-500",
          icon: "👥",
        },
        {
          label: "Total Direct Referral Income",
          value: peso.format(data.summary.total_direct_referral_income),
          note: "Payable income created in this period",
          color: "text-blue-700",
          bg: "from-blue-700 to-blue-500",
          icon: "₱",
        },
        {
          label: "Total Paid",
          value: peso.format(data.summary.total_paid),
          note: data.data_notes.total_paid,
          color: "text-amber-700",
          bg: "from-orange-700 to-orange-500",
          icon: "💳",
        },
        {
          label: "Approved (Unreleased)",
          value: peso.format(data.summary.total_approved),
          note: data.data_notes.total_approved,
          color: "text-sky-700",
          bg: "from-sky-700 to-sky-500",
          icon: "⏳",
        },
        {
          label: "Net Liability Movement",
          value: peso.format(
            data.summary.total_direct_referral_income - data.summary.total_paid,
          ),
          note: "Income earned minus released direct-referral payouts in this period",
          color: "text-violet-700",
          bg: "from-purple-800 to-purple-500",
          icon: "🛡️",
        },
        {
          label: "Total Flashout",
          value: peso.format(data.summary.total_flashout),
          note: `${data.summary.flashout_events} excess / retained event${data.summary.flashout_events === 1 ? "" : "s"}`,
          color: "text-red-700",
          bg: "from-red-800 to-red-500",
          icon: "🔥",
        },
      ]
    : [];

  return (
    <main className="mx-auto w-full max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-4 border-b border-[#0D1B3E]/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">
            Commission Testing
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[#0D1B3E]">
            Direct Referral
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Track credited direct-referral income and flashout events by date
            range.
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
            Closing Direct Referral Liability as of {to}
          </p>
          <p className="mt-2 text-2xl font-bold text-violet-700">
            {peso.format(data.summary.total_reserve_liability)}
          </p>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            {data.data_notes.total_reserve_liability}
          </p>
        </section>
      )}

      <section className="mt-6 overflow-hidden rounded-xl border border-[#0D1B3E]/10 bg-white shadow-sm">
        <div className="border-b border-[#0D1B3E]/10 px-5 py-4">
          <h2 className="text-sm font-bold text-[#0D1B3E]">
            Direct Referral Ledger
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
                <th className="px-5 py-3">Referrer / Receiver</th>
                <th className="px-5 py-3">Referred member</th>
                <th className="px-5 py-3">Income</th>
                <th className="px-5 py-3">Paid</th>
                <th className="px-5 py-3">Reserve</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0D1B3E]/8">
              {!loading && data?.ledger.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
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
    </main>
  );
}
