"use client";

import { useCallback, useEffect, useState } from "react";
import PosCloseShiftModal from "@/app/components/pos/PosCloseShiftModal";

type History = {
  access: { can_audit: boolean; view: "mine" | "audit" };
  selected_cashier?: { id: string; name: string; username: string };
  selected_terminal?: { id: string; name: string; code: string };
  audit_shifts: Array<{
    id: string;
    status: string;
    opened_at: string;
    closed_at: string | null;
    cashier_id: string;
    cashier_name: string;
    terminal_name: string;
    terminal_code: string;
    receipt_count: number;
  }>;
  branch_closing: {
    required: boolean;
    inventory: Array<{ product_id: string; product_name: string }>;
  };
  shift: null | {
    id: string;
    status: string;
    opening_cash: number;
    expected_cash: number | null;
    counted_cash: number | null;
    variance: number | null;
    opened_at: string;
    local_closed_at: string | null;
    closing_explanation: string | null;
  };
  totals_hidden_until_close: boolean;
  pending_sync_count: number;
  server_sync_complete: boolean;
  payment_groups: Array<{
    method: string;
    count: number;
    amount: number | null;
    provider_verified: boolean;
    pending_count: number;
  }>;
  transactions: Array<{
    id: string;
    receipt_number: string;
    status: string;
    transaction_type: string;
    customer_name_snapshot: string;
    payment_method_snapshot: string;
    payment_reference: string | null;
    total: number;
    finalized_at: string | null;
    server_received_at: string;
    items: Array<{
      product_name_snapshot: string;
      quantity: number;
      subtotal: number;
    }>;
  }>;
};

type CashManagement = {
  access: { can_approve: boolean; view: "mine" | "audit" };
  summary: { opening_cash: number; cash_sales: number; cash_refunds: number; paid_in: number; paid_out: number; pending_paid_out: number };
  movements: Array<{ id: string; movement_type: "paid_in" | "paid_out"; status: string; amount: number; purpose: string; notes: string; reference: string | null; requested_at: string; requested_by_id: string; requested_by_name: string; reviewed_by_name: string | null }>;
};

const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });

