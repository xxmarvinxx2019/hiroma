'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

type PayoutStatus = 'pending' | 'approved' | 'rejected' | 'released'

type Payout = {
  id: string
  amount: number
  status: PayoutStatus
  payment_method: string | null
  payment_reference: string | null
  transaction_number: string | null
  cutoff_date: string | null
  payout_date: string | null
  requested_at: string
  processed_at: string | null
}

const STATUS: Record<PayoutStatus, { label: string; description: string; color: string }> = {
  pending: {
    label: 'Pending Review',
    description: 'Waiting for Admin review.',
    color: 'bg-[#fef9ee] text-[#9a6f1e]',
  },
  approved: {
    label: 'Approved / Scheduled',
    description: 'Approved and waiting for the scheduled release date.',
    color: 'bg-[#eef3ff] text-[#315ba8]',
  },
  rejected: {
    label: 'Rejected',
    description: 'The payout request was not approved.',
    color: 'bg-[#fdecea] text-[#a03030]',
  },
  released: {
    label: 'Released',
    description: 'The payout has been released.',
    color: 'bg-[#e8f7ef] text-[#1a7a4a]',
  },
}

const fmtMoney = (value: number) =>
  `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

export default function ResellerPayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/reseller/wallet?tab=payouts&page=1&pageSize=100')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Unable to load payouts.')
        setPayouts(data.payouts || [])
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const counts = payouts.reduce<Record<PayoutStatus, number>>(
    (total, payout) => {
      total[payout.status] += 1
      return total
    },
    { pending: 0, approved: 0, rejected: 0, released: 0 },
  )

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Payouts</h1>
        <p className="text-sm text-gray-400 mt-1">Monitor your payout requests from submission to release.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(Object.keys(STATUS) as PayoutStatus[]).map((status) => (
          <div key={status} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
            <p className="text-xs text-gray-400">{STATUS[status].label}</p>
            <p className="text-2xl font-semibold text-[#0D1B3E] mt-1">{counts[status]}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
        <div className="hidden md:grid grid-cols-[1fr_1.5fr_1.3fr_1.3fr_80px] gap-3 bg-[#F0F2F8] px-5 py-3">
          {['Amount', 'Payout Method', 'Status', 'Dates', 'Details'].map((heading) => (
            <p key={heading} className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">{heading}</p>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 text-center py-12">Loading payout history...</p>
        ) : error ? (
          <p className="text-sm text-red-500 text-center py-12">{error}</p>
        ) : payouts.length === 0 ? (
          <div className="text-center py-12 px-4">
            <p className="text-sm font-medium text-[#0D1B3E]">No payout requests yet</p>
            <p className="text-xs text-gray-400 mt-1">Your payout requests and their status will appear here.</p>
            <Link href="/dashboard/reseller/wallet"
              className="inline-block mt-4 bg-[#C9A84C] text-white text-xs font-medium px-4 py-2 rounded-lg">
              Go to Wallet
            </Link>
          </div>
        ) : payouts.map((payout) => {
          const status = STATUS[payout.status]
          return (
            <div key={payout.id}
              className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_1.3fr_1.3fr_80px] gap-3 px-5 py-4 border-b border-[#0D1B3E]/5 items-center">
              <div>
                <p className="md:hidden text-[10px] uppercase text-gray-400">Amount</p>
                <p className="text-sm font-semibold text-[#0D1B3E]">{fmtMoney(payout.amount)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{payout.payment_method || 'Not specified'}</p>
                <p className="text-[10px] text-gray-400 break-all">{payout.payment_reference || '—'}</p>
              </div>
              <div>
                <span className={`inline-flex text-[10px] font-medium px-2 py-1 rounded-full ${status.color}`}>
                  {status.label}
                </span>
                <p className="text-[10px] text-gray-400 mt-1">{status.description}</p>
              </div>
              <div className="text-[10px] text-gray-500 space-y-0.5">
                <p>Requested: {fmtDate(payout.requested_at)}</p>
                {payout.payout_date && <p>Scheduled: {fmtDate(payout.payout_date)}</p>}
                {payout.processed_at && <p>Updated: {fmtDate(payout.processed_at)}</p>}
              </div>
              <Link href={`/dashboard/reseller/payouts/${payout.id}`}
                className="text-xs font-medium text-[#C9A84C] hover:underline">
                View →
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
