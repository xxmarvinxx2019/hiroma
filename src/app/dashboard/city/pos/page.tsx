'use client'

import { useEffect, useState } from 'react'
import PosInstallControl from '@/app/components/pos/PosInstallControl'

type Bootstrap = {
  terminal: { id: string; name: string }
  location: { full_name: string; distributor_profile?: { dist_level: string; fulfillment_outlet_name?: string | null } | null } | null
  catalog: Array<{ product_id: string; name: string; stock: number }>
  open_shift: { id: string; opened_at: string } | null
}

export default function PointOfSalePage() {
  const [data, setData] = useState<Bootstrap | null>(null)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(true)
  const [showOpenShift, setShowOpenShift] = useState(false)
  const [openingCash, setOpeningCash] = useState('0')
  const [savingShift, setSavingShift] = useState(false)

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine)
    updateConnection()
    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)
    const installationKey = 'hiroma_pos_installation_id'
    let installationId = localStorage.getItem(installationKey)
    if (!installationId) {
      installationId = crypto.randomUUID()
      localStorage.setItem(installationKey, installationId)
    }
    const platform = `${navigator.platform || 'Web'} · ${navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'}`
    fetch('/api/city/pos/bootstrap', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installation_id: installationId, name: `POS ${installationId.slice(0, 8).toUpperCase()}`, platform }),
    }).then(async (response) => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to initialize POS.')
      setError('')
      setData(result)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to initialize POS.'))
    return () => {
      window.removeEventListener('online', updateConnection)
      window.removeEventListener('offline', updateConnection)
    }
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw-pos.js', { scope: '/dashboard/city/pos', updateViaCache: 'none' }).catch((reason) => {
      console.warn('[POS SERVICE WORKER]', reason)
    })
  }, [])

  async function openShift() {
    if (!data?.terminal.id) return
    setSavingShift(true)
    setError('')
    try {
      const response = await fetch('/api/city/pos/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminal_id: data.terminal.id, opening_cash: Number(openingCash) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to open shift.')
      setData((current) => current ? { ...current, open_shift: result.shift } : current)
      setShowOpenShift(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open shift.')
    } finally {
      setSavingShift(false)
    }
  }

  return <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6">
    <div className="mx-auto max-w-7xl">
      <header className="rounded-2xl bg-[#071638] p-5 text-white shadow-sm sm:p-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#d4af45]">Hiroma Point of Sale</p>
        <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div><h1 className="text-2xl font-bold">{data?.location?.distributor_profile?.fulfillment_outlet_name || data?.location?.full_name || 'Loading terminal…'}</h1><p className="mt-1 text-sm text-white/65">Dedicated cashier workspace · installable web POS · controlled offline queue</p></div>
          <div className="flex flex-col items-start gap-2 sm:items-end"><span className="w-fit rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold">{online ? '● Online' : '○ Offline'}</span><PosInstallControl /></div>
        </div>
      </header>

      {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}
      <section className="mt-5 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border bg-white p-5"><p className="text-xs font-bold uppercase text-gray-500">Terminal</p><p className="mt-2 text-lg font-bold text-[#071638]">{data?.terminal.name || 'Initializing…'}</p><p className="mt-1 text-sm text-gray-500">Bound to this browser installation</p></article>
        <article className="rounded-2xl border bg-white p-5"><p className="text-xs font-bold uppercase text-gray-500">Catalog Snapshot</p><p className="mt-2 text-lg font-bold text-[#071638]">{data ? `${data.catalog.length} products` : 'Loading…'}</p><p className="mt-1 text-sm text-gray-500">Admin prices remain read-only</p></article>
        <article className="rounded-2xl border bg-white p-5"><p className="text-xs font-bold uppercase text-gray-500">Shift</p><p className="mt-2 text-lg font-bold text-[#071638]">{data?.open_shift ? 'Open' : 'Not opened'}</p><p className="mt-1 text-sm text-gray-500">Final close requires successful sync</p></article>
      </section>

      <section className="mt-5 rounded-2xl border bg-white p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-lg font-bold text-[#071638]">{data?.open_shift ? 'Shift is open' : 'Start cashier operations'}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">{data?.open_shift ? 'This terminal is ready for the checkout workspace. Every sale will remain tied to this cashier shift.' : 'Enter the physical cash currently inside the drawer before accepting the first transaction.'}</p></div><button disabled={!data || Boolean(data.open_shift)} onClick={() => setShowOpenShift(true)} className="rounded-xl bg-[#d4af45] px-5 py-3 text-sm font-bold text-[#071638] disabled:cursor-not-allowed disabled:opacity-50">{data?.open_shift ? 'Shift Open' : 'Open Shift'}</button></div>
      </section>
      {showOpenShift && <div className="fixed inset-0 z-50 grid place-items-center bg-[#071638]/60 p-4" role="dialog" aria-modal="true" aria-labelledby="open-shift-title"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 id="open-shift-title" className="text-xl font-bold text-[#071638]">Open cashier shift</h2><p className="mt-2 text-sm leading-6 text-gray-600">Count the cash already in the drawer. This becomes the shift’s opening cash—not a sale.</p><label className="mt-5 block text-sm font-bold text-[#071638]">Opening cash</label><div className="mt-2 flex items-center rounded-xl border bg-[#f7f8fb] px-4 focus-within:border-[#d4af45]"><span className="font-bold text-gray-500">₱</span><input type="number" min="0" step="0.01" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} className="w-full bg-transparent px-3 py-3 text-lg font-bold outline-none" /></div><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setShowOpenShift(false)} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Cancel</button><button type="button" disabled={savingShift || Number(openingCash) < 0} onClick={openShift} className="rounded-xl bg-[#d4af45] px-4 py-2.5 text-sm font-bold text-[#071638] disabled:opacity-50">{savingShift ? 'Opening…' : 'Confirm & Open'}</button></div></div></div>}
    </div>
  </main>
}
