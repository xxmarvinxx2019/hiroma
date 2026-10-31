'use client'

import { useEffect, useState } from 'react'
import type { loadRewardStockWorkspace } from '@/app/lib/rewardStockReplacement'
import { readSettingsResponse } from '@/app/lib/settingsResponse'

type Workspace = Awaited<ReturnType<typeof loadRewardStockWorkspace>>
type DispatchIntent = { recipient_id: string; product_id: string; kind: string; quantity: number; client_request_id: string; recipient_name: string; product_name: string }
const kindLabel = (kind: string) => kind === 'internal_replenishment' ? 'Branch internal replenishment' : 'Distributor stock replacement'

export default function RewardStockReplacementPanel({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<Workspace | null>(null)
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [intent, setIntent] = useState<DispatchIntent | null>(null)
  const [sent, setSent] = useState(false)
  const [receiving, setReceiving] = useState<Workspace['shipments'][number] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/reward-stock-replacements?${new URLSearchParams({ page: String(page), search })}`, { cache: 'no-store', signal: controller.signal })
      .then(response => readSettingsResponse<Workspace>(response, 'Unable to load replacement stock.'))
      .then(payload => { if (!controller.signal.aborted) { setData(payload); setError('') } })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page, revision, search])

  function refresh() { setLoading(true); setRevision(value => value + 1) }
  async function act() {
    if (busy || (!intent && !receiving)) return
    setBusy(true); setError(''); setMessage(''); setSent(true)
    try {
      const response = await fetch('/api/reward-stock-replacements', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intent ? { action: 'dispatch', ...intent } : { action: 'receive', dispatch_id: receiving!.id }) })
      if (!response.ok && response.status >= 400 && response.status < 500) setSent(false)
      const result = await readSettingsResponse<{ reference: string; action: string }>(response, 'Unable to complete replacement action.')
      setMessage(`${result.action === 'received' ? 'Receipt confirmed' : 'Stock dispatched; recipient must confirm delivery'}. ${result.reference}`)
      setIntent(null); setReceiving(null); setSent(false); refresh()
      onChanged?.()
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to complete replacement action.') }
    finally { setBusy(false) }
  }

  const hasPending = data && (data.groups.length > 0 || data.summary.in_transit > 0 || data.summary.reserved > 0 || data.shipments.some(shipment => !shipment.received_at))

  return <details className="group/replacements my-4 rounded-xl border border-[#0D1B3E]/10 bg-white text-[#0D1B3E]">
    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="text-gray-400 transition-transform group-open/replacements:rotate-90">▸</span>
      <span className="font-semibold">Reward Stock Replacement</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${hasPending ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{loading ? 'Loading…' : error ? 'Check status' : hasPending ? 'Pending items' : 'No pending items'}</span>
      <span className="ml-auto text-xs text-gray-400">View balances &amp; shipments</span>
    </summary>
    <section className="overflow-hidden rounded-b-xl border-t border-[#0D1B3E]/10">
    <header className="flex items-start justify-between gap-4 border-b bg-amber-50 p-5"><div><h2 className="font-bold">Reward Stock Replacement</h2><p className="mt-1 text-xs text-gray-600">Independent distributors receive replacement stock credits. Hiroma branches use internal replenishment. These are bottle obligations, not cash rewards.</p></div><button type="button" disabled={loading || busy} onClick={refresh} className="rounded-lg border bg-white px-3 py-2 text-xs disabled:opacity-40">Refresh</button></header>
    {message && <p role="status" className="p-4 text-sm text-emerald-700 break-all">{message}</p>}
    {error && !intent && !receiving && <p role="alert" className="p-4 text-sm text-red-600">{error}</p>}
    {loading ? <p className="p-5 text-sm text-gray-500">Loading reward replacement ledger…</p> : data && <div className="space-y-5 p-5">
      <div className="grid gap-3 sm:grid-cols-4">{[
        ['Unused for this account', data.summary.pending], ['Reserved with paid orders', data.summary.reserved], ['Incoming for this account', data.summary.in_transit],
        [data.is_admin ? 'Company-wide open bottles' : 'Original outlet bottles replaced', data.is_admin ? data.summary.global_open : data.summary.origin_replaced],
      ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-gray-500">{label}</p><strong className="text-xl">{Number(value).toLocaleString()}</strong></div>)}</div>
      <p className="text-xs leading-5 text-gray-500">Dispatch deducts the supplier’s stock. Confirmed delivery adds bottles to the recipient and passes the same replacement balance to the supplying distributor. Hiroma supply completes the replacement. Branch replenishment stays internal. Do not confirm damaged, incomplete or missing deliveries.</p>
      <form onSubmit={event => { event.preventDefault(); setLoading(true); setSearch(query.trim()); setRevision(value => value + 1) }} className="flex gap-2">
        <label className="sr-only" htmlFor="reward-replacement-search">Search pending accounts or products</label><input id="reward-replacement-search" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="Find pending account or product" className="min-w-0 flex-1 rounded border px-3 py-2 text-sm" /><button type="submit" disabled={loading || busy} className="rounded border px-3 py-2 text-xs">Search</button>
      </form>
      {data.groups_has_more && <p className="text-xs text-amber-700">Showing the first 200 pending groups. Search by account or product to find more.</p>}
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="pb-3 text-left font-semibold">Pending replacement / replenishment</caption><thead className="bg-slate-50"><tr><th className="p-2">Account</th><th className="p-2">Product / type</th><th className="p-2">Bottles</th><th className="p-2">Your available stock</th><th className="p-2">Action</th></tr></thead><tbody className="divide-y">{data.groups.map(group => {
        const key = `${group.recipient_id}:${group.product_id}:${group.kind}`, max = Math.min(100, group.pending, group.available_stock)
        const quantity = quantities[key] ?? '1'
        return <tr key={key}><td className="p-2">{group.recipient_name}</td><td className="p-2">{group.product_name}<p className="mt-1 text-gray-500">{kindLabel(group.kind)}</p></td><td className="p-2">{group.pending}</td><td className="p-2">{group.can_supply ? group.available_stock : '—'}</td><td className="p-2">{group.can_supply && data.can_write ? <div className="flex gap-2"><label className="sr-only" htmlFor={key}>Bottles to dispatch</label><input id={key} type="number" min={1} max={max} value={quantity} disabled={busy || max < 1} onChange={event => setQuantities(current => ({ ...current, [key]: event.target.value }))} className="w-16 rounded border px-2 py-1" /><button type="button" disabled={busy || !Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(quantity) > max} onClick={() => { setIntent({ ...group, quantity: Number(quantity), client_request_id: crypto.randomUUID() }); setError(''); setSent(false) }} className="rounded bg-[#0D1B3E] px-3 py-1 text-white disabled:opacity-40">Dispatch</button></div> : <span className="text-gray-500">Awaiting authorized supplier</span>}</td></tr>
      })}{!data.groups.length && <tr><td colSpan={5} className="p-4 text-center text-gray-400">No pending replacement bottles.</td></tr>}</tbody></table></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="pb-3 text-left font-semibold">Replacement shipment history</caption><thead className="bg-slate-50"><tr><th className="p-2">Reference</th><th className="p-2">Supplier → recipient</th><th className="p-2">Product / bottles</th><th className="p-2">Status</th><th className="p-2">Action</th></tr></thead><tbody className="divide-y">{data.shipments.map(shipment => <tr key={shipment.id}><td className="max-w-48 break-all p-2"><code className="select-all">RS-{shipment.id}{shipment.combined_order_id && <span className="block text-amber-700">Combined with order {shipment.combined_order_id}</span>}</code><p className="mt-1 text-gray-500">{new Date(shipment.dispatched_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p></td><td className="p-2">{shipment.supplier_name} → {shipment.recipient_name}</td><td className="p-2">{shipment.quantity} × {shipment.product_name}<p className="text-gray-500">{kindLabel(shipment.kind)}</p></td><td className="p-2">{shipment.received_at ? <><strong className="text-emerald-700">Received</strong><p>{new Date(shipment.received_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p><p>{shipment.receipt_actor}</p></> : 'In transit'}</td><td className="p-2">{shipment.can_receive && data.can_write && <button type="button" disabled={busy} onClick={() => { setReceiving(shipment); setError(''); setSent(false) }} className="rounded border px-3 py-1">Confirm received</button>}</td></tr>)}{!data.shipments.length && <tr><td colSpan={5} className="p-4 text-center text-gray-400">No replacement shipments yet.</td></tr>}</tbody></table></div>
      <div className="flex justify-between text-xs"><button type="button" disabled={data.page <= 1} onClick={() => { setLoading(true); setPage(data.page - 1) }} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button><span>Page {data.page} of {data.total_pages}</span><button type="button" disabled={data.page >= data.total_pages} onClick={() => { setLoading(true); setPage(data.page + 1) }} className="rounded border px-3 py-1 disabled:opacity-40">Next</button></div>
      <details><summary className="cursor-pointer text-sm font-semibold">Original reward claims and replacement tracking</summary><p className="mt-2 text-xs text-gray-500">Latest 50 released bottles. Each bottle keeps the same replacement reference throughout the supplier chain.</p><ul className="mt-3 divide-y text-xs">{data.units.map(unit => <li key={unit.id} className="py-3"><strong>{unit.product_name} · {unit.origin_name}</strong><p>{unit.settled_at ? 'Completed by Hiroma' : unit.current_dispatch_id ? `In transit to ${unit.holder_name}` : `Pending for ${unit.holder_name}`} · {kindLabel(unit.kind)} · {unit.cycle} confirmed replacement steps</p><code className="block select-all break-all text-gray-500">RC-{unit.claim_reference} · RB-{unit.id}</code>{data.is_admin && unit.classification_source === 'legacy_current_profile' && <p className="text-amber-700">Historical outlet type uses current account settings—review before replenishing.</p>}</li>)}</ul></details>
    </div>}
    {(intent || receiving) && <div role="dialog" aria-modal="true" aria-labelledby="reward-stock-confirm-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6"><h3 id="reward-stock-confirm-title" className="font-bold">{intent ? 'Dispatch replacement stock?' : 'Confirm physical receipt?'}</h3><p className="text-sm">{intent ? `${intent.quantity} × ${intent.product_name} to ${intent.recipient_name}. Your available stock will be deducted now; the recipient must confirm delivery.` : `${receiving!.quantity} × ${receiving!.product_name} from ${receiving!.supplier_name}. Confirm only after counting all bottles in good condition.`}</p>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}{sent && <p className="text-xs text-amber-700">If the result is uncertain, retry this same action. Do not create another dispatch.</p>}<div className="flex justify-end gap-3"><button type="button" disabled={busy || sent} onClick={() => { setIntent(null); setReceiving(null); setError('') }} className="rounded border px-4 py-2 text-sm disabled:opacity-40">Cancel</button><button type="button" disabled={busy} onClick={() => void act()} className="rounded bg-[#0D1B3E] px-4 py-2 text-sm text-white disabled:opacity-40">{busy ? 'Processing…' : sent ? 'Retry same action' : 'Confirm'}</button></div></div></div>}
  </section>
  </details>
}
