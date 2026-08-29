"use client";

import { useCallback, useEffect, useState } from "react";

type Terminal = { id: string; name: string; receipt_code: string; platform: string | null; is_active: boolean; last_synced_at: string | null; shifts: Array<{ status: string }> };
type Pending = { terminal: Terminal; action: "deactivate" | "reactivate" } | null;

export default function PosTerminalManagement() {
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [ownerAccess, setOwnerAccess] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/city/pos/terminals", { cache: "no-store", credentials: "include" });
      if (response.status === 403) { setOwnerAccess(false); return; }
      if (!response.ok) throw new Error("Unable to load authorized POS devices.");
      const data = await response.json();
      setTerminals(Array.isArray(data.terminals) ? data.terminals : []);
      setOwnerAccess(true);
    } catch (error) {
      setOwnerAccess(true);
      setMessage(error instanceof Error ? error.message : "Unable to load authorized POS devices.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function applyAction() {
    if (!pending) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/city/pos/terminals", {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminal_id: pending.terminal.id, action: pending.action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to update this POS device safely.");
      const active = pending.action === "reactivate";
      setTerminals((current) => current.map((item) => item.id === pending.terminal.id ? { ...item, is_active: active } : item));
      setMessage(active ? `${pending.terminal.name} is authorized again.` : `${pending.terminal.name} is now blocked.`);
      setPending(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update this POS device safely.");
    } finally { setSaving(false); }
  }

  if (ownerAccess === false) return null;
  return (
    <>
      <details name="pos-settings" className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-2xl p-6 text-left marker:content-none">
          <span><span className="block text-xs font-bold uppercase tracking-[0.16em] text-[#a47b12]">Security</span><span className="mt-1 block text-xl font-bold text-[#08183d]">Authorized POS devices</span><span className="mt-1 block text-sm text-slate-500">Review and block browser installations connected to this business.</span></span>
          <span className="flex shrink-0 items-center gap-3">{ownerAccess && <span className="text-xs font-bold text-slate-500">{terminals.filter((item) => item.is_active).length} active</span>}<span aria-hidden="true" className="text-xl transition-transform group-open:rotate-180">⌄</span></span>
        </summary>
        <div className="border-t border-slate-200 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><p className="max-w-2xl text-sm leading-6 text-slate-500">Only the city distributor or branch owner can manage these devices. Blocking prevents the next online POS bootstrap; receipts and audit records are preserved.</p><button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-[#08183d] disabled:opacity-50">{loading ? "Refreshing…" : "Refresh list"}</button></div>
          {message && <p role="status" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-[#08183d]">{message}</p>}
          {loading ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Loading authorized POS devices…</p> : terminals.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No POS browser installation has been registered yet.</p> : (
            <div className="mt-4 space-y-3">{terminals.map((terminal) => <div key={terminal.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><div><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[#08183d]">{terminal.name}</p><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${terminal.is_active ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{terminal.is_active ? "Authorized" : "Blocked"}</span></div><p className="mt-1 text-xs text-slate-500">Device code {terminal.receipt_code}{terminal.platform ? ` · ${terminal.platform}` : ""}</p><p className="mt-1 text-xs text-slate-500">Last sync: {terminal.last_synced_at ? new Date(terminal.last_synced_at).toLocaleString() : "Not synced yet"}{terminal.shifts[0] ? ` · Latest shift: ${terminal.shifts[0].status}` : ""}</p></div><button type="button" onClick={() => setPending({ terminal, action: terminal.is_active ? "deactivate" : "reactivate" })} className={`rounded-xl px-4 py-2 text-sm font-bold ${terminal.is_active ? "border border-red-300 text-red-700" : "bg-[#08183d] text-white"}`}>{terminal.is_active ? "Block device" : "Authorize again"}</button></div>)}</div>
          )}
        </div>
      </details>
      {pending && <div role="dialog" aria-modal="true" aria-labelledby="terminal-action-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#020817]/75 p-4 backdrop-blur-sm"><div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl"><div className="bg-[#08183d] p-6 text-white"><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e0b83f]">POS device security</p><h2 id="terminal-action-title" className="mt-1 text-xl font-bold">{pending.action === "deactivate" ? "Block this device?" : "Authorize this device again?"}</h2></div><div className="space-y-5 p-6"><p className="text-sm leading-6 text-slate-600">{pending.action === "deactivate" ? `${pending.terminal.name} will be denied on its next online POS check. Existing receipts and audit records will not be deleted.` : `${pending.terminal.name} will regain access using its existing browser installation.`}</p><div className="flex justify-end gap-3"><button type="button" onClick={() => setPending(null)} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-[#08183d]">Cancel</button><button type="button" onClick={() => void applyAction()} disabled={saving} className={`rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${pending.action === "deactivate" ? "bg-red-700" : "bg-[#08183d]"}`}>{saving ? "Saving…" : pending.action === "deactivate" ? "Block device" : "Authorize device"}</button></div></div></div></div>}
    </>
  );
}
