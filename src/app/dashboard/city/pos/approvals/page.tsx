'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Approval = {
  id: string
  receipt_number: string
  transaction_type: string
  customer_name_snapshot: string
  payment_method_snapshot: string
  payment_reference: string
  total: number
  server_received_at: string
  can_review: boolean
  cashier: { full_name: string; username: string }
  items: Array<{ product_name_snapshot: string; quantity: number; subtotal: number }>
}

const peso = (value: number) => value.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })

export default function PosPaymentApprovalsPage() {
  const [rows, setRows] = useState<Approval[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Approval | null>(null)
  const [decision, setDecision] = useState<'approve' | 'needs_correction' | 'reject' | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/city/pos/approvals', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to load payment approvals.')
      setRows(result.approvals || [])
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load payment approvals.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function submitDecision() {
    if (!selected || !decision || (decision !== 'approve' && notes.trim().length < 5)) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/city/pos/approvals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: selected.id, action: decision, notes }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to save the payment decision.')
      setNotice(decision === 'approve'
        ? `${selected.receipt_number} is verified and finalized.`
        : decision === 'needs_correction'
          ? `${selected.receipt_number} was returned to the cashier for correction.`
          : `${selected.receipt_number} was rejected and its reserved stock was restored.`)
      setSelected(null)
      setDecision(null)
      setNotes('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the payment decision.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-4 rounded-2xl bg-[#071638] p-6 text-white sm:flex-row sm:items-center">
          <div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af45]">Maker–approver control</p><h1 className="mt-2 text-2xl font-bold">Approval Center</h1><p className="mt-1 text-sm text-white/65">Confirm money in the official account before products, earnings, or member rewards are finalized.</p></div>
          <Link href="/dashboard/city/pos" className="rounded-xl bg-[#d4af45] px-4 py-3 text-center text-sm font-bold text-[#071638]">Return to POS</Link>
        </header>
        <nav className="mt-4 grid gap-2 rounded-2xl border bg-white p-2 sm:grid-cols-3" aria-label="Approval type">
          <Link href="/dashboard/city/pos/approvals" className="rounded-xl bg-[#071638] px-4 py-3 text-center text-sm font-bold text-white">Sales Payments</Link>
          <Link href="/dashboard/city/pos/registration-approvals" className="rounded-xl px-4 py-3 text-center text-sm font-bold text-slate-600 hover:bg-slate-50">Registration Payments</Link>
          <Link href="/dashboard/city/pos/shift-approvals" className="rounded-xl px-4 py-3 text-center text-sm font-bold text-slate-600 hover:bg-slate-50">Shift Closings</Link>
        </nav>
        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
        {notice && <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">{notice}</p>}
        <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
          <div className="border-b p-5"><h2 className="font-bold text-[#071638]">Pending independent verification</h2><p className="mt-1 text-xs text-gray-500">Screenshots are supporting evidence only. Verify against the official GCash, e-wallet, or bank account before approval.</p></div>
          {loading ? <p className="p-10 text-center text-sm text-gray-400">Loading pending payments…</p> : rows.length === 0 ? <p className="p-10 text-center text-sm text-gray-400">No non-cash POS payments are waiting for review.</p> : <div className="divide-y">{rows.map((row) => (
            <article key={row.id} className="p-5">
              <div className="flex flex-col justify-between gap-3 lg:flex-row">
                <div><b className="text-[#071638]">{row.receipt_number}</b><p className="mt-1 text-xs text-gray-500">Cashier: {row.cashier.full_name || row.cashier.username} · {new Date(row.server_received_at).toLocaleString('en-PH')}</p><p className="mt-2 text-sm">{row.customer_name_snapshot} · {row.items.map((item) => `${item.quantity}× ${item.product_name_snapshot}`).join(' · ')}</p></div>
                <div className="lg:text-right"><b className="text-xl text-[#071638]">{peso(row.total)}</b><p className="mt-1 text-xs font-semibold text-amber-700">{row.payment_method_snapshot}</p><p className="mt-1 text-xs text-gray-600">Reference: <b>{row.payment_reference}</b></p></div>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">{row.can_review ? <><button onClick={() => { setSelected(row); setDecision('reject'); setNotes('') }} className="rounded-xl border border-red-200 px-4 py-2 text-xs font-bold text-red-700">Reject permanently</button><button onClick={() => { setSelected(row); setDecision('needs_correction'); setNotes('') }} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900">Return for correction</button><button onClick={() => { setSelected(row); setDecision('approve'); setNotes('') }} className="rounded-xl bg-[#187443] px-4 py-2 text-xs font-bold text-white">Verify & Approve</button></> : <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">You recorded this payment. A different authorized approver must review it.</p>}</div>
            </article>
          ))}</div>}
        </section>
      </div>
      {selected && decision && <div className="fixed inset-0 z-50 grid place-items-center bg-[#071638]/70 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-xl font-bold text-[#071638]">{decision === 'approve' ? 'Verify this payment?' : decision === 'needs_correction' ? 'Return this payment for correction?' : 'Reject this payment permanently?'}</h2><p className="mt-2 text-sm leading-6 text-gray-600">{decision === 'approve' ? 'Confirm only after seeing the exact amount in the official receiving account. Approval finalizes the sale and eligible rewards.' : decision === 'needs_correction' ? 'The sale stays on hold. The cashier receives your note and can correct the payment information before resubmitting it.' : 'Permanent rejection cancels the pending sale and restores its reserved seller stock.'}</p><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder={decision === 'approve' ? 'Approval note (optional)' : decision === 'needs_correction' ? 'Exact correction needed (required)' : 'Permanent rejection reason (required)'} className="mt-4 w-full rounded-xl border p-3 text-sm outline-none focus:border-[#d4af45]" />{decision !== 'approve' && notes.trim().length > 0 && notes.trim().length < 5 && <p className="mt-1 text-xs text-red-600">Enter at least 5 characters.</p>}<div className="mt-5 flex justify-end gap-2"><button disabled={saving} onClick={() => setSelected(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Go Back</button><button disabled={saving || (decision !== 'approve' && notes.trim().length < 5)} onClick={submitDecision} className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 ${decision === 'approve' ? 'bg-[#187443]' : decision === 'needs_correction' ? 'bg-amber-600' : 'bg-red-600'}`}>{saving ? 'Saving…' : decision === 'approve' ? 'Confirm Approval' : decision === 'needs_correction' ? 'Return to Cashier' : 'Confirm Permanent Rejection'}</button></div></div></div>}
    </main>
  )
}
