"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listQueuedSales } from "@/app/lib/posOfflineQueue";

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
  };
  totals_hidden_until_close: boolean;
  pending_sync_count: number;
  server_sync_complete: boolean;
  payment_groups: Array<{
    method: string;
    count: number;
    amount: number | null;
    provider_verified: boolean;
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

const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });

export default function PosShiftHistoryPage() {
  const [data, setData] = useState<History | null>(null);
  const [view, setView] = useState<"mine" | "audit">("mine");
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [receiptPage, setReceiptPage] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [inventoryCounts, setInventoryCounts] = useState<Record<string, { counted: string; damaged: string; expired: string }>>({});
  const [recountRequired, setRecountRequired] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [closing, setClosing] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [localPending, setLocalPending] = useState(0);
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
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        void listQueuedSales()
          .then((rows) => setLocalPending(rows.length))
          .catch(() => setLocalPending(1)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function closeShift() {
    if (!online || localPending > 0 || !data?.shift || !["open", "needs_review"].includes(data.shift.status) || !data.server_sync_complete || !Number.isFinite(Number(countedCash)) || Number(countedCash) < 0) return;
    setClosing(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/city/pos/shifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shift_id: data.shift.id,
          counted_cash: Number(countedCash),
          recount_confirmed: recountRequired,
          explanation,
          inventory_counts: data.branch_closing.required
            ? data.branch_closing.inventory.map((item) => ({
                product_id: item.product_id,
                counted_quantity: inventoryCounts[item.product_id]?.counted,
                damaged_quantity: inventoryCounts[item.product_id]?.damaged || 0,
                expired_quantity: inventoryCounts[item.product_id]?.expired || 0,
              }))
            : undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "SHIFT_RECOUNT_REQUIRED") setRecountRequired(true);
        throw new Error(result.error || "Unable to close shift.");
      }
      setNotice(result.pending_approval ? "Cash and inventory counts were submitted. This shift is locked and waiting for an independent manager review." : "Shift closed successfully.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to close shift.");
    } finally {
      setClosing(false);
    }
  }

  const receiptsPerPage = 10;
  const receiptPages = Math.max(1, Math.ceil((data?.transactions.length || 0) / receiptsPerPage));
  const visibleTransactions = (data?.transactions || []).slice((receiptPage - 1) * receiptsPerPage, receiptPage * receiptsPerPage);
  const inventoryCountComplete = !data?.branch_closing.required || data.branch_closing.inventory.every((item) => {
    const row = inventoryCounts[item.product_id];
    return row && row.counted !== "" && Number.isInteger(Number(row.counted)) && Number(row.counted) >= 0;
  });
  const explanationComplete = !data || data.shift?.status !== "needs_review" || explanation.trim().length >= 5;

  return (
    <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-3 rounded-2xl bg-[#071638] p-6 text-white sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af45]">Cashier workspace</p>
            <h1 className="mt-2 text-2xl font-bold">{view === "audit" ? "Cashier Shift Audit" : "Current Shift History"}</h1>
            <p className="mt-1 text-sm text-white/65">{view === "audit" ? "Review one cashier and terminal shift at a time without mixing accountability." : "Your receipts and recorded payment destinations for this cashier shift."}</p>
          </div>
          <Link href="/dashboard/city/pos" className="rounded-xl bg-[#d4af45] px-4 py-3 text-center text-sm font-bold text-[#071638]">
            Return to POS
          </Link>
        </header>
        {view === "audit" && data?.access.can_audit ? (
          <section className="mt-4 rounded-2xl border bg-white p-5">
            <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
              Cashier and shift to audit
              <select value={selectedShiftId || data.shift?.id || ""} onChange={(event) => { setSelectedShiftId(event.target.value); setReceiptPage(1); }} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-sm font-semibold text-[#071638] outline-none focus:border-[#d4af45]">
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
            <section className="mt-5 rounded-2xl border bg-white p-5">
              <h2 className="font-bold text-[#071638]">How payments were recorded</h2>
              <p className="mt-1 text-xs text-gray-500">Amounts remain hidden while the shift is open. Non-cash references are evidence only until an official provider webhook confirms settlement.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {data.payment_groups.map((group) => (
                  <article key={group.method} className="rounded-xl border bg-[#fafbfe] p-4">
                    <div className="flex justify-between gap-3">
                      <div>
                        <b className="text-sm text-[#071638]">{group.method}</b>
                        <p className="mt-1 text-xs text-gray-500">
                          {group.count} transaction
                          {group.count === 1 ? "" : "s"}
                        </p>
                      </div>
                      <b className="text-sm">{group.amount == null ? "Hidden" : peso(group.amount)}</b>
                    </div>
                    <p className={`mt-3 text-[11px] font-semibold ${group.provider_verified ? "text-green-700" : "text-amber-700"}`}>{group.provider_verified ? "Cash drawer reconciliation applies" : "Reference recorded · not provider-verified"}</p>
                  </article>
                ))}
              </div>
            </section>
            <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
              <div className="border-b p-5">
                <h2 className="font-bold text-[#071638]">Receipt history</h2>
                <p className="mt-1 text-xs text-gray-500">Visible only to the cashier who opened this shift.</p>
              </div>
              <div className="divide-y">
                {data.transactions.length ? (
                  visibleTransactions.map((row) => (
                    <article key={row.id} className="p-5">
                      <div className="flex flex-col justify-between gap-2 sm:flex-row">
                        <div>
                          <b className="text-sm text-[#071638]">
                            {row.receipt_number} · {row.customer_name_snapshot}
                          </b>
                          <p className="mt-1 text-xs text-gray-500">
                            {new Date(row.finalized_at || row.server_received_at).toLocaleString("en-PH")} · {row.transaction_type.replaceAll("_", " ")}
                          </p>
                        </div>
                        <b className="text-lg text-[#071638]">{peso(row.total)}</b>
                      </div>
                      <p className="mt-2 text-xs text-gray-600">{row.items.map((item) => `${item.quantity}× ${item.product_name_snapshot}`).join(" · ")}</p>
                      <div className="mt-3 rounded-lg bg-[#f7f8fb] p-3 text-xs">
                        <b>{row.payment_method_snapshot}</b>
                        {row.payment_reference ? <span className="ml-2 text-gray-500">Ref: {row.payment_reference}</span> : null}
                        <span className={`ml-2 rounded-full px-2 py-1 font-bold ${row.status === "finalized" ? "bg-green-100 text-green-700" : ["rejected", "voided", "refunded"].includes(row.status) ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{row.status === "finalized" ? "Paid" : row.status === "rejected" ? "Rejected" : row.status === "voided" ? "VOIDED" : row.status === "refunded" ? "REFUNDED" : "Pending verification"}</span>
                      </div>
                      {row.transaction_type === "member_sale" ? (
                        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
                          <b>Member/Reseller receipt · Not eligible for void or refund.</b> The purchase may include PU, rewards, commissions, rank progress, or wallet credits.
                        </p>
                      ) : (
                        <p className="mt-3 text-xs font-semibold text-emerald-700">Non-member/SRP receipt · Eligible for an independently reviewed void or refund request.</p>
                      )}
                    </article>
                  ))
                ) : (
                  <p className="p-10 text-center text-sm text-gray-400">No completed sales in this shift.</p>
                )}
              </div>
              {data.transactions.length > receiptsPerPage ? (
                <div className="flex flex-col items-center justify-between gap-3 border-t p-4 sm:flex-row">
                  <p className="text-xs text-gray-500">Showing {(receiptPage - 1) * receiptsPerPage + 1}–{Math.min(receiptPage * receiptsPerPage, data.transactions.length)} of {data.transactions.length} receipts</p>
                  <div className="flex items-center gap-2">
                    <button disabled={receiptPage === 1} onClick={() => setReceiptPage((page) => Math.max(1, page - 1))} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Previous</button>
                    <span className="px-2 text-xs font-semibold">Page {receiptPage} of {receiptPages}</span>
                    <button disabled={receiptPage === receiptPages} onClick={() => setReceiptPage((page) => Math.min(receiptPages, page + 1))} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Next</button>
                  </div>
                </div>
              ) : null}
            </section>
            {view === "mine" && ["open", "needs_review"].includes(data.shift.status) ? (
              <section className="mt-5 rounded-2xl border border-[#d4af45]/50 bg-[#fffaf0] p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <h2 className="font-bold text-[#071638]">{data.shift.status === "needs_review" ? "Recount returned shift" : "Submit end-of-shift counts"}</h2>
                    <p className="mt-1 text-sm text-gray-600">Count the physical cash and every Branch product without seeing the system&apos;s expected values. A manager independently reviews the committed count.</p>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${online && data.server_sync_complete && localPending === 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>{!online ? "Offline · close locked" : localPending > 0 ? `${localPending} saved on this device` : data.server_sync_complete ? "Online · fully synced" : `${data.pending_sync_count} awaiting sync`}</span>
                </div>
                {(!online || localPending > 0 || !data.server_sync_complete) && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold leading-5 text-red-700">Final shift closing is locked. Reconnect to the internet and synchronize every transaction first so today’s liquidation remains complete and accurate.</p>}
                {recountRequired ? <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">A difference was detected. Recount the cash and physical inventory carefully. If a difference remains, explain what was checked before submitting for manager review.</p> : null}
                <div className="mt-4">
                  <label className="block text-xs font-bold">
                    Counted drawer cash
                    <input disabled={!online || localPending > 0 || !data.server_sync_complete} type="number" min="0" step=".01" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-base outline-none disabled:cursor-not-allowed disabled:bg-gray-100" />
                  </label>
                </div>
                {data.branch_closing.required ? (
                  <div className="mt-5 overflow-hidden rounded-xl border bg-white">
                    <div className="border-b p-4"><h3 className="text-sm font-bold text-[#071638]">Blind physical inventory count</h3><p className="mt-1 text-xs text-gray-500">Expected quantities are intentionally hidden. Enter the physical quantity currently present.</p></div>
                    <div className="divide-y">
                      {data.branch_closing.inventory.map((item) => {
                        const count = inventoryCounts[item.product_id] || { counted: "", damaged: "", expired: "" };
                        return <div key={item.product_id} className="grid gap-3 p-4 sm:grid-cols-[1fr_120px_110px_110px] sm:items-end">
                          <p className="self-center text-sm font-bold text-[#071638]">{item.product_name}</p>
                          {([['counted', 'Physical count'], ['damaged', 'Damaged'], ['expired', 'Expired']] as const).map(([field, label]) => <label key={field} className="text-xs font-bold text-gray-600">{label}<input disabled={!online || localPending > 0 || !data.server_sync_complete} type="number" min="0" step="1" value={count[field]} onChange={(event) => setInventoryCounts((current) => ({ ...current, [item.product_id]: { ...(current[item.product_id] || { counted: "", damaged: "", expired: "" }), [field]: event.target.value } }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-center text-sm outline-none focus:border-[#d4af45] disabled:bg-gray-100" /></label>)}
                        </div>;
                      })}
                    </div>
                  </div>
                ) : null}
                {recountRequired || data.shift.status === "needs_review" ? <label className="mt-4 block text-xs font-bold text-gray-700">Recount explanation {recountRequired ? "(required if a difference remains)" : "(required)"}<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={3} placeholder="Describe the recount, missing/damaged items, cash issue, or corrective action taken." className="mt-2 w-full rounded-xl border bg-white p-3 text-sm font-normal outline-none focus:border-[#d4af45]" /></label> : null}
                <div className="mt-5 flex flex-col items-end gap-2 border-t pt-4">
                  {!inventoryCountComplete ? <p className="text-xs font-semibold text-amber-800">Enter a physical count for every product before submission.</p> : null}
                  {!explanationComplete ? <p className="text-xs font-semibold text-amber-800">Enter at least 5 characters explaining the recount or unresolved difference.</p> : null}
                  <button disabled={!online || localPending > 0 || !data.server_sync_complete || closing || countedCash === "" || Number(countedCash) < 0 || !inventoryCountComplete || !explanationComplete} onClick={closeShift} className="rounded-xl bg-[#071638] px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                    {closing ? "Submitting safely…" : "Submit Counts for Approval"}
                  </button>
                </div>
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
    </main>
  );
}
