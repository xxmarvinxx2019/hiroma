"use client";

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
  const [notice, setNotice] = useState("");
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [syncProgress, setSyncProgress] = useState<{ phase: "idle" | "checking" | "syncing" | "success" | "warning" | "failed"; processed: number; total: number; succeeded: number; failed: number; currentReceipt: string }>({ phase: "idle", processed: 0, total: 0, succeeded: 0, failed: 0, currentReceipt: "" });

  const load = useCallback(async () => {
    try {
      const localRows = (await listQueuedSales()).sort((a, b) => a.created_at.localeCompare(b.created_at));
      setQueue(localRows);
      if (!navigator.onLine) return true;
      const response = await fetch("/api/city/pos/transactions", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load synchronized transactions.");
      setSynced((result.transactions || []).slice(0, 20));
      setError("");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the synchronization center.");
      return false;
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

  async function synchronizeSale(sale: PosQueuedSale) {
    await saveQueuedSale({ ...sale, status: "syncing", error: undefined });
    try {
      const response = await fetch("/api/city/pos/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sale.payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Synchronization needs attention.");
      await deleteQueuedSale(sale.client_transaction_id);
      return true;
    } catch (reason) {
      await saveQueuedSale({
        ...sale,
        status: "needs_attention",
        error: reason instanceof Error ? reason.message : "Synchronization needs attention.",
      });
      return false;
    }
  }

  async function retry(sale: PosQueuedSale) {
    if (!online || retrying) return;
    setRetrying(sale.client_transaction_id);
    setError("");
    setNotice("");
    const synchronized = await synchronizeSale(sale);
    setRetrying(null);
    await load();
    setNotice(synchronized ? `${sale.receipt_number} was received safely by Hiroma.` : `${sale.receipt_number} still needs attention. Review its exact error below.`);
  }

  async function syncNow() {
    if (!online || retrying) return;
    setRetrying("__all__");
    setDisplayProgress(0);
    setSyncModalOpen(true);
    setError("");
    setNotice("");
    setSyncProgress({ phase: "checking", processed: 0, total: 0, succeeded: 0, failed: 0, currentReceipt: "" });
    try {
      const pending = (await listQueuedSales()).sort((a, b) => a.created_at.localeCompare(b.created_at));
      setSyncProgress({ phase: "checking", processed: 0, total: pending.length, succeeded: 0, failed: 0, currentReceipt: pending[0]?.receipt_number || "" });
      await new Promise((resolve) => window.setTimeout(resolve, 2800));
      if (pending.length > 0) setSyncProgress({ phase: "syncing", processed: 0, total: pending.length, succeeded: 0, failed: 0, currentReceipt: pending[0].receipt_number });
      let synchronized = 0;
      let needsAttention = 0;
      for (let index = 0; index < pending.length; index += 1) {
        const sale = pending[index];
        setDisplayProgress(Math.min(99, 90 + Math.round((index / pending.length) * 9)));
        setSyncProgress({ phase: "syncing", processed: index, total: pending.length, succeeded: synchronized, failed: needsAttention, currentReceipt: sale.receipt_number });
        if (await synchronizeSale(sale)) synchronized += 1;
        else needsAttention += 1;
        setDisplayProgress(Math.min(99, 90 + Math.round(((index + 1) / pending.length) * 9)));
        setSyncProgress({ phase: "syncing", processed: index + 1, total: pending.length, succeeded: synchronized, failed: needsAttention, currentReceipt: sale.receipt_number });
      }
      const refreshed = await load();
      if (!refreshed) {
        setSyncProgress({ phase: "failed", processed: pending.length, total: pending.length, succeeded: synchronized, failed: needsAttention + 1, currentReceipt: "" });
        return;
      }
      if (pending.length === 0) {
        setDisplayProgress(100);
        setNotice("Sync check complete. This device has no pending offline receipts, and the server confirmation list is refreshed.");
        setSyncProgress({ phase: "success", processed: 0, total: 0, succeeded: 0, failed: 0, currentReceipt: "" });
      } else if (needsAttention === 0) {
        setDisplayProgress(100);
        setNotice(`${synchronized} receipt${synchronized === 1 ? "" : "s"} synchronized successfully.`);
        setSyncProgress({ phase: "success", processed: pending.length, total: pending.length, succeeded: synchronized, failed: 0, currentReceipt: "" });
      } else {
        setDisplayProgress(100);
        setNotice(`${synchronized} synchronized; ${needsAttention} still need${needsAttention === 1 ? "s" : ""} attention. Review the exact receipt errors below.`);
        setSyncProgress({ phase: "warning", processed: pending.length, total: pending.length, succeeded: synchronized, failed: needsAttention, currentReceipt: "" });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Synchronization failed unexpectedly.");
      setSyncProgress((current) => ({ ...current, phase: "failed", failed: current.failed + 1, currentReceipt: "" }));
    } finally {
      setRetrying(null);
    }
  }

  useEffect(() => {
    if (syncProgress.phase === "checking") {
      const timer = window.setInterval(() => {
        setDisplayProgress((current) => Math.min(90, current + 2));
      }, 60);
      return () => window.clearInterval(timer);
    }
  }, [syncProgress.phase]);

  const progressPercent = displayProgress;

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
            <button disabled={!online || Boolean(retrying)} onClick={() => void syncNow()} className="rounded-xl bg-[#071638] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{retrying === "__all__" ? "Synchronizing…" : "Sync now"}</button>
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
      {syncModalOpen && syncProgress.phase !== "idle" && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#071638]/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="sync-progress-title">
          <section className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="bg-[#071638] p-5 text-white">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-[#d4af45]">Secure synchronization</p>
              <h2 id="sync-progress-title" className="mt-2 text-xl font-bold">{syncProgress.phase === "checking" ? "Checking device and server..." : syncProgress.phase === "syncing" ? "Synchronizing receipts" : syncProgress.phase === "success" ? "Synchronization successful" : syncProgress.phase === "warning" ? "Some receipts need attention" : "Synchronization failed"}</h2>
              <p className="mt-1 text-sm text-white/65">{syncProgress.phase === "checking" || syncProgress.phase === "syncing" ? "Keep this window open until the synchronization check is complete." : syncProgress.phase === "success" ? "The synchronization check is complete." : "Review the result below before closing this window."}</p>
            </header>
            <div className="p-5 sm:p-6">
              {(syncProgress.phase === "checking" || syncProgress.phase === "syncing" || syncProgress.phase === "success") && (
                <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-[#071638]">
                  {syncProgress.phase === "success" ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#071638] text-sm font-bold text-white" aria-hidden="true">✓</span> : <span className="mt-1 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[#075f91] border-t-transparent" aria-hidden="true" />}
                  <div>
                    <p className="text-sm font-bold">{syncProgress.phase === "checking" ? "Checking connection and pending records..." : syncProgress.phase === "syncing" ? `Processing ${syncProgress.processed + 1} of ${syncProgress.total}: ${syncProgress.currentReceipt}` : "This device is up to date"}</p>
                    <p className="mt-1 text-sm leading-5 text-slate-600">{syncProgress.phase === "success" ? "There are no offline receipts waiting to be sent. The latest server confirmations have also been refreshed." : "Please wait while Hiroma securely verifies this device and the server."}</p>
                  </div>
                </div>
              )}
              <div className="mt-5 h-4 overflow-hidden rounded-full border border-slate-200 bg-slate-100 shadow-inner" role="progressbar" aria-label="Synchronization progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
                <div
                  className="relative h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${progressPercent}%`,
                    background: syncProgress.phase === "failed" ? "#dc2626" : syncProgress.phase === "warning" ? "#d97706" : "linear-gradient(90deg, #071638 0%, #0369a1 55%, #38bdf8 100%)",
                  }}
                >
                  {(syncProgress.phase === "checking" || syncProgress.phase === "syncing") && <span className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/55 to-transparent" aria-hidden="true" />}
                </div>
              </div>
              <p className="mt-2 text-right text-xs font-bold text-gray-600">{progressPercent}%</p>
              {syncProgress.total > 0 ? (
                <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-500">Processed</p><b className="mt-1 block text-lg text-[#071638]">{syncProgress.processed}/{syncProgress.total}</b></div>
                  <div className="rounded-xl bg-green-50 p-3"><p className="text-xs text-green-700">Success</p><b className="mt-1 block text-lg text-green-800">{syncProgress.succeeded}</b></div>
                  <div className="rounded-xl bg-red-50 p-3"><p className="text-xs text-red-700">Failed</p><b className="mt-1 block text-lg text-red-800">{syncProgress.failed}</b></div>
                </div>
              ) : null}

              {(syncProgress.phase === "warning" || (syncProgress.phase === "success" && syncProgress.total > 0)) && notice ? <p className={`mt-5 rounded-xl border p-4 text-sm font-semibold ${syncProgress.phase === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-[#071638]"}`}>{notice}</p> : null}
              {syncProgress.phase === "failed" ? <p className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error || "Synchronization failed. Check the internet connection and try again."}</p> : null}
              <div className="mt-6 flex justify-end">
                <button type="button" disabled={syncProgress.phase === "checking" || syncProgress.phase === "syncing"} onClick={() => setSyncModalOpen(false)} className="rounded-xl bg-[#071638] px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{syncProgress.phase === "checking" || syncProgress.phase === "syncing" ? "Please wait..." : "Done"}</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
