'use client'

import { useEffect, useState } from 'react'
import { readSettingsResponse } from '@/app/lib/settingsResponse'
type Line = { id: string; product_name: string; quantity: number; state: string; received: boolean }
export default function OrderReplacementSummary({ orderId, orderStatus }: { orderId: string; orderStatus?: string }) {
  const [data, setData] = useState<{ replacement_lines: Line[]; can_receive_replacements: boolean } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<Line | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/orders/${encodeURIComponent(orderId)}`, { cache: 'no-store', signal: controller.signal })
      .then(res => readSettingsResponse<{ order: NonNullable<typeof data> }>(res, 'Unable to load combined shipment.'))
      .then(result => { if (!controller.signal.aborted) { setData(result.order); setError('') } })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [orderId, orderStatus, revision])
  async function receive() {
    if (!confirming || busy) return
    setBusy(true); setError('')
    try {
      await readSettingsResponse(await fetch('/api/reward-stock-replacements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'receive', dispatch_id: confirming.id }) }), 'Unable to confirm receipt.')
      setConfirming(null); setRevision(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to confirm receipt.') }
    finally { setBusy(false) }
  }
  if (!data?.replacement_lines?.length && !error) return null
  return <div className="my-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs">
    <strong>Free replacement bottles — same shipment</strong>
    {data?.replacement_lines.map(line => <div key={line.id} className="mt-2 flex flex-wrap items-center gap-2"><span>{line.quantity} × {line.product_name} · ₱0 · {line.received ? 'Received' : line.state === 'pending' ? 'Reserved with order' : line.state === 'cancelled' ? 'Cancelled; credits returned' : 'Awaiting recipient receipt'}</span>{line.state === 'dispatched' && !line.received && data.can_receive_replacements && <button type="button" disabled={busy} className="rounded border bg-white px-2 py-1" onClick={() => setConfirming(line)}>Confirm free bottles received</button>}</div>)}
    {confirming && <div role="alertdialog" aria-label="Confirm physical receipt" className="mt-3 space-y-2"><p>Confirm only after counting all {confirming.quantity} × {confirming.product_name} bottles in good condition. This adds them to your inventory.</p><button type="button" disabled={busy} className="mr-2 rounded border bg-white px-2 py-1" onClick={() => void receive()}>{busy ? 'Confirming…' : 'Confirm receipt'}</button><button type="button" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button></div>}
    {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
  </div>
}
