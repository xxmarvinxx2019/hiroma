"use client";

import { useEffect, useMemo, useState } from "react";
import { datePresetOptions, getDateRangePreset, type DateRangePreset } from "@/app/lib/dateRangePresets";

type Breakdown = { key: string; label: string; events: number; amount: number; points: number };
type RecordRow = { id: string; created_at: string; category: string; reason: string; data_quality: string; amount: number; recorded_points: number; exact_pairs: number; member_name: string | null; member_username: string | null; package_name: string | null; package_source: string; recipient_name: string | null; source_name: string | null };
type Report = {
  accounting_ready: boolean;
  summary: { total_events: number; total_amount: number; affected_accounts: number; recorded_points: number; exact_binary_pairs: number; exact_events: number; legacy_events: number; exact_coverage_percent: number };
  categories: Breakdown[]; reasons: Breakdown[]; trend: Array<{ day: string; events: number; amount: number }>;
  records: RecordRow[]; pagination: { page: number; page_size: number; total_count: number; total_pages: number };
  notes: Record<string, string>; error?: string;
};
const initial = getDateRangePreset("this_month");
const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const categoryLabels: Record<string, string> = { direct_referral: "Direct referral", binary: "Binary pairing", product_binary: "Product binary", deactivation: "Deactivation" };

