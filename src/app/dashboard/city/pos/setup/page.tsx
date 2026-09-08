"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const INSTALLATION_KEY = "hiroma_pos_installation_id";

export default function PosDeviceSetupPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let id = localStorage.getItem(INSTALLATION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(INSTALLATION_KEY, id);
    }
    const timer = window.setTimeout(() => setInstallationId(id), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function enroll(event: React.FormEvent) {
    event.preventDefault();
    if (!installationId) return;
    setBusy(true);
    setMessage("");
    try {
      const platform = `${navigator.platform || "Web"} · ${navigator.userAgent.includes("Mobile") ? "Mobile" : "Desktop"}`;
      const response = await fetch("/api/city/pos/enroll", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, installation_id: installationId, platform }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to enroll this device.");
      setMessage("Device authorized. Opening Hiroma POS…");
      window.setTimeout(() => router.push("/dashboard/city/pos"), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to enroll this device.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="min-h-[calc(100vh-5rem)] bg-[#f4f6fb] p-5 sm:p-8">
    <section className="mx-auto max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
      <header className="bg-[#071638] p-7 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d4af45]">Secure device setup</p>
        <h1 className="mt-2 text-2xl font-bold">Enroll this POS terminal</h1>
        <p className="mt-2 text-sm leading-6 text-white/65">Ask the Branch or City owner to generate a one-time code from POS Settings → Authorized POS devices.</p>
      </header>
      <form onSubmit={enroll} className="space-y-5 p-7">
        <label className="block text-sm font-bold text-[#08183d]">One-time enrollment code
          <input autoFocus autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" maxLength={14} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-lg uppercase tracking-widest outline-none focus:border-[#d4af45]" />
        </label>
        <div className="rounded-xl bg-slate-50 p-4 text-xs leading-5 text-slate-600"><strong className="block text-[#08183d]">This browser becomes one authorized terminal.</strong>The code expires after 15 minutes and can only be used once. Do not use private/incognito mode or clear this device’s site data.</div>
        {message && <p role="status" className={`rounded-xl p-3 text-sm font-semibold ${message.startsWith("Device authorized") ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{message}</p>}
        <button disabled={busy || !installationId || code.replace(/[^A-Z0-9]/gi, "").length !== 12} className="w-full rounded-xl bg-[#d4af45] px-5 py-3 font-bold text-[#071638] disabled:cursor-not-allowed disabled:opacity-40">{busy ? "Authorizing securely…" : "Confirm and enroll device"}</button>
        <a href="/dashboard/city/pos/settings" className="block text-center text-sm font-semibold text-slate-500 hover:text-[#08183d]">Return to POS Settings</a>
      </form>
    </section>
  </main>;
}
