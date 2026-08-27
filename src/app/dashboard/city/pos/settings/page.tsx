"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_POS_DEVICE_SETTINGS,
  loadPosDeviceSettings,
  PosDeviceSettings,
  savePosDeviceSettings,
} from "@/app/lib/posDeviceSettings";

type ReceiptIdentity = {
  name: string;
  address: string;
  address_source: "physical_outlet" | "registered_address";
  distributor_level: string | null;
  is_staff: boolean;
};

export default function PosSettingsPage() {
  const [settings, setSettings] = useState<PosDeviceSettings>(DEFAULT_POS_DEVICE_SETTINGS);
  const [receiptIdentity, setReceiptIdentity] = useState<ReceiptIdentity | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setSettings(loadPosDeviceSettings()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store", credentials: "include" })
      .then((response) => response.json())
      .then((data) => {
        if (!active || !data.user?.pos_receipt_identity) return;
        setReceiptIdentity({
          ...data.user.pos_receipt_identity,
          is_staff: Boolean(data.user.is_staff),
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function persist(next: PosDeviceSettings) {
    setSettings(next);
    savePosDeviceSettings(next);
  }

  function printTest() {
    const popup = window.open("", "hiroma-pos-printer-test", "width=420,height=640");
    if (!popup) {
      setMessage("Allow pop-ups for Hiroma POS, then try the printer test again.");
      return;
    }
    const width = settings.paperWidth === "58" ? "58mm" : "80mm";
    popup.document.write(`<!doctype html><html><head><title>Hiroma POS Printer Test</title><style>@page{size:${width} auto;margin:3mm}body{width:${width};margin:0;font-family:Arial,sans-serif;font-size:12px;color:#000}.center{text-align:center}.rule{border-top:1px dashed #000;margin:10px 0}</style></head><body><div class="center"><strong>HIROMA POINT OF SALE</strong><br>PRINTER TEST</div><div class="rule"></div><p>If this text printed clearly, confirm the test in POS Settings.</p><p>Paper: ${settings.paperWidth}mm</p><p>Drawer trigger: ${settings.autoOpenDrawer ? "Enabled in printer driver" : "Disabled"}</p><script>window.onload=()=>{window.print()}<\/script></body></html>`);
    popup.document.close();
    setAwaitingConfirmation(true);
    setMessage("After checking the paper and cash drawer, confirm the result below.");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="rounded-2xl bg-[#08183d] px-7 py-6 text-white">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#e0b83f]">Point of Sale</p>
        <h1 className="mt-1 text-2xl font-bold">Printer & Drawer Settings</h1>
        <p className="mt-1 text-sm text-slate-300">Configure and verify this specific cashier device.</p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-5 md:grid-cols-2">
          <label className="space-y-2 text-sm font-semibold text-[#08183d]">
            Receipt paper width
            <select className="w-full rounded-xl border border-slate-300 px-4 py-3" value={settings.paperWidth} onChange={(event) => persist({ ...settings, paperWidth: event.target.value === "58" ? "58" : "80", lastTestedAt: null })}>
              <option value="80">80 mm thermal paper</option>
              <option value="58">58 mm thermal paper</option>
            </select>
          </label>
          <label className="space-y-2 text-sm font-semibold text-[#08183d]">
            Device label (record only)
            <input className="w-full rounded-xl border border-slate-300 px-4 py-3" value={settings.printerName} placeholder="Example: Front Counter Printer" onChange={(event) => persist({ ...settings, printerName: event.target.value, lastTestedAt: null })} />
            <span className="block text-xs font-normal text-slate-500">For identifying this cashier station only. Windows selects the actual printer.</span>
          </label>
        </div>

        <label className="mt-5 flex items-start gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={settings.autoOpenDrawer} onChange={(event) => persist({ ...settings, autoOpenDrawer: event.target.checked, lastTestedAt: null })} />
          <span><strong className="block text-[#08183d]">Cash drawer connected through printer</strong>Record that this station is configured for drawer opening. The Windows printer driver performs the actual drawer trigger.</span>
        </label>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
          <div>
            <p className="font-semibold text-[#08183d]">Device verification</p>
            <p className={`text-sm ${settings.lastTestedAt ? "text-emerald-700" : "text-amber-700"}`}>{settings.lastTestedAt ? `Verified on this device · ${new Date(settings.lastTestedAt).toLocaleString()}` : "Not tested on this device"}</p>
          </div>
          <button type="button" onClick={printTest} className="rounded-xl bg-[#d8b23e] px-5 py-3 text-sm font-bold text-[#08183d]">Print test receipt</button>
        </div>

        {message && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
        {awaitingConfirmation && (
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => { persist({ ...settings, lastTestedAt: new Date().toISOString() }); setAwaitingConfirmation(false); setMessage("Printer setup verified on this device."); }}>Test printed correctly</button>
            <button type="button" className="rounded-xl border border-red-300 px-4 py-2 text-sm font-semibold text-red-700" onClick={() => { persist({ ...settings, lastTestedAt: null }); setAwaitingConfirmation(false); setMessage("Printer was not verified. Check the cable, selected printer, paper size, and printer driver."); }}>It did not print</button>
          </div>
        )}

        <p className="mt-5 text-xs leading-5 text-slate-500">Windows detects the USB printer and the system print dialog selects it. Hiroma records a verified status only after a user confirms a successful test print. A common cash drawer connects to the thermal printer through an RJ11/RJ12 cable, not directly to the browser.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#a47b12]">Receipt branch details</p>
            <h2 className="mt-1 text-xl font-bold text-[#08183d]">Branch or outlet details</h2>
            <p className="mt-1 text-sm text-slate-500">This exact identity is printed on POS receipts.</p>
          </div>
          {receiptIdentity ? (
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${receiptIdentity.address_source === "physical_outlet" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {receiptIdentity.address_source === "physical_outlet" ? "Using physical outlet address" : "Using registered address"}
            </span>
          ) : null}
        </div>

        {receiptIdentity ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Branch or outlet name</p>
                <p className="mt-1 font-bold text-[#08183d]">{receiptIdentity.name || "Not configured"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt address</p>
                <p className="mt-1 font-semibold leading-6 text-[#08183d]">{receiptIdentity.address || "No address configured"}</p>
              </div>
            </div>

            {receiptIdentity.address_source === "registered_address" ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                <strong className="block">No physical outlet address added</strong>
                The registered distributor or branch address is currently printed on receipts. If this POS operates from a physical store, the city distributor or branch owner should add the actual outlet name and address.
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
                <strong className="block">Physical outlet address is currently in use</strong>
                This saved physical branch or outlet address is printed on receipts.
              </div>
            )}

            {receiptIdentity.is_staff ? (
              <p className="text-sm text-slate-500">Only the city distributor or branch owner can update this identity from their Profile page.</p>
            ) : (
              <a href="/dashboard/city/profile" className="inline-flex rounded-xl bg-[#08183d] px-4 py-2.5 text-sm font-bold text-white">
                Update branch/outlet profile
              </a>
            )}
          </div>
        ) : (
          <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Loading receipt outlet identity...</p>
        )}
      </section>
    </div>
  );
}
