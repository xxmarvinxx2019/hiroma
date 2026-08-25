'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Receipt = {
  id: string; receipt_number: string; transaction_type: string; customer_name_snapshot: string;
  payment_method_snapshot: string; total: number; finalized_at: string;
  items: Array<{ product_name_snapshot: string; quantity: number }>
}
type RequestRow = {
  id: string; request_type: 'void' | 'refund'; status: string; reason: string; review_notes?: string | null;
  amount: number; requested_at: string; can_review: boolean;
  requester: { full_name: string; username: string };
  transaction: Receipt & { cashier_id: string };
}

const peso = (value: number) => value.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })

export default function PosAdjustmentsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [canApprove, setCanApprove] = useState(false)
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null)
  const [selectedRequest, setSelectedRequest] = useState<RequestRow | null>(null)
  const [requestType, setRequestType] = useState<'void' | 'refund'>('void')
  const [reason, setReason] = useState('')
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/city/pos/adjustments', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to load void and refund requests.')
      setReceipts(result.eligible_receipts || [])
      setRequests(result.requests || [])
      setCanApprove(result.access?.can_approve === true)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load void and refund requests.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  async function submitRequest() {
    if (!selectedReceipt || reason.trim().length < 10) return
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/city/pos/adjustments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction_id: selectedReceipt.id, request_type: requestType, reason }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to submit request.')
      setNotice(`${selectedReceipt.receipt_number} was submitted for independent ${requestType} review.`)
      setSelectedReceipt(null); setReason(''); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to submit request.') }
    finally { setSaving(false) }
  }

  async function submitDecision() {
    if (!selectedRequest || notes.trim().length < 5) return
    setSaving(true); setError('')
    try {
      const response = await fetch('/api/city/pos/adjustments', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: selectedRequest.id, action: decision, notes }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to save decision.')
      setNotice(`${selectedRequest.transaction.receipt_number} request was ${decision === 'approve' ? 'approved' : 'rejected'}.`)
      setSelectedRequest(null); setNotes(''); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save decision.') }
    finally { setSaving(false) }
  }

  return <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6"><div className="mx-auto max-w-6xl">
    <header className="flex flex-col justify-between gap-4 rounded-2xl bg-[#071638] p-6 text-white sm:flex-row sm:items-center">
      <div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af45]">Receipt correction control</p><h1 className="mt-2 text-2xl font-bold">Void & Refund Center</h1><p className="mt-1 text-sm text-white/65">Original receipts remain permanent. Every correction requires a reason and an independent decision.</p></div>
      <Link href="/dashboard/city/pos" className="rounded-xl bg-[#d4af45] px-4 py-3 text-center text-sm font-bold text-[#071638]">Return to POS</Link>
    </header>
    {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
    {notice && <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">{notice}</p>}
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><b>Hiroma refund policy:</b> Void and refund requests apply only to non-member/SRP receipts. Member and reseller purchases are final and not eligible because they may include PU, rewards, Product Binary commissions, rank progress, or wallet credits.</div>
    <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
      <div className="border-b p-5"><h2 className="font-bold text-[#071638]">{canApprove ? 'Pending independent review' : 'Receipts available for request'}</h2><p className="mt-1 text-xs text-gray-500">{canApprove ? 'The requester cannot approve their own correction.' : 'Only your finalized receipts are shown. Completed receipts cannot be edited or deleted.'}</p></div>
      {loading ? <p className="p-10 text-center text-sm text-gray-400">Loading…</p> : canApprove ? requests.length ? <div className="divide-y">{requests.map((row) => <article key={row.id} className="p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><b className="text-[#071638]">{row.transaction.receipt_number}</b><p className="mt-1 text-xs text-gray-500">Requested by {row.requester.full_name || row.requester.username} · {new Date(row.requested_at).toLocaleString('en-PH')}</p><p className="mt-2 text-sm">{row.transaction.customer_name_snapshot} · {row.transaction.items.map((item) => `${item.quantity}× ${item.product_name_snapshot}`).join(' · ')}</p><p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs"><b>{row.request_type.toUpperCase()} reason:</b> {row.reason}</p></div><div className="sm:text-right"><b className="text-xl">{peso(row.amount)}</b><p className="mt-1 text-xs">{row.transaction.payment_method_snapshot}</p></div></div><div className="mt-4 flex justify-end">{row.can_review ? <button onClick={() => { setSelectedRequest(row); setDecision('approve'); setNotes('') }} className="rounded-xl bg-[#071638] px-4 py-2.5 text-xs font-bold text-white">Review request</button> : <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">A different authorized approver must review this request.</p>}</div></article>)}</div> : <p className="p-10 text-center text-sm text-gray-400">No void or refund requests are waiting for review.</p> : receipts.length ? <div className="divide-y">{receipts.map((row) => <article key={row.id} className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center"><div><b className="text-[#071638]">{row.receipt_number}</b><p className="mt-1 text-xs text-gray-500">{new Date(row.finalized_at).toLocaleString('en-PH')} · {row.customer_name_snapshot}</p><p className="mt-2 text-sm">{row.items.map((item) => `${item.quantity}× ${item.product_name_snapshot}`).join(' · ')}</p>{row.transaction_type === 'member_sale' && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800"><b>Member/Reseller sale · Not eligible for void or refund.</b> This purchase may include PU, rewards, commissions, rank progress, or wallet credits.</p>}</div><div className="flex items-center gap-3"><b>{peso(row.total)}</b><button disabled={row.transaction_type === 'member_sale'} title={row.transaction_type === 'member_sale' ? 'Member and reseller receipts are not eligible for void or refund.' : 'Request an independently reviewed receipt correction.'} onClick={() => { setSelectedReceipt(row); setReason(''); setRequestType('void') }} className="rounded-xl border border-red-200 px-4 py-2.5 text-xs font-bold text-red-700 disabled:cursor-not-allowed disabled:opacity-40">{row.transaction_type === 'member_sale' ? 'Not refundable' : 'Request correction'}</button></div></article>)}</div> : <p className="p-10 text-center text-sm text-gray-400">No finalized receipts are available for a new request.</p>}
    </section>
  </div>
  {selectedReceipt && <div className="fixed inset-0 z-50 grid place-items-center bg-[#071638]/70 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-2xl bg-white p-6"><h2 className="text-xl font-bold text-[#071638]">Request receipt correction</h2><p className="mt-2 text-sm text-gray-600">Receipt {selectedReceipt.receipt_number} remains permanent and will be marked only after independent approval.</p><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => setRequestType('void')} className={`rounded-xl border p-3 text-sm font-bold ${requestType === 'void' ? 'border-[#071638] bg-[#071638] text-white' : ''}`}>Void</button><button onClick={() => setRequestType('refund')} className={`rounded-xl border p-3 text-sm font-bold ${requestType === 'refund' ? 'border-[#071638] bg-[#071638] text-white' : ''}`}>Refund</button></div><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} maxLength={500} placeholder="Explain the exact error or customer return (required)" className="mt-4 w-full rounded-xl border p-3 text-sm outline-none focus:border-[#d4af45]" />{reason.length > 0 && reason.trim().length < 10 && <p className="mt-1 text-xs text-red-600">Enter at least 10 characters.</p>}<div className="mt-5 flex justify-end gap-2"><button onClick={() => setSelectedReceipt(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={saving || reason.trim().length < 10} onClick={submitRequest} className="rounded-xl bg-[#d4af45] px-4 py-2.5 text-sm font-bold text-[#071638] disabled:opacity-40">Submit for Approval</button></div></div></div>}
  {selectedRequest && <div className="fixed inset-0 z-50 grid place-items-center bg-[#071638]/70 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-2xl bg-white p-6"><h2 className="text-xl font-bold text-[#071638]">Review {selectedRequest.request_type} request</h2><p className="mt-2 text-sm leading-6 text-gray-600">Approval restores all products to location inventory, marks the order payment as {selectedRequest.request_type === 'void' ? 'voided' : 'refunded'}, and preserves the original receipt.</p><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => setDecision('approve')} className={`rounded-xl border p-3 text-sm font-bold ${decision === 'approve' ? 'bg-emerald-700 text-white' : ''}`}>Approve</button><button onClick={() => setDecision('reject')} className={`rounded-xl border p-3 text-sm font-bold ${decision === 'reject' ? 'bg-red-600 text-white' : ''}`}>Reject</button></div><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} maxLength={500} placeholder="Independent review note (required)" className="mt-4 w-full rounded-xl border p-3 text-sm outline-none focus:border-[#d4af45]" /><div className="mt-5 flex justify-end gap-2"><button onClick={() => setSelectedRequest(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Go Back</button><button disabled={saving || notes.trim().length < 5} onClick={submitDecision} className="rounded-xl bg-[#071638] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Confirm Decision</button></div></div></div>}
  </main>
}
