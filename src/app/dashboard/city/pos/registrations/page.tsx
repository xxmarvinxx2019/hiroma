'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Intake = {
  id: string
  receipt_number: string
  status: string
  applicant_full_name: string
  applicant_mobile: string
  payment_method_snapshot: string
  amount: number
  released_at: string | null
  package: { name: string }
}

const label: Record<string, string> = {
  pending_payment_verification: 'Pending payment verification',
  payment_verified_ready_for_release: 'Payment verified · Ready for release',
  released_pending_encoding: 'Released · Pending registration encoding',
  encoding_in_progress: 'Encoding in progress',
  registration_completed: 'Registration completed',
  needs_correction: 'Needs correction',
  payment_rejected: 'Payment rejected',
}

export default function PosRegistrationsPage() {
  const [rows, setRows] = useState<Intake[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  async function load() {
    const response = await fetch('/api/city/pos/registrations', { cache: 'no-store' })
    const body = await response.text()
    let result: { error?: string; registrations?: Intake[] } = {}
    try { result = body ? JSON.parse(body) : {} } catch { /* handled using the standard message below */ }
    if (!response.ok) throw new Error(result.error || 'Unable to load POS registrations.')
    setRows(result.registrations || [])
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void load().catch((reason) => setError(reason.message)), 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function release(id: string) {
    setBusy(id)
    setError('')
    try {
      const response = await fetch('/api/city/pos/registrations/release', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to release package.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to release package.')
    } finally { setBusy('') }
  }

  return <div className="mx-auto max-w-6xl p-6">
    <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#A97912]">Point of Sale</p>
        <h1 className="text-2xl font-bold text-[#071638]">Registration Center</h1>
        <p className="text-sm text-slate-500">Track payment verification, package release, and final account encoding in one place.</p>
      </div>
      <Link href="/dashboard/city/pos/new-registration" className="rounded-xl bg-[#C9A84C] px-4 py-2.5 text-center text-sm font-bold text-[#071638]">
        + New Registration
      </Link>
    </div>
    {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      {rows.length === 0 ? <div className="p-12 text-center text-slate-400">No POS registration intakes yet.</div> : rows.map((row) => <div key={row.id} className="grid gap-3 border-b border-slate-100 p-4 last:border-0 md:grid-cols-[1.2fr_1fr_auto] md:items-center">
        <div>
          <p className="font-semibold text-[#071638]">{row.applicant_full_name}</p>
          <p className="text-xs text-slate-500">{row.receipt_number} · {row.applicant_mobile} · {row.package.name}</p>
        </div>
        <div>
          <p className="text-sm font-medium text-[#071638]">{label[row.status] || row.status}</p>
          <p className="text-xs text-slate-500">{row.payment_method_snapshot} · ₱{row.amount.toLocaleString()}</p>
        </div>
        <div className="flex gap-2">
          {row.status === 'payment_verified_ready_for_release' && <button disabled={busy === row.id} onClick={() => void release(row.id)} className="rounded-lg bg-[#071638] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm package release</button>}
          {['released_pending_encoding', 'encoding_in_progress'].includes(row.status) && <Link href={`/dashboard/city/resellers/register?pos_intake=${row.id}`} className="rounded-lg bg-[#C9A84C] px-4 py-2 text-sm font-semibold text-[#071638]">Encode registration</Link>}
        </div>
      </div>)}
    </div>
  </div>
}