export default function FlushoutReportPage() {
  const [from, setFrom] = useState(initial.from), [to, setTo] = useState(initial.to);
  const [preset, setPreset] = useState<DateRangePreset>("this_month");
  const [category, setCategory] = useState("all"), [quality, setQuality] = useState("all"), [search, setSearch] = useState("");
  const [page, setPage] = useState(1), [data, setData] = useState<Report | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const load = async (start = from, end = to, nextPage = page, nextCategory = category, nextQuality = quality) => {
    setLoading(true); setError("");
    const params = new URLSearchParams({ from: start, to: end, category: nextCategory, quality: nextQuality, search, page: String(nextPage), page_size: "50" });
    try {
      const response = await fetch(`/api/admin/commission-testing/flushout-report?${params}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) throw new Error(payload?.error || "Unable to load flushout report.");
      setData(payload); setPage(payload.pagination.page);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load flushout report."); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => void load(initial.from, initial.to, 1), 0);
    return () => window.clearTimeout(timer);
    // Initial report range is intentionally fixed to the current month.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const choosePreset = (value: DateRangePreset) => {
    setPreset(value); if (value === "custom") return;
    const range = getDateRangePreset(value); setFrom(range.from); setTo(range.to); setPage(1); void load(range.from, range.to, 1);
  };
  const maxTrend = useMemo(() => Math.max(1, ...(data?.trend || []).map(row => row.amount)), [data?.trend]);
  const cards = data ? [
    ["Total retained by Hiroma", peso.format(data.summary.total_amount), `${data.summary.total_events} financial events`, "border-emerald-500"],
    ["Affected accounts", data.summary.affected_accounts.toLocaleString(), "Unique source / affected accounts", "border-blue-500"],
    ["Recorded overflow points", data.summary.recorded_points.toLocaleString(), "Points stored on overflow commissions", "border-amber-500"],
    ["Exact binary pairs", data.summary.exact_binary_pairs.toLocaleString(), "Available from audited event snapshots", "border-violet-500"],
    ["Exact data coverage", `${data.summary.exact_coverage_percent}%`, `${data.summary.exact_events} exact · ${data.summary.legacy_events} legacy`, "border-cyan-500"],
  ] : [];
  return <main className="mx-auto w-full max-w-[1500px] p-4 text-[#0D1B3E] sm:p-8">
    <header className="flex flex-col gap-4 border-b border-[#0D1B3E]/10 pb-6 xl:flex-row xl:items-end xl:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-[#C9A84C]">Commission accounting</p><h1 className="mt-1 text-2xl font-bold">Flushout Report</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">Audit every amount retained by Hiroma from commission overflow, caps, inactive accounts, and deactivation events.</p></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">Period<select value={preset} onChange={event => choosePreset(event.target.value as DateRangePreset)} className="mt-1 block rounded-lg border bg-white px-3 py-2 text-sm text-[#0D1B3E]">{datePresetOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {preset === "custom" && <><label className="text-xs text-slate-500">From<input type="date" value={from} onChange={event => setFrom(event.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" /></label><label className="text-xs text-slate-500">To<input type="date" value={to} onChange={event => setTo(event.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" /></label></>}
        <button onClick={() => void load(from, to, 1)} disabled={loading} className="rounded-lg bg-[#0D1B3E] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{loading ? "Loading…" : "Apply"}</button>
      </div>
    </header>
    {error && <div className="mt-5 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><span>{error}</span><button onClick={() => void load()} className="rounded-lg border border-red-300 px-3 py-1.5 font-semibold">Try again</button></div>}
    <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map(([label,value,note,color]) => <article key={label} className={`rounded-2xl border border-slate-200 border-t-4 ${color} bg-white p-5 shadow-sm`}><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-slate-500">{note}</p></article>)}</section>
    {data && data.summary.legacy_events > 0 && <aside className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>Historical data note:</b> Amounts and recorded points are exact, but {data.summary.legacy_events} older event{data.summary.legacy_events === 1 ? "" : "s"} did not save a separable reason or historical package snapshot. They are clearly marked “Legacy” below.</aside>}
    <section className="mt-5 grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <article className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Where the retained amount came from</h2><p className="mt-1 text-xs text-slate-500">Financial totals by commission source</p><div className="mt-4 space-y-3">{data?.categories.length ? data.categories.map(row => <div key={row.key}><div className="flex justify-between gap-4 text-sm"><span>{row.label} <small className="text-slate-400">({row.events})</small></span><b>{peso.format(row.amount)}</b></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#C9A84C]" style={{ width: `${data.summary.total_amount ? row.amount / data.summary.total_amount * 100 : 0}%` }} /></div></div>) : <p className="py-8 text-center text-sm text-slate-400">No flushout activity in this period.</p>}</div></article>
      <article className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Activity by day</h2><p className="mt-1 text-xs text-slate-500">Daily retained value; scroll horizontally for long periods</p><div className="mt-5 flex h-40 items-end gap-2 overflow-x-auto pb-1">{data?.trend.length ? data.trend.map(row => <div key={row.day} className="flex min-w-12 flex-1 flex-col items-center justify-end" title={`${new Date(row.day).toLocaleDateString("en-PH")} · ${peso.format(row.amount)} · ${row.events} events`}><span className="mb-1 text-[9px] text-slate-400">{row.events}</span><div className="w-full rounded-t bg-[#0D1B3E]" style={{ height: `${Math.max(5, row.amount / maxTrend * 110)}px` }} /><span className="mt-1 text-[9px] text-slate-400">{new Date(row.day).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</span></div>) : <p className="m-auto text-sm text-slate-400">No activity</p>}</div></article>
    </section>
    <section className="mt-5 rounded-2xl border bg-white">
      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-end"><div className="mr-auto"><h2 className="font-bold">Flushout event ledger</h2><p className="text-xs text-slate-500">Search and trace the underlying financial events</p></div><input value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void load(from, to, 1); }} placeholder="Member, username, reason, package…" className="min-w-64 rounded-lg border px-3 py-2 text-sm" /><select value={category} onChange={event => { const value=event.target.value; setCategory(value); setPage(1); void load(from,to,1,value,quality); }} className="rounded-lg border px-3 py-2 text-sm"><option value="all">All categories</option><option value="direct_referral">Direct referral</option><option value="binary">Binary pairing</option><option value="product_binary">Product binary</option><option value="deactivation">Deactivation</option></select><select value={quality} onChange={event => { const value=event.target.value; setQuality(value); setPage(1); void load(from,to,1,category,value); }} className="rounded-lg border px-3 py-2 text-sm"><option value="all">All data quality</option><option value="exact">Exact snapshots</option><option value="legacy">Legacy records</option></select><button onClick={() => void load(from,to,1)} className="rounded-lg bg-[#0D1B3E] px-4 py-2 text-sm font-semibold text-white">Search</button></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase text-slate-500"><tr>{["Date / event","Account","Category / reason","Package","Points / exact pairs","Retained amount","Quality"].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{data?.records.map(row => <tr key={row.id} className="align-top hover:bg-slate-50/60"><td className="px-4 py-3"><b className="block text-xs">{new Date(row.created_at).toLocaleString("en-PH")}</b><span className="font-mono text-[10px] text-slate-400">{row.id.slice(0,12)}…</span></td><td className="px-4 py-3"><b>{row.member_name || "Unidentified account"}</b><span className="block text-xs text-slate-500">{row.member_username ? `@${row.member_username}` : "No username"}</span>{row.source_name && row.source_name !== row.member_name && <span className="block text-[10px] text-slate-400">Source: {row.source_name}</span>}</td><td className="px-4 py-3"><span className="rounded-full bg-[#0D1B3E]/5 px-2 py-1 text-[10px] font-bold uppercase">{categoryLabels[row.category] || row.category}</span><p className="mt-2 max-w-xs text-xs text-slate-500">{row.reason}</p></td><td className="px-4 py-3">{row.package_name || "—"}<span className="block text-[10px] text-slate-400">{row.package_source}</span></td><td className="px-4 py-3"><b>{row.recorded_points.toLocaleString()}</b> points<span className="block text-xs text-slate-500">{row.data_quality === "exact" ? `${row.exact_pairs} exact pairs` : "Exact pair count unavailable"}</span></td><td className="px-4 py-3 font-bold text-emerald-700">{peso.format(row.amount)}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${row.data_quality === "exact" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{row.data_quality}</span></td></tr>)}{data && data.records.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-slate-400">No matching flushout events.</td></tr>}</tbody></table></div>
      {data && <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-slate-500"><span>Showing {data.pagination.total_count ? (data.pagination.page-1)*data.pagination.page_size+1 : 0}–{Math.min(data.pagination.page*data.pagination.page_size,data.pagination.total_count)} of {data.pagination.total_count}</span><div className="flex gap-2"><button disabled={page<=1||loading} onClick={() => void load(from,to,page-1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button><span className="px-2 py-1.5">Page {page} of {data.pagination.total_pages}</span><button disabled={page>=data.pagination.total_pages||loading} onClick={() => void load(from,to,page+1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button></div></div>}
    </section>
    {data && <details className="mt-5 rounded-xl border bg-white p-4 text-sm"><summary className="cursor-pointer font-bold">How to read this report</summary><div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">{Object.values(data.notes).map(note => <p key={note} className="rounded-lg bg-slate-50 p-3">{note}</p>)}</div></details>}
  </main>;
}