export default function PosShiftHistoryPage() {
  const [data, setData] = useState<History | null>(null);
  const [view, setView] = useState<"mine" | "audit">("mine");
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [cashData, setCashData] = useState<CashManagement | null>(null);
  const [cashModal, setCashModal] = useState(false);
  const [closeShiftModal, setCloseShiftModal] = useState(false);
  const [movementType, setMovementType] = useState<"paid_in" | "paid_out">("paid_in");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementPurpose, setMovementPurpose] = useState("change_fund");
  const [movementNotes, setMovementNotes] = useState("");
  const [movementReference, setMovementReference] = useState("");
  const [movementRequestId, setMovementRequestId] = useState("");
  const [savingMovement, setSavingMovement] = useState(false);
  const [reviewingId, setReviewingId] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (view === "audit") params.set("view", "audit");
      if (view === "audit" && selectedShiftId) params.set("shift_id", selectedShiftId);
      if (view === "mine" && typeof window !== "undefined") {
        const linkedShiftId = new URLSearchParams(window.location.search).get("shift_id");
        if (linkedShiftId) params.set("shift_id", linkedShiftId);
      }
      const response = await fetch(`/api/city/pos/transactions${params.size ? `?${params}` : ""}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load shift history.");
      setData(result);
      setView(result.access?.view === "audit" ? "audit" : "mine");
      if (view === "audit" && !selectedShiftId && result.shift?.id) setSelectedShiftId(result.shift.id);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load shift history.");
    }
  }, [selectedShiftId, view]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const loadCash = useCallback(async (shiftId: string) => {
    try {
      const params = new URLSearchParams({ shift_id: shiftId });
      if (view === "audit") params.set("view", "audit");
      const response = await fetch(`/api/city/pos/cash-movements?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load cash management.");
      setCashData(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load cash management.");
    }
  }, [view]);
  useEffect(() => {
    const shiftId = data?.shift?.id;
    const timer = window.setTimeout(() => {
      if (!shiftId) {
        setCashData(null);
        return;
      }
      void loadCash(shiftId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data?.shift?.id, loadCash]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function submitCashMovement() {
    if (!data?.shift || !online || !movementAmount || movementNotes.trim().length < 5) return;
    setSavingMovement(true); setError(""); setNotice("");
    try {
      const clientRequestId = movementRequestId || crypto.randomUUID();
      if (!movementRequestId) setMovementRequestId(clientRequestId);
      const response = await fetch("/api/city/pos/cash-movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_request_id: clientRequestId, shift_id: data.shift.id, movement_type: movementType, amount: Number(movementAmount), purpose: movementPurpose, notes: movementNotes, reference: movementReference }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to record cash movement.");
      setNotice(movementType === "paid_in" ? "Paid-in cash was recorded in this shift ledger." : "Paid-out request submitted for independent approval. Do not remove cash until approved.");
      setCashModal(false); setMovementAmount(""); setMovementNotes(""); setMovementReference(""); setMovementRequestId("");
      await loadCash(data.shift.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to record cash movement."); }
    finally { setSavingMovement(false); }
  }

  async function reviewPaidOut(movementId: string, action: "approve" | "reject") {
    if (reviewNotes.trim().length < 5) { setError("Enter a review note of at least 5 characters."); return; }
    setReviewingId(movementId); setError("");
    try {
      const response = await fetch("/api/city/pos/cash-movements", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ movement_id: movementId, action, notes: reviewNotes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to review paid-out request.");
      setReviewNotes(""); setNotice(`Paid-out request ${action === "approve" ? "approved" : "rejected"}.`);
      if (data?.shift?.id) await loadCash(data.shift.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to review paid-out request."); }
    finally { setReviewingId(""); }
  }

  const nonCashGroups = data?.payment_groups.filter((group) => group.method.toLowerCase() !== "cash") || [];
  const approvedNonCashTotal = nonCashGroups.reduce((sum, group) => sum + Number(group.amount || 0), 0);
  const pendingNonCashCount = nonCashGroups.reduce((sum, group) => sum + group.pending_count, 0);

  return (
    <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-3 rounded-2xl bg-[#071638] p-6 text-white sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af45]">Cashier workspace</p>
            <h1 className="mt-2 text-2xl font-bold">{view === "audit" ? "Cashier Shift Audit" : "Shift"}</h1>
            <p className="mt-1 text-sm text-white/65">{view === "audit" ? "Review one cashier and terminal shift at a time without mixing accountability." : "Manage this cashier shift, drawer movements, and close-out safely."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {view === "mine" && data?.shift?.status === "open" ? <><button onClick={() => setCashModal(true)} className="rounded-xl border border-white/30 px-4 py-3 text-sm font-bold text-white">Cash Management</button><button onClick={() => setCloseShiftModal(true)} className="rounded-xl bg-[#d4af45] px-4 py-3 text-sm font-bold text-[#071638]">Close Shift</button></> : null}
            {view === "mine" && data?.shift?.status === "needs_review" ? <button onClick={() => setCloseShiftModal(true)} className="rounded-xl bg-[#d4af45] px-4 py-3 text-sm font-bold text-[#071638]">Recount Shift</button> : null}
          </div>
        </header>
        {view === "audit" && data?.access.can_audit ? (
          <section className="mt-4 rounded-2xl border bg-white p-5">
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
              Cashier and shift to audit
              <select value={selectedShiftId || data.shift?.id || ""} onChange={(event) => { setSelectedShiftId(event.target.value); }} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm font-semibold text-[#071638] outline-none focus:border-[#d4af45]">
                {data.audit_shifts.map((row) => (
                  <option key={row.id} value={row.id}>{row.cashier_name} · {row.terminal_name} · {new Date(row.opened_at).toLocaleString("en-PH")} · {row.status.replaceAll("_", " ")} · {row.receipt_count} receipt{row.receipt_count === 1 ? "" : "s"}</option>
                ))}
              </select>
            </label>
            <p className="mt-2 text-xs text-gray-500">Each selection shows only that cashier&apos;s transactions for that specific terminal shift.</p>
          </section>
        ) : null}
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
        {notice && <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">{notice}</p>}
        {!data?.shift ? (
          <section className="mt-5 rounded-2xl border bg-white p-10 text-center text-gray-500">No cashier shift history yet.</section>
        ) : (
          <>
            <section className="mt-5 grid gap-4 sm:grid-cols-3">
              <article className="rounded-2xl border bg-white p-5">
                <p className="text-xs font-bold uppercase text-gray-500">Shift status</p>
                <b className="mt-2 block text-xl capitalize text-[#071638]">{data.shift.status.replace("_", " ")}</b>
                <p className="mt-1 text-xs text-gray-500">Opened {new Date(data.shift.opened_at).toLocaleString("en-PH")}</p>
                {data.selected_cashier ? <p className="mt-2 text-xs font-semibold text-[#071638]">{data.selected_cashier.name} · {data.selected_terminal?.name}</p> : null}
              </article>
              <article className="rounded-2xl border bg-white p-5">
                <p className="text-xs font-bold uppercase text-gray-500">Receipts</p>
                <b className="mt-2 block text-xl text-[#071638]">{data.transactions.length}</b>
                <p className="mt-1 text-xs text-gray-500">Only transactions recorded under your shift</p>
              </article>
              <article className="rounded-2xl border bg-white p-5">
                <p className="text-xs font-bold uppercase text-gray-500">Cash reconciliation</p>
                <b className="mt-2 block text-xl text-[#071638]">{data.shift.status === "open" ? "Hidden until close" : data.shift.variance == null ? "—" : `${data.shift.variance >= 0 ? "+" : ""}${peso(data.shift.variance)}`}</b>
                <p className="mt-1 text-xs text-gray-500">The cashier counts the drawer before seeing the expected cash.</p>
              </article>
            </section>
            {cashData ? <section className="mt-5 rounded-2xl border bg-white p-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="font-bold text-[#071638]">Cash drawer activity</h2><p className="mt-1 text-xs text-gray-500">Every drawer movement has a named purpose and audit trail. Expected drawer cash remains hidden until blind count.</p></div>{view === "mine" && data.shift.status === "open" ? <button disabled={!online} onClick={() => setCashModal(true)} className="rounded-xl bg-[#071638] px-4 py-3 text-sm font-bold text-white disabled:opacity-40">Cash Management</button> : null}</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[["Starting cash", cashData.summary.opening_cash], ["Cash payments", cashData.summary.cash_sales], ["Cash refunds", cashData.summary.cash_refunds], ["Paid in", cashData.summary.paid_in], ["Paid out", cashData.summary.paid_out]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-[#f7f8fb] p-4"><p className="text-xs text-gray-500">{label}</p><b className="mt-1 block text-base text-[#071638]">{peso(Number(value))}</b></div>)}</div>
              {cashData.summary.pending_paid_out > 0 ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">{cashData.summary.pending_paid_out} paid-out request{cashData.summary.pending_paid_out === 1 ? " is" : "s are"} pending. Cash must stay in the drawer and the shift cannot close until reviewed.</p> : null}
              {cashData.movements.length ? <div className="mt-4 overflow-hidden rounded-xl border"><div className="divide-y">{cashData.movements.map(row => <article key={row.id} className="flex flex-col justify-between gap-3 p-4 sm:flex-row"><div><b className="text-sm capitalize text-[#071638]">{row.movement_type.replace("_", " ")} · {row.purpose.replaceAll("_", " ")}</b><p className="mt-1 text-xs text-gray-500">{row.requested_by_name} · {new Date(row.requested_at).toLocaleString("en-PH")} · {row.notes}</p></div><div className="text-left sm:text-right"><b className="text-sm">{peso(row.amount)}</b><p className={`mt-1 text-xs font-bold capitalize ${row.status === "approved" || row.status === "applied" ? "text-green-700" : row.status === "pending" ? "text-amber-700" : "text-red-700"}`}>{row.status}</p></div>{view === "audit" && cashData.access.can_approve && row.movement_type === "paid_out" && row.status === "pending" ? <div className="w-full sm:w-72"><input value={reviewNotes} onChange={event => setReviewNotes(event.target.value)} placeholder="Independent review note" className="w-full rounded-lg border px-3 py-2 text-xs"/><div className="mt-2 flex gap-2"><button disabled={reviewingId === row.id} onClick={() => reviewPaidOut(row.id, "approve")} className="rounded-lg bg-green-700 px-3 py-2 text-xs font-bold text-white">Approve</button><button disabled={reviewingId === row.id} onClick={() => reviewPaidOut(row.id, "reject")} className="rounded-lg border border-red-300 px-3 py-2 text-xs font-bold text-red-700">Reject</button></div></div> : null}</article>)}</div></div> : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-gray-400">No paid-in or paid-out movement recorded.</p>}
            </section> : null}
            <section className="mt-5 rounded-2xl border bg-white p-5">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                <div>
                  <h2 className="font-bold text-[#071638]">Non-cash payments</h2>
                  <p className="mt-1 text-xs leading-5 text-gray-500">Approved GCash, e-wallet, and bank payments for this shift. These amounts never form part of the physical cash drawer.</p>
                </div>
                <div className="rounded-xl bg-[#eef4ff] px-4 py-3 text-right">
                  <p className="text-xs font-semibold text-gray-500">Approved total</p>
                  <b className="mt-1 block text-lg text-[#071638]">{peso(approvedNonCashTotal)}</b>
                </div>
              </div>
              {nonCashGroups.length ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {nonCashGroups.map((group) => (
                    <article key={group.method} className="rounded-xl border bg-[#f7f8fb] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <b className="text-sm text-[#071638]">{group.method}</b>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${group.provider_verified ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{group.provider_verified ? "Approved" : "Pending"}</span>
                      </div>
                      <p className="mt-3 text-lg font-bold text-[#071638]">{peso(Number(group.amount || 0))}</p>
                      <p className="mt-1 text-xs text-gray-500">{group.count} approved transaction{group.count === 1 ? "" : "s"}</p>
                      {group.pending_count > 0 ? <p className="mt-2 text-xs font-semibold text-amber-800">{group.pending_count} pending independent verification</p> : null}
                    </article>
                  ))}
                </div>
              ) : <p className="mt-4 rounded-xl border border-dashed p-6 text-center text-sm text-gray-400">No non-cash payment was recorded in this shift.</p>}
              {pendingNonCashCount > 0 ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">Pending payments are not included in the approved total and do not affect expected drawer cash.</p> : null}
            </section>            {view === "mine" && data.shift.status === "needs_review" ? (
              <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5">
                <h2 className="font-bold text-amber-950">Shift returned for recount</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-amber-950">Manager note: {data.shift.closing_explanation || "Please recount the drawer and every physical product."}</p>
                <p className="mt-1 text-sm leading-6 text-amber-900">Update the cash and inventory counts, then resubmit this same shift for independent review.</p>
                <button onClick={() => setCloseShiftModal(true)} className="mt-4 rounded-xl bg-[#071638] px-4 py-3 text-sm font-bold text-white">Recount & Resubmit</button>
              </section>
            ) : view === "mine" && data.shift.status === "locally_closed" ? (
              <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <h2 className="font-bold text-amber-950">Pending independent manager review</h2>
                <p className="mt-2 text-sm leading-6 text-amber-900">Your cash and inventory counts are locked. This terminal cannot open another shift until an authorized manager reviews and finalizes this submission.</p>
              </section>
            ) : data.shift.status === "finalized" || view === "audit" && data.shift.status !== "open" ? (
              <section className="mt-5 rounded-2xl border bg-white p-5">
                <h2 className="font-bold text-[#071638]">Shift reconciliation result</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Expected cash", data.shift.expected_cash],
                    ["Counted cash", data.shift.counted_cash],
                    ["Variance", data.shift.variance],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl bg-[#f7f8fb] p-4">
                      <p className="text-xs text-gray-500">{label}</p>
                      <b className="mt-1 block text-lg">{value == null ? "—" : peso(Number(value))}</b>
                    </div>
                  ))}
                </div>
              </section>
            ) : view === "audit" ? (
              <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">This shift is still open. Final expected cash and variance remain hidden until the assigned cashier counts and closes the shift.</section>
            ) : null}
          </>
        )}
      </div>
      <PosCloseShiftModal
        open={closeShiftModal}
        shiftId={data?.shift?.id || null}
        onClose={() => setCloseShiftModal(false)}
        onCompleted={async () => {
          const completedShiftId = data?.shift?.id;
          await load();
          if (completedShiftId) await loadCash(completedShiftId);
        }}
      />
      {cashModal && data?.shift ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#071638]/70 p-4" role="dialog" aria-modal="true" aria-label="Cash management"><section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#b18416]">Cash management</p><h2 className="mt-1 text-xl font-bold text-[#071638]">Record drawer cash movement</h2></div><button onClick={() => setCashModal(false)} className="rounded-lg border px-3 py-2 text-xs font-bold">Close</button></div><p className="mt-3 rounded-xl bg-[#f7f8fb] p-3 text-xs leading-5 text-gray-600">Paid In adds actual cash to the drawer immediately. Paid Out is only a request; do not remove cash until an independent manager approves it.</p><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => { setMovementType("paid_in"); setMovementPurpose("change_fund"); }} className={`rounded-xl border p-3 text-sm font-bold ${movementType === "paid_in" ? "bg-[#071638] text-white" : "bg-white"}`}>Paid In</button><button onClick={() => { setMovementType("paid_out"); setMovementPurpose("bank_deposit"); }} className={`rounded-xl border p-3 text-sm font-bold ${movementType === "paid_out" ? "bg-[#071638] text-white" : "bg-white"}`}>Paid Out</button></div><label className="mt-4 block text-xs font-bold">Amount<input type="number" min="0.01" step="0.01" value={movementAmount} onChange={event => setMovementAmount(event.target.value)} className="mt-2 w-full rounded-xl border px-4 py-3 text-base" /></label><label className="mt-4 block text-xs font-bold">Purpose<select value={movementPurpose} onChange={event => setMovementPurpose(event.target.value)} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm">{(movementType === "paid_in" ? [["change_fund", "Additional change / coins"], ["cash_float", "Additional cash float"], ["correction", "Cash correction"], ["other", "Other"]] : [["bank_deposit", "Bank deposit / remittance"], ["petty_cash", "Petty cash expense"], ["supplier_payment", "Supplier payment"], ["correction", "Cash correction"], ["other", "Other"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="mt-4 block text-xs font-bold">Explanation<textarea rows={3} value={movementNotes} onChange={event => setMovementNotes(event.target.value)} placeholder="Who authorized it and why was cash added or requested for removal?" className="mt-2 w-full rounded-xl border p-3 text-sm" /></label><label className="mt-4 block text-xs font-bold">Reference or recipient (optional)<input value={movementReference} onChange={event => setMovementReference(event.target.value)} className="mt-2 w-full rounded-xl border px-4 py-3 text-sm" /></label>{!online ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">Cash management requires an online connection so its audit trail cannot be lost or duplicated.</p> : null}<div className="mt-5 flex justify-end gap-2"><button onClick={() => setCashModal(false)} className="rounded-xl border px-4 py-3 text-sm font-bold">Cancel</button><button disabled={!online || savingMovement || Number(movementAmount) <= 0 || movementNotes.trim().length < 5} onClick={submitCashMovement} className="rounded-xl bg-[#d4af45] px-4 py-3 text-sm font-bold text-[#071638] disabled:opacity-40">{savingMovement ? "Saving…" : movementType === "paid_in" ? "Record Paid In" : "Submit Paid Out"}</button></div></section></div> : null}
    </main>
  );
}
