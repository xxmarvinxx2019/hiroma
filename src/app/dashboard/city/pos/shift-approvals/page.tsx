"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type ShiftApproval = {
  id: string;
  reference: string;
  submitted_at: string;
  notes: string | null;
  can_review: boolean;
  cashier: { full_name: string; username: string };
  terminal: { name: string; code: string } | null;
  shift: {
    opened_at: string;
    counted_cash: number | null;
    expected_cash: number | null;
    variance: number | null;
  };
  items: Array<{
    id: string;
    product_name: string;
    expected_quantity: number;
    counted_quantity: number;
    damaged_quantity: number;
    expired_quantity: number;
    variance_quantity: number;
  }>;
};

const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });

export default function ShiftClosingApprovalsPage() {
  const [rows, setRows] = useState<ShiftApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<ShiftApproval | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/city/pos/shift-approvals", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load shift closings.");
      setRows(result.approvals || []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load shift closings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submitDecision() {
    if (!selected || !decision) return;
    const hasDifference = (selected.shift.variance || 0) !== 0 || selected.items.some((item) => item.variance_quantity !== 0);
    if ((decision === "reject" || hasDifference) && notes.trim().length < 5) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/city/inventory/audits/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: decision, notes }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the shift decision.");
      setNotice(decision === "approve" ? `${selected.reference} was approved and the shift was finalized.` : `${selected.reference} was returned for recount.`);
      setSelected(null);
      setDecision(null);
      setNotes("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save the shift decision.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-4 rounded-2xl bg-[#071638] p-6 text-white sm:flex-row sm:items-center">
          <div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af45]">Branch liquidation control</p><h1 className="mt-2 text-2xl font-bold">Approval Center</h1><p className="mt-1 text-sm text-white/65">Independently review each cashier&apos;s blind cash and inventory count before finalizing the Branch shift.</p></div>
          <Link href="/dashboard/city/pos" className="rounded-xl bg-[#d4af45] px-4 py-3 text-center text-sm font-bold text-[#071638]">Return to POS</Link>
        </header>
        <nav className="mt-4 grid gap-2 rounded-2xl border bg-white p-2 sm:grid-cols-3" aria-label="Approval type">
          <Link href="/dashboard/city/pos/approvals" className="rounded-xl px-4 py-3 text-center text-sm font-bold text-slate-600 hover:bg-slate-50">Sales Payments</Link>
          <Link href="/dashboard/city/pos/registration-approvals" className="rounded-xl px-4 py-3 text-center text-sm font-bold text-slate-600 hover:bg-slate-50">Registration Payments</Link>
          <Link href="/dashboard/city/pos/shift-approvals" className="rounded-xl bg-[#071638] px-4 py-3 text-center text-sm font-bold text-white">Shift Closings</Link>
        </nav>
        {error ? <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p> : null}
        {notice ? <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">{notice}</p> : null}
        <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
          <div className="border-b p-5"><h2 className="font-bold text-[#071638]">Cash and inventory counts awaiting review</h2><p className="mt-1 text-xs text-gray-500">The person who submitted a count cannot approve it. Differences require a written review note.</p></div>
          {loading ? <p className="p-10 text-center text-sm text-gray-400">Loading shift closings…</p> : rows.length === 0 ? <p className="p-10 text-center text-sm text-gray-400">No Branch shift closing is waiting for approval.</p> : <div className="divide-y">{rows.map((row) => {
            const hasDifference = (row.shift.variance || 0) !== 0 || row.items.some((item) => item.variance_quantity !== 0);
            return <article key={row.id} className="p-5">
              <div className="flex flex-col justify-between gap-3 lg:flex-row">
                <div><b className="text-[#071638]">{row.reference}</b><p className="mt-1 text-xs text-gray-500">Cashier: {row.cashier.full_name || row.cashier.username} · {row.terminal?.name || "POS terminal"} · submitted {new Date(row.submitted_at).toLocaleString("en-PH")}</p>{row.notes ? <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Cashier explanation: {row.notes}</p> : null}</div>
                <div className="grid grid-cols-3 gap-2 text-right text-xs"><div><span className="text-gray-500">Expected cash</span><b className="block text-sm">{peso(row.shift.expected_cash || 0)}</b></div><div><span className="text-gray-500">Counted cash</span><b className="block text-sm">{peso(row.shift.counted_cash || 0)}</b></div><div><span className="text-gray-500">Variance</span><b className={`block text-sm ${(row.shift.variance || 0) === 0 ? "text-green-700" : "text-red-700"}`}>{peso(row.shift.variance || 0)}</b></div></div>
              </div>
              <div className="mt-4 overflow-x-auto rounded-xl border"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-[#f7f8fb] text-gray-500"><tr><th className="p-3">Product</th><th className="p-3 text-right">System</th><th className="p-3 text-right">Physical</th><th className="p-3 text-right">Damaged</th><th className="p-3 text-right">Expired</th><th className="p-3 text-right">Variance</th></tr></thead><tbody className="divide-y">{row.items.map((item) => <tr key={item.id}><td className="p-3 font-semibold text-[#071638]">{item.product_name}</td><td className="p-3 text-right">{item.expected_quantity}</td><td className="p-3 text-right">{item.counted_quantity}</td><td className="p-3 text-right">{item.damaged_quantity}</td><td className="p-3 text-right">{item.expired_quantity}</td><td className={`p-3 text-right font-bold ${item.variance_quantity === 0 ? "text-green-700" : "text-red-700"}`}>{item.variance_quantity > 0 ? "+" : ""}{item.variance_quantity}</td></tr>)}</tbody></table></div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className={`text-xs font-semibold ${hasDifference ? "text-red-700" : "text-green-700"}`}>{hasDifference ? "A difference exists. Verify the physical count and explanation before deciding." : "Cash and inventory match the system records."}</p>{row.can_review ? <div className="flex gap-2"><button onClick={() => { setSelected(row); setDecision("reject"); setNotes(""); }} className="rounded-xl border border-red-200 px-4 py-2 text-xs font-bold text-red-700">Return for Recount</button><button onClick={() => { setSelected(row); setDecision("approve"); setNotes(""); }} className="rounded-xl bg-[#187443] px-4 py-2 text-xs font-bold text-white">Approve & Finalize</button></div> : <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">A different authorized manager must review this submission.</p>}</div>
            </article>;
          })}</div>}
        </section>
      </div>
      {selected && decision ? <div className="fixed inset-0 z-50 grid place-items-center bg-[#071638]/70 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-bold text-[#071638]">{decision === "approve" ? "Finalize this Branch shift?" : "Return this shift for recount?"}</h2><p className="mt-2 text-sm leading-6 text-gray-600">{decision === "approve" ? "Approval accepts accountability for the cash and inventory results and finalizes the cashier shift." : "The shift will reopen only for the original cashier to recount and explain the difference."}</p><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Independent review note" className="mt-4 w-full rounded-xl border p-3 text-sm outline-none focus:border-[#d4af45]" /><div className="mt-5 flex justify-end gap-2"><button disabled={saving} onClick={() => setSelected(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Go Back</button><button disabled={saving || ((decision === "reject" || (selected.shift.variance || 0) !== 0 || selected.items.some((item) => item.variance_quantity !== 0)) && notes.trim().length < 5)} onClick={submitDecision} className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 ${decision === "approve" ? "bg-[#187443]" : "bg-red-600"}`}>{saving ? "Saving…" : decision === "approve" ? "Confirm & Finalize" : "Confirm Recount"}</button></div></div></div> : null}
    </main>
  );
}
