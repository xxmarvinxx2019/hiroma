"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listQueuedSales } from "@/app/lib/posOfflineQueue";

type History = {
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
  const [error, setError] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [closing, setClosing] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [localPending, setLocalPending] = useState(0);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/city/pos/transactions", {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load shift history.");
      setData(result);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load shift history.");
    }
  }, []);
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
    if (!online || localPending > 0 || !data?.shift || data.shift.status !== "open" || !data.server_sync_complete || !Number.isFinite(Number(countedCash)) || Number(countedCash) < 0) return;
    setClosing(true);
    setError("");
    try {
      const response = await fetch("/api/city/pos/shifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shift_id: data.shift.id,
          counted_cash: Number(countedCash),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to close shift.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to close shift.");
    } finally {
      setClosing(false);
    }
  }

  return (
    <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-3 rounded-2xl bg-[#071638] p-6 text-white sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af45]">Cashier workspace</p>
            <h1 className="mt-2 text-2xl font-bold">Current Shift History</h1>
            <p className="mt-1 text-sm text-white/65">Your receipts and recorded payment destinations for this cashier shift.</p>
          </div>
          <Link href="/dashboard/city/pos" className="rounded-xl bg-[#d4af45] px-4 py-3 text-center text-sm font-bold text-[#071638]">
            Return to POS
          </Link>
        </header>
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
        {!data?.shift ? (
          <section className="mt-5 rounded-2xl border bg-white p-10 text-center text-gray-500">No cashier shift history yet.</section>
        ) : (
          <>
            <section className="mt-5 grid gap-4 sm:grid-cols-3">
              <article className="rounded-2xl border bg-white p-5">
                <p className="text-xs font-bold uppercase text-gray-500">Shift status</p>
                <b className="mt-2 block text-xl capitalize text-[#071638]">{data.shift.status.replace("_", " ")}</b>
                <p className="mt-1 text-xs text-gray-500">Opened {new Date(data.shift.opened_at).toLocaleString("en-PH")}</p>
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
                  data.transactions.map((row) => (
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
                        <span className={`ml-2 rounded-full px-2 py-1 font-bold ${row.status === "finalized" ? "bg-green-100 text-green-700" : row.status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{row.status === "finalized" ? "Paid" : row.status === "rejected" ? "Rejected" : "Pending verification"}</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="p-10 text-center text-sm text-gray-400">No completed sales in this shift.</p>
                )}
              </div>
            </section>
            {data.shift.status === "open" ? (
              <section className="mt-5 rounded-2xl border border-[#d4af45]/50 bg-[#fffaf0] p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <h2 className="font-bold text-[#071638]">Close cashier shift</h2>
                    <p className="mt-1 text-sm text-gray-600">Count the physical cash in the drawer without seeing the expected amount. The system reveals the variance only after submission.</p>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${online && data.server_sync_complete && localPending === 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>{!online ? "Offline · close locked" : localPending > 0 ? `${localPending} saved on this device` : data.server_sync_complete ? "Online · fully synced" : `${data.pending_sync_count} awaiting sync`}</span>
                </div>
                {(!online || localPending > 0 || !data.server_sync_complete) && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold leading-5 text-red-700">Final shift closing is locked. Reconnect to the internet and synchronize every transaction first so today’s liquidation remains complete and accurate.</p>}
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <label className="flex-1 text-xs font-bold">
                    Counted drawer cash
                    <input disabled={!online || localPending > 0 || !data.server_sync_complete} type="number" min="0" step=".01" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} className="mt-2 w-full rounded-xl border bg-white px-4 py-3 text-base outline-none disabled:cursor-not-allowed disabled:bg-gray-100" />
                  </label>
                  <button disabled={!online || localPending > 0 || !data.server_sync_complete || closing || countedCash === "" || Number(countedCash) < 0} onClick={closeShift} className="self-end rounded-xl bg-[#071638] px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                    {closing ? "Closing safely…" : "Submit Count & Close"}
                  </button>
                </div>
              </section>
            ) : (
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
            )}
          </>
        )}
      </div>
    </main>
  );
}
