'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Approval = {
  id: string
  receipt_number: string
  status: string
  applicant_full_name: string
  applicant_mobile: string
  payment_method_snapshot: string
  payment_reference: string | null
  payment_proof_url: string | null
  amount: number
  package: { name: string }
  cashier: { full_name: string; username: string }
}

export default function RegistrationApprovalsPage() {
  const [rows, setRows] = useState<Approval[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  async function load() {
    const response = await fetch('/api/city/pos/registration-approvals', { cache: 'no-store' })
    const body = await response.text()
    let result: { error?: string; approvals?: Approval[] } = {}
    try { result = body ? JSON.parse(body) : {} } catch { /* handled using the standard message below */ }
    if (!response.ok) throw new Error(result.error || 'Unable to load registration approvals.')
    setRows(result.approvals || [])
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((reason) => setError(reason.message)), 0)
    return () => window.clearTimeout(timer)
  }, [])
  async function decide(id: string, action: 'verify_payment' | 'needs_correction' | 'reject_payment') {
    const reason = action === 'verify_payment' ? '' : window.prompt(action === 'needs_correction'
      ? 'Explain exactly what the cashier must correct:'
      : 'Reason for permanently rejecting this payment:')?.trim()
    if (action !== 'verify_payment' && !reason) return
    setBusy(id)
    try {
      const response = await fetch('/api/city/pos/registration-approvals', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action, reason }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to update verification.')
      await load()
    } catch (reasonValue) { setError(reasonValue instanceof Error ? reasonValue.message : 'Unable to update verification.') }
    finally { setBusy('') }
  }
  return <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-col justify-between gap-4 rounded-2xl bg-[#071638] p-6 text-white sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af45]">Registration payment control</p>
          <h1 className="mt-2 text-2xl font-bold">Approval Center</h1>
          <p className="mt-1 text-sm text-white/65">Confirm the exact registration payment in the official receiving account before releasing the registration for encoding.</p>
        </div>
        <Link href="/dashboard/city/pos" className="rounded-xl bg-[#d4af45] px-4 py-3 text-center text-sm font-bold text-[#071638]">Return to POS</Link>
      </header>
      <nav className="mt-4 grid gap-2 rounded-2xl border bg-white p-2 sm:grid-cols-3" aria-label="Approval type">
        <Link href="/dashboard/city/pos/approvals" className="rounded-xl px-4 py-3 text-center text-sm font-bold text-slate-600 hover:bg-slate-50">Sales Payments</Link>
        <Link href="/dashboard/city/pos/registration-approvals" className="rounded-xl bg-[#071638] px-4 py-3 text-center text-sm font-bold text-white">Registration Payments</Link>
        <Link href="/dashboard/city/pos/shift-approvals" className="rounded-xl px-4 py-3 text-center text-sm font-bold text-slate-600 hover:bg-slate-50">Shift Closings</Link>
      </nav>
      {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
      <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
        <div className="border-b p-5">
          <h2 className="font-bold text-[#071638]">Registration payments awaiting review</h2>
          <p className="mt-1 text-xs text-gray-500">Screenshots are supporting evidence only. Verify the exact amount in the official bank or e-wallet account before approval.</p>
        </div>
        {rows.length === 0 ? <p className="p-10 text-center text-sm text-gray-400">No registration payments are waiting for review.</p> : <div className="divide-y">{rows.map((row) => <article key={row.id} className="p-5">
          <div className="flex flex-col justify-between gap-4 md:flex-row">
            <div>
              <p className="font-bold text-[#071638]">{row.applicant_full_name} · {row.package.name}</p>
              <p className="text-sm text-slate-500">{row.receipt_number} · Cashier: {row.cashier.full_name || row.cashier.username}</p>
              <p className="mt-2 text-sm"><strong>{row.payment_method_snapshot}</strong><br />Reference: {row.payment_reference || 'Not recorded'} · Amount: ₱{row.amount.toLocaleString()}</p>
            </div>
            {row.status === 'pending_payment_verification' && <div className="flex items-end gap-2">
              <button disabled={busy === row.id} onClick={() => void decide(row.id, 'reject_payment')} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700">Reject</button>
              <button disabled={busy === row.id} onClick={() => void decide(row.id, 'needs_correction')} className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">Return for correction</button>
              <button disabled={busy === row.id} onClick={() => void decide(row.id, 'verify_payment')} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Money received · Verify</button>
            </div>}
          </div>
        </article>)}</div>}
      </section>
    </div>
  </main>
}
