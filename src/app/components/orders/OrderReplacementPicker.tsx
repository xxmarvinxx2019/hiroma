'use client'

import { useEffect, useState } from 'react'
import type { ReplacementSelection } from '@/app/lib/orderReplacements'
import { readSettingsResponse } from '@/app/lib/settingsResponse'

type Credit = { product_id: string; product_name: string; kind: string; credits: number; available_quantity: number | null; is_available: boolean }
export function useOrderReplacementSelection(supplierId: string) {
  const [value, setValue] = useState<{ supplierId: string; selection: ReplacementSelection[] }>({ supplierId, selection: [] })
  return { selection: value.supplierId === supplierId ? value.selection : [], picker: <OrderReplacementPicker key={supplierId} supplierId={supplierId} onChange={selection => setValue({ supplierId, selection })} /> }
}

function OrderReplacementPicker({ supplierId, onChange }: { supplierId: string; onChange: (lines: ReplacementSelection[]) => void }) {
  const [credits, setCredits] = useState<Credit[]>([])
  const [enabled, setEnabled] = useState(false)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/order-replacements?${new URLSearchParams({ supplier_id: supplierId })}`, { cache: 'no-store', signal: controller.signal })
      .then(res => readSettingsResponse<{ credits: Credit[] }>(res, 'Unable to load replacement credits.'))
      .then(data => { if (!controller.signal.aborted) { setCredits(data.credits); setLoaded(true) } })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [supplierId])
  const key = (line: Credit) => `${line.product_id}:${line.kind}`
  function update(nextEnabled: boolean, nextQuantities: Record<string, number>) {
    setEnabled(nextEnabled); setQuantities(nextQuantities)
    onChange(nextEnabled ? credits.flatMap(line => nextQuantities[key(line)] > 0 ? [{ product_id: line.product_id, kind: line.kind, quantity: nextQuantities[key(line)] }] : []) : [])
  }
  return <section className="max-h-44 shrink-0 overflow-y-auto border-b bg-amber-50 px-5 py-3 text-xs">
    <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={enabled} disabled={!loaded || !credits.some(line => line.is_available)} onChange={event => {
      const next = { ...quantities }
      if (event.target.checked && !Object.values(next).some(quantity => quantity > 0)) { const first = credits.find(line => line.is_available); if (first) next[key(first)] = 1 }
      update(event.target.checked, next)
    }} />Include free replacement bottles in this shipment</label>
    {error ? <p role="alert" className="mt-1 text-red-600">{error} You may continue with paid items only.</p> : !loaded ? <p className="mt-1 text-gray-500">Checking your replacement credits…</p> : !credits.length ? <p className="mt-1 text-gray-500">No unused replacement credits for this supplier.</p> : <>
      <p className="mt-1 text-gray-600">Free lines do not change the paid total. Credits and supplier stock are reserved with this order. Confirm free bottles after physical receipt.</p>
      {credits.map(line => <label key={key(line)} className="mt-2 flex flex-wrap items-center gap-2"><span>{line.product_name} — {line.credits} unused credit(s)</span><span className={line.is_available ? 'text-green-700' : 'text-red-600'}>{line.available_quantity === null ? line.is_available ? 'Available' : 'Not available' : `${line.available_quantity} available`}</span><input aria-label={`Free ${line.product_name} bottles`} type="number" min={0} max={Math.min(100, line.credits, line.available_quantity ?? 100)} disabled={!enabled || !line.is_available} value={quantities[key(line)] || 0} onChange={event => update(enabled, { ...quantities, [key(line)]: Math.max(0, Math.min(Math.trunc(Number(event.target.value) || 0), 100, line.credits, line.available_quantity ?? 100)) })} className="w-20 rounded border bg-white px-2 py-1 disabled:opacity-40" /></label>)}
    </>}
  </section>
}
