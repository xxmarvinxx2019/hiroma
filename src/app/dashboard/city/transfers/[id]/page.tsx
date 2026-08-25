'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface TransferItem {
  id: string
  quantity: number
  accepted_quantity: number | null
  damaged_quantity: number | null
  missing_quantity: number | null
  recipient_stock_before: number
  recipient_stock_after: number
  product: { id: string; name: string; type: string } | null
}

interface TransferReceipt {
  id: string
  reference_number: string
  status: string
  created_at: string
  dispatched_at: string
  received_at: string | null
  notes: string | null
  receiving_notes: string | null
  total_units: number
  sender: { full_name: string; username: string } | null
  recipient: { full_name: string; username: string } | null
  items: TransferItem[]
}

type ReceivingValues = Record<string, { accepted: string; damaged: string; missing: string; notes: string }>
type ReceivingAction = 'received_full' | 'received_discrepancy' | 'rejected'

const statusLabel: Record<string, string> = {
  in_transit: 'In Transit · Action Required',
  received_full: 'Received in Full',
  received_discrepancy: 'Received with Discrepancy',
  rejected: 'Rejected',
}

export default function BranchTransferReceiptPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const [transfer, setTransfer] = useState<TransferReceipt | null>(null)
  const [values, setValues] = useState<ReceivingValues>({})
  const [receivingNotes, setReceivingNotes] = useState('')
  const [confirmAction, setConfirmAction] = useState<ReceivingAction | null>(null)
  const [confirmationAcknowledged, setConfirmationAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    try {
      const response = await fetch(`/api/inventory/transfers/${id}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load receipt.')
      const receipt = data.transfer as TransferReceipt
      setTransfer(receipt)
      setReceivingNotes(receipt.receiving_notes || '')
      setValues(Object.fromEntries(receipt.items.map((item) => [item.id, {
        accepted: String(item.accepted_quantity ?? item.quantity), damaged: String(item.damaged_quantity ?? 0),
        missing: String(item.missing_quantity ?? 0), notes: '',
      }])))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load receipt.')
    } finally { setLoading(false) }
  }, [id])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  const totals = useMemo(() => transfer?.items.reduce((sum, item) => {
    const value = values[item.id]
    return { expected: sum.expected + item.quantity, accepted: sum.accepted + Number(value?.accepted || 0), damaged: sum.damaged + Number(value?.damaged || 0), missing: sum.missing + Number(value?.missing || 0) }
  }, { expected: 0, accepted: 0, damaged: 0, missing: 0 }) || { expected: 0, accepted: 0, damaged: 0, missing: 0 }, [transfer, values])
  const hasDiscrepancy = totals.damaged > 0 || totals.missing > 0

  const updateValue = (itemId: string, field: 'accepted' | 'damaged' | 'missing' | 'notes', value: string) => {
    setError('')
    setValues((current) => ({ ...current, [itemId]: { ...current[itemId], [field]: value } }))
  }

  const openConfirmation = (action: ReceivingAction) => {
    setError('')
    if (action !== 'rejected') {
      for (const item of transfer?.items || []) {
        const value = values[item.id]
        const numbers = [value?.accepted, value?.damaged, value?.missing].map(Number)
        if (!numbers.every((number) => Number.isSafeInteger(number) && number >= 0)) { setError('All quantities must be non-negative whole numbers.'); return }
        if (numbers[0] + numbers[1] + numbers[2] !== item.quantity) { setError(`For ${item.product?.name || 'each product'}, Good + Damaged + Missing must equal ${item.quantity}.`); return }
        if (action === 'received_full' && (numbers[0] !== item.quantity || numbers[1] !== 0 || numbers[2] !== 0)) {
          setError(`${item.product?.name || 'Product'}: Expected ${item.quantity}; entered Good ${numbers[0]}, Damaged ${numbers[1]}, Missing ${numbers[2]}. Received in Full is only allowed when every expected unit is Good and both Damaged and Missing are zero.`)
          return
        }
      }
    }
    setConfirmationAcknowledged(false)
    setConfirmAction(action)
  }

  const submitReceiving = async () => {
    if (!confirmAction || !transfer) return
    setSubmitting(true); setError('')
    try {
      const response = await fetch(`/api/inventory/transfers/${transfer.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: confirmAction, notes: receivingNotes, items: transfer.items.map((item) => ({ movement_id: item.id, accepted_quantity: Number(values[item.id]?.accepted || 0), damaged_quantity: Number(values[item.id]?.damaged || 0), missing_quantity: Number(values[item.id]?.missing || 0), notes: values[item.id]?.notes || '' })) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to record delivery receiving.')
      setConfirmAction(null)
      setSuccess(data.message)
      window.dispatchEvent(new CustomEvent('hiroma-incoming-transfer-change'))
      await load()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to record delivery receiving.'); setConfirmAction(null)
    } finally { setSubmitting(false) }
  }

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">Loading transfer receipt...</div>
  if (error && !transfer) return <div className="mx-auto max-w-3xl py-16 text-center"><p className="text-sm font-semibold text-[#0D1B3E]">Transfer receipt not found</p><p className="mt-1 text-xs text-gray-400">{error}</p><button onClick={() => router.back()} className="mt-4 text-xs font-medium text-[#9a6f1e]">← Go back</button></div>
  if (!transfer) return null
  const isPending = transfer.status === 'in_transit'

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="overflow-hidden rounded-2xl bg-[#0D1B3E] text-white shadow-[0_16px_40px_rgba(13,27,62,0.16)]">
        <div className="flex flex-col gap-5 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div className="flex items-center gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg></div><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e2c56f]">Internal inventory movement</p><h1 className="mt-1 text-2xl font-semibold">Stock Transfer Receipt</h1><p className="mt-1 text-sm text-white/60">Reference {transfer.reference_number}</p></div></div>
          <span className="w-fit rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-[#f4d778]">{statusLabel[transfer.status] || transfer.status}</span>
        </div>
        <div className="grid border-t border-white/10 sm:grid-cols-3">
          {[{ number: '1', label: 'Dispatched', complete: true }, { number: '2', label: 'In Transit', complete: true }, { number: '3', label: isPending ? 'Verify Receipt' : 'Receipt Resolved', complete: !isPending }].map((step, index) => <div key={step.label} className={`flex items-center gap-3 px-5 py-3.5 sm:px-7 ${index > 0 ? 'border-t border-white/10 sm:border-l sm:border-t-0' : ''}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.complete ? 'bg-[#C9A84C] text-[#0D1B3E]' : 'border border-[#C9A84C] bg-[#C9A84C]/10 text-[#f4d778]'}`}>{step.complete ? '✓' : step.number}</span><div><p className="text-[10px] uppercase tracking-wide text-white/45">Step {step.number}</p><p className="text-sm font-semibold text-white/90">{step.label}</p></div></div>)}
        </div>
      </div>
      {isPending && <div className="rounded-xl border border-[#C9A84C]/35 bg-[#fef9ee] px-5 py-3.5 text-sm leading-relaxed text-[#6f5117]"><strong>Physical receiving required.</strong> Check every package before confirming. Only Good/Accepted units will become available for sale.</div>}
      {success && <div className="rounded-xl border border-[#1a7a4a]/20 bg-[#e8f7ef] px-4 py-3 text-xs text-[#1a7a4a]">{success}</div>}

      <div className="overflow-hidden rounded-2xl border border-[#0D1B3E]/10 bg-white shadow-[0_8px_24px_rgba(13,27,62,0.07)]">
        <div className="grid gap-4 border-b border-[#0D1B3E]/8 bg-[#fbfcfe] p-5 sm:grid-cols-[1fr_auto_1fr] lg:grid-cols-[1fr_auto_1fr_1.35fr] lg:p-6">
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0D1B3E] text-sm font-bold text-white">H</div><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sent by</p><p className="mt-0.5 text-base font-semibold text-[#0D1B3E]">{transfer.sender?.full_name}</p></div></div>
          <div className="hidden items-center text-xl text-[#C9A84C] sm:flex" aria-hidden="true">→</div>
          <div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#C9A84C] text-sm font-bold text-[#0D1B3E]">{transfer.recipient?.full_name?.charAt(0).toUpperCase() || 'B'}</div><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Deliver to</p><p className="mt-0.5 text-base font-semibold text-[#0D1B3E]">{transfer.recipient?.full_name}</p></div></div>
          <div className="rounded-xl border border-[#0D1B3E]/8 bg-white px-4 py-3 sm:col-span-3 lg:col-span-1"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Dispatched</p><p className="mt-1 text-sm font-semibold text-[#0D1B3E]">{new Date(transfer.dispatched_at).toLocaleString('en-PH')}</p></div><span className="rounded-full bg-[#eef0f8] px-2.5 py-1 text-xs font-semibold text-[#0D1B3E]">Internal · No Sale</span></div></div>
        </div>
        <div className="flex flex-col gap-1 border-b border-[#0D1B3E]/8 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6"><div><p className="text-base font-bold text-[#0D1B3E]">Items to inspect</p><p className="mt-0.5 text-sm text-gray-500">Count each product and record its physical condition.</p></div><p className="text-sm font-semibold text-[#0D1B3E]">{transfer.total_units.toLocaleString()} expected unit(s)</p></div>
        <div className="space-y-3 p-4 sm:p-6">
          {transfer.items.map((item) => {
            const value = values[item.id]
            return <div key={item.id} className="rounded-xl border border-[#0D1B3E]/10 bg-[#fcfdff] p-4 transition-shadow focus-within:border-[#C9A84C]/60 focus-within:shadow-[0_6px_20px_rgba(13,27,62,0.06)] sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef0f8] text-lg">📦</div><div><p className="text-base font-semibold text-[#0D1B3E]">{item.product?.name || 'Product'}</p><p className="mt-0.5 text-xs text-gray-500">Expected quantity: <strong className="text-[#0D1B3E]">{item.quantity.toLocaleString()} unit(s)</strong></p></div></div><span className="rounded-full bg-[#eef0f8] px-2.5 py-1 text-xs font-semibold text-[#0D1B3E]">Internal · No Sale</span></div>
              {isPending ? <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_2fr]">{([['accepted', 'Good / Accepted'], ['damaged', 'Damaged'], ['missing', 'Missing']] as const).map(([field, label]) => <label key={field} className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}<input type="number" min="0" step="1" value={value?.[field] || '0'} onChange={(event) => updateValue(item.id, field, event.target.value)} className="mt-1.5 w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 text-base font-semibold text-[#0D1B3E] outline-none focus:border-[#C9A84C]" /></label>)}<label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Item notes<input value={value?.notes || ''} onChange={(event) => updateValue(item.id, 'notes', event.target.value)} placeholder="Optional damage/shortage details" className="mt-1.5 w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 text-base text-[#0D1B3E] outline-none focus:border-[#C9A84C]" /></label></div>
              : <div className="mt-4 grid grid-cols-3 gap-3 text-center"><div className="rounded-lg bg-[#e8f7ef] p-2"><p className="text-[10px] text-gray-400">Good</p><p className="font-bold text-[#1a7a4a]">{item.accepted_quantity || 0}</p></div><div className="rounded-lg bg-[#fdecea] p-2"><p className="text-[10px] text-gray-400">Damaged</p><p className="font-bold text-[#a03030]">{item.damaged_quantity || 0}</p></div><div className="rounded-lg bg-[#fef9ee] p-2"><p className="text-[10px] text-gray-400">Missing</p><p className="font-bold text-[#9a6f1e]">{item.missing_quantity || 0}</p></div></div>}</div>
          })}
        </div>
        <div className="grid gap-4 border-t border-[#0D1B3E]/8 bg-[#fbfcfe] p-5 sm:grid-cols-2 sm:p-6"><div className="rounded-xl border border-[#0D1B3E]/8 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Dispatch notes</p><p className="mt-1.5 text-sm text-gray-700">{transfer.notes || 'No notes provided.'}</p></div><div className="flex items-center gap-3 rounded-xl border border-[#1a7a4a]/15 bg-[#f2fbf6] p-4 sm:justify-end"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a7a4a] text-white">✓</div><div className="text-left sm:text-right"><p className="text-lg font-bold text-[#0D1B3E]">Verify Received Items</p><p className="mt-0.5 text-sm text-gray-600">Count and inspect the delivered products</p></div></div></div>
      </div>

      {isPending && <div className="rounded-2xl border border-[#0D1B3E]/10 bg-white p-5 shadow-sm"><label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Overall receiving notes<textarea value={receivingNotes} onChange={(event) => { setError(''); setReceivingNotes(event.target.value) }} rows={3} placeholder="Required for rejection; optional for completed or discrepancy receiving" className="mt-1.5 block w-full resize-none rounded-xl border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-3 text-base text-[#0D1B3E] outline-none focus:border-[#C9A84C]" /></label><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><div><p className="text-xs font-medium text-gray-500">Expected</p><p className="mt-1 text-lg font-bold text-[#0D1B3E]">{totals.expected}</p></div><div><p className="text-xs font-medium text-gray-500">Good</p><p className="mt-1 text-lg font-bold text-[#1a7a4a]">{totals.accepted}</p></div><div><p className="text-xs font-medium text-gray-500">Damaged</p><p className="mt-1 text-lg font-bold text-[#a03030]">{totals.damaged}</p></div><div><p className="text-xs font-medium text-gray-500">Missing</p><p className="mt-1 text-lg font-bold text-[#9a6f1e]">{totals.missing}</p></div></div>{error && <div role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-[#e05252]/30 bg-[#fff4f3] p-4"><div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#fde1df] text-base">⚠️</div><div><p className="text-sm font-bold text-[#8f2828]">Cannot complete this action</p><p className="mt-1 text-sm leading-relaxed text-[#a03030]">{error}</p><p className="mt-2 text-xs font-medium leading-relaxed text-[#6f3535]">What to do: Review the quantities above, then choose <strong>Report Damage / Missing</strong> when any item is damaged or missing. Only Good units will be added to sellable stock.</p></div></div></div>}
        <div className="mt-5 rounded-xl border border-[#0D1B3E]/10 bg-[#F8F9FC] p-4 sm:p-5"><p className="text-sm font-bold text-[#0D1B3E]">Which action should I choose?</p><div className="mt-3 grid gap-4 md:grid-cols-3"><div><p className="text-sm font-semibold text-[#a03030]">Reject Entire Delivery</p><p className="mt-1.5 text-sm leading-relaxed text-gray-600">Use when the whole shipment is refused or returned. Zero units are credited.</p></div><div><p className="text-sm font-semibold text-[#80611f]">Report Damage / Missing</p><p className="mt-1.5 text-sm leading-relaxed text-gray-600">Use when you accept only the Good units and report damaged or missing items.</p></div><div><p className="text-sm font-semibold text-[#0D1B3E]">Confirm Complete Delivery</p><p className="mt-1.5 text-sm leading-relaxed text-gray-600">Use only when every expected unit arrived in Good condition.</p></div></div></div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end"><button onClick={() => openConfirmation('rejected')} className="rounded-lg border border-[#e05252]/30 px-5 py-3 text-sm font-semibold text-[#a03030] hover:bg-[#fdecea]">Reject Entire Delivery</button><button onClick={() => openConfirmation('received_discrepancy')} className={`rounded-lg border px-5 py-3 text-sm font-semibold transition-colors ${error && hasDiscrepancy ? 'border-[#C9A84C] bg-[#fef9ee] text-[#6f4e0d] shadow-sm ring-2 ring-[#C9A84C]/15' : 'border-[#C9A84C]/40 text-[#80611f] hover:bg-[#fef9ee]'}`}>Report Damage / Missing</button><button onClick={() => openConfirmation('received_full')} className="rounded-lg bg-[#010521] px-5 py-3 text-sm font-semibold text-white hover:bg-[#162850]">Confirm Complete Delivery</button></div></div>}

      {confirmAction && <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[#010521]/75 p-3 sm:p-5">
        <div className="my-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-[#0D1B3E]/8 px-5 py-4 sm:px-6">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#a77d1f]">Review &amp; final confirmation</p><h2 className="mt-1 text-xl font-semibold text-[#0D1B3E]">{confirmAction === 'received_full' ? 'Confirm complete delivery' : confirmAction === 'rejected' ? 'Reject entire delivery' : 'Report damaged or missing items'}</h2><p className="mt-1 text-sm text-gray-500">Review every quantity before changing inventory.</p></div>
            <button type="button" disabled={submitting} onClick={() => setConfirmAction(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F0F2F8] text-lg text-gray-400 hover:text-[#0D1B3E]">×</button>
          </div>

          <div className="max-h-[68vh] space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
            <div className="grid gap-3 rounded-xl bg-[#F0F2F8] p-4 sm:grid-cols-3">
              <div><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Transfer reference</p><p className="mt-1 text-base font-bold text-[#0D1B3E]">{transfer.reference_number}</p></div>
              <div><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">From</p><p className="mt-1 text-base font-semibold text-[#0D1B3E]">{transfer.sender?.full_name || 'Hiroma Admin'}</p></div>
              <div><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Destination</p><p className="mt-1 text-base font-semibold text-[#0D1B3E]">{transfer.recipient?.full_name || 'Branch'}</p></div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[#0D1B3E]/10">
              <div className="hidden grid-cols-[minmax(0,2fr)_repeat(4,minmax(60px,0.7fr))] gap-2 bg-[#F0F2F8] px-4 py-2 sm:grid">
                {['Product', 'Expected', 'Good', 'Damaged', 'Missing'].map((heading) => <p key={heading} className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{heading}</p>)}
              </div>
              <div className="divide-y divide-[#0D1B3E]/8">
                {transfer.items.map((item) => {
                  const itemValue = values[item.id]
                  return <div key={item.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(60px,0.7fr))] sm:items-center sm:gap-2">
                    <div><p className="text-sm font-semibold text-[#0D1B3E]">{item.product?.name || 'Product'}</p><p className="mt-0.5 text-xs text-gray-500">Internal transfer · No sale</p></div>
                    <div><p className="text-[11px] font-semibold uppercase text-gray-500 sm:hidden">Expected</p><p className="text-base font-bold text-[#0D1B3E]">{item.quantity}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase text-gray-500 sm:hidden">Good</p><p className="text-base font-bold text-[#1a7a4a]">{Number(itemValue?.accepted || 0)}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase text-gray-500 sm:hidden">Damaged</p><p className="text-base font-bold text-[#a03030]">{Number(itemValue?.damaged || 0)}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase text-gray-500 sm:hidden">Missing</p><p className="text-base font-bold text-[#9a6f1e]">{Number(itemValue?.missing || 0)}</p></div>
                  </div>
                })}
              </div>
            </div>

            <div className={`rounded-xl border px-4 py-3 ${confirmAction === 'rejected' ? 'border-[#e05252]/25 bg-[#fdecea]' : confirmAction === 'received_discrepancy' ? 'border-[#C9A84C]/35 bg-[#fef9ee]' : 'border-[#1a7a4a]/25 bg-[#e8f7ef]'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">Inventory impact after confirmation</p><p className="mt-1 text-base font-bold text-[#0D1B3E]">{confirmAction === 'rejected' ? 'No stock will be credited' : `${totals.accepted.toLocaleString()} Good unit(s) will be added to sellable stock`}</p></div>
                <div className="text-left sm:text-right"><p className="text-xs font-medium text-gray-600">Expected {totals.expected} · Good {totals.accepted}</p><p className="mt-0.5 text-xs font-medium text-gray-600">Damaged {totals.damaged} · Missing {totals.missing}</p></div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-600">{confirmAction === 'received_full' ? 'This will permanently mark the transfer as received in full and make all accepted units available for sale.' : confirmAction === 'rejected' ? 'The transfer will be marked rejected and Admin will be notified for reconciliation.' : 'Only Good units become sellable. Damaged and missing quantities will be recorded and reported to Admin.'}</p>
            </div>

            {confirmAction === 'rejected' && <label className="block rounded-xl border border-[#e05252]/25 bg-[#fff8f7] p-4"><span className="text-xs font-bold text-[#8f2828]">Reason for rejecting the entire delivery <span aria-hidden="true">*</span></span><span className="mt-1 block text-[11px] leading-relaxed text-gray-500">Required for Admin reconciliation. No units from this shipment will enter your inventory.</span><textarea value={receivingNotes} onChange={(event) => setReceivingNotes(event.target.value)} rows={3} placeholder="Example: Wrong destination, tampered shipment, or entire delivery returned" className="mt-3 block w-full resize-none rounded-lg border border-[#e05252]/25 bg-white px-3 py-2.5 text-sm text-[#0D1B3E] outline-none focus:border-[#a03030]" />{!receivingNotes.trim() && <span className="mt-2 block text-xs font-medium text-[#a03030]">Enter a rejection reason to enable final confirmation.</span>}</label>}

            {confirmAction === 'received_discrepancy' && !hasDiscrepancy && <div role="alert" className="rounded-xl border border-[#C9A84C]/35 bg-[#fffaf0] p-4"><p className="text-sm font-bold text-[#6f4e0d]">No damaged or missing items entered</p><p className="mt-1 text-xs leading-relaxed text-[#80611f]">This action is only for a partial or problematic delivery. Go back and enter the damaged or missing quantity. If everything arrived correctly, use <strong>Confirm Complete Delivery</strong>.</p></div>}

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#0D1B3E]/12 p-3.5 hover:bg-[#F8F9FC]">
              <input type="checkbox" checked={confirmationAcknowledged} onChange={(event) => setConfirmationAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0D1B3E]" />
              <span className="text-sm font-medium leading-relaxed text-[#0D1B3E]">I physically checked this delivery and confirm that the quantities shown above are correct.</span>
            </label>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-[#0D1B3E]/8 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <button disabled={submitting} onClick={() => setConfirmAction(null)} className="rounded-lg border border-[#0D1B3E]/15 px-5 py-3 text-sm font-medium text-[#0D1B3E]">Go Back &amp; Edit</button>
            <button disabled={submitting || !confirmationAcknowledged || (confirmAction === 'rejected' && !receivingNotes.trim()) || (confirmAction === 'received_discrepancy' && !hasDiscrepancy)} onClick={submitReceiving} className={`rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${confirmAction === 'rejected' ? 'bg-[#a03030]' : 'bg-[#010521]'}`}>{submitting ? 'Processing...' : confirmAction === 'received_full' ? 'Confirm & Add to Stock' : confirmAction === 'rejected' ? 'Confirm Entire Rejection' : 'Confirm Damage / Missing'}</button>
          </div>
        </div>
      </div>}
    </div>
  )
}
