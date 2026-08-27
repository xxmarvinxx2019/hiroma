"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { deleteQueuedSale, listQueuedSales, PosQueuedSale, saveQueuedSale } from "@/app/lib/posOfflineQueue";

type SyncedTransaction = {
  id: string;
  client_transaction_id: string;
  receipt_number: string;
  status: string;
  server_received_at: string;
};

const statusStyle: Record<PosQueuedSale["status"], string> = {
  saved_offline: "bg-amber-100 text-amber-800",
  syncing: "bg-blue-100 text-blue-800",
  needs_attention: "bg-red-100 text-red-700",
};

const statusLabel: Record<PosQueuedSale["status"], string> = {
  saved_offline: "Saved offline",
  syncing: "Syncing",
  needs_attention: "Needs attention",
};

export default function PosSyncCenterPage() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [queue, setQueue] = useState<PosQueuedSale[]>([]);
  const [synced, setSynced] = useState<SyncedTransaction[]>([]);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const localRows = (await listQueuedSales()).sort((a, b) => a.created_at.localeCompare(b.created_at));
      setQueue(localRows);
      if (!navigator.onLine) return;
      const response = await fetch("/api/city/pos/transactions", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load synchronized transactions.");
      setSynced((result.transactions || []).slice(0, 20));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the synchronization center.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const updateConnection = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void load();
    };
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, [load]);

  async function retry(sale: PosQueuedSale) {
    if (!online || retrying) return;
    setRetrying(sale.client_transaction_id);
    setError("");
    await saveQueuedSale({ ...sale, status: "syncing", error: undefined });
    await load();
    try {
      const response = await fetch("/api/city/pos/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sale.payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Synchronization needs attention.");
      await deleteQueuedSale(sale.client_transaction_id);
    } catch (reason) {
      await saveQueuedSale({
        ...sale,
        status: "needs_attention",
        error: reason instanceof Error ? reason.message : "Synchronization needs attention.",
      });
    } finally {
      setRetrying(null);
      await load();
    }
  }

  async function retryAll() {
    if (!online || retrying) return;
    for (const sale of queue) await retry(sale);
  }

  return (
    <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-4 rounded-2xl bg-[#071638] p-6 text-white sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af45]">Cashier workspace</p>
            <h1 className="mt-2 text-2xl font-bold">Synchronization Center</h1>
            <p className="mt-1 text-sm text-white/65">Monitor offline receipts and safely synchronize them without changing their permanent reference numbers.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full px-3 py-2 text-xs font-bold ${online ? "bg-emerald-400/15 text-emerald-200" : "bg-red-400/15 text-red-200"}`}>{online ? "● Online" : "○ Offline"}</span>
            <Link href="/dashboard/city/pos" className="rounded-xl bg-[#d4af45] px-4 py-2 text-sm font-bold text-[#071638]">Return to POS</Link>
          </div>
        </header>

        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
        {!online && <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">The terminal is offline. Saved cash transactions remain protected on this device and will not be deleted. Reconnect before retrying synchronization.</p>}

        <section className="mt-5 grid gap-4 sm:grid-cols-3">
          <article className="rounded-2xl border bg-white p-5">
            <p className="text-xs font-bold uppercase text-gray-500">Awaiting sync</p>
            <b className="mt-2 block text-2xl text-[#071638]">{queue.filter((row) => row.status !== "needs_attention").length}</b>
            <p className="mt-1 text-xs text-gray-500">Stored safely on this device</p>
          </article>
          <article className="rounded-2xl border bg-white p-5">
            <p className="text-xs font-bold uppercase text-gray-500">Needs attention</p>
            <b className="mt-2 block text-2xl text-red-700">{queue.filter((row) => row.status === "needs_attention").length}</b>
            <p className="mt-1 text-xs text-gray-500">Review the exact message before retrying</p>
          </article>
          <article className="rounded-2xl border bg-white p-5">
            <p className="text-xs font-bold uppercase text-gray-500">Device status</p>
            <b className={`mt-2 block text-lg ${queue.length === 0 ? "text-green-700" : "text-amber-700"}`}>{queue.length === 0 ? "Fully synchronized" : "Synchronization required"}</b>
            <p className="mt-1 text-xs text-gray-500">Shift closing remains locked while records are pending</p>
          </article>
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
          <div className="flex flex-col justify-between gap-3 border-b p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-bold text-[#071638]">Offline transaction queue</h2>
              <p className="mt-1 text-xs text-gray-500">Receipt identity, queue status, and errors only. Running sales and expected cash are intentionally hidden.</p>
            </div>
            <button disabled={!online || queue.length === 0 || Boolean(retrying)} onClick={() => void retryAll()} className="rounded-xl bg-[#071638] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{retrying ? "Synchronizing…" : "Retry all"}</button>
          </div>
          <div className="divide-y">
            {queue.length ? queue.map((sale) => (
              <article key={sale.client_transaction_id} className="p-5">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <b className="text-sm text-[#071638]">{sale.receipt_number}</b>
                    <p className="mt-1 text-xs text-gray-500">Saved {new Date(sale.created_at).toLocaleString("en-PH")}</p>
                    <span className={`mt-3 inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ${statusStyle[sale.status]}`}>{statusLabel[sale.status]}</span>
                    {sale.error && <p className="mt-3 max-w-3xl rounded-lg bg-red-50 p-3 text-xs font-semibold leading-5 text-red-700">{sale.error}</p>}
                  </div>
                  <button disabled={!online || Boolean(retrying)} onClick={() => void retry(sale)} className="rounded-xl border border-[#071638] px-4 py-2 text-xs font-bold text-[#071638] disabled:cursor-not-allowed disabled:opacity-40">Retry sync</button>
                </div>
              </article>
            )) : <p className="p-10 text-center text-sm text-gray-400">No offline transactions are waiting on this device.</p>}
          </div>
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
          <div className="border-b p-5">
            <h2 className="font-bold text-[#071638]">Recently received by Hiroma</h2>
            <p className="mt-1 text-xs text-gray-500">Confirmation that the server received the transaction. No running financial totals are displayed.</p>
          </div>
          <div className="divide-y">
            {synced.length ? synced.map((row) => (
              <article key={row.id} className="flex flex-col justify-between gap-2 p-5 sm:flex-row sm:items-center">
                <div>
                  <b className="text-sm text-[#071638]">{row.receipt_number}</b>
                  <p className="mt-1 text-xs text-gray-500">Received {new Date(row.server_received_at).toLocaleString("en-PH")}</p>
                </div>
                <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${row.status === "finalized" ? "bg-green-100 text-green-700" : row.status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{row.status === "finalized" ? "Synced" : row.status === "rejected" ? "Rejected" : "Received · pending review"}</span>
              </article>
            )) : <p className="p-10 text-center text-sm text-gray-400">No synchronized receipts in the current shift yet.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
