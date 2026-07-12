'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

interface PayoutDetail {
  id:                 string
  amount:             number
  status:             'pending' | 'approved' | 'rejected'
  payment_method:     string | null
  payment_reference:  string | null
  transaction_number: string | null
  cutoff_date:        string | null
  payout_date:        string | null
  notes:              string | null
  requested_at:       string
  processed_at:       string | null
  approver:           { full_name: string } | null
}

const fmt     = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: string)  => new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const STATUS_STEPS = [
  { key: 'pending',  label: 'Submitted',  icon: '📋', desc: 'Your request has been submitted and is awaiting admin review.' },
  { key: 'approved', label: 'Approved',   icon: '✅', desc: 'Your payout has been approved and is being processed.' },
  { key: 'rejected', label: 'Rejected',   icon: '❌', desc: 'Your payout request was rejected. Please contact admin for details.' },
]

const STATUS_COLOR: Record<string, string> = {
  pending:  'bg-[#fef9ee] text-[#9a6f1e] border border-[#C9A84C]/30',
  approved: 'bg-[#e8f7ef] text-[#1a7a4a] border border-[#1a7a4a]/20',
  rejected: 'bg-[#fdecea] text-[#a03030] border border-[#a03030]/20',
}

export default function ResellerPayoutDetailPage() {
  const params    = useParams()
  const router    = useRouter()
  const [payout, setPayout]   = useState<PayoutDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    const id = params?.id as string
    if (!id) return
    fetch(`/api/reseller/wallet/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setPayout(data.payout)
      })
      .catch(() => setError('Failed to load payout.'))
      .finally(() => setLoading(false))
  }, [params?.id])

  if (loading) return (
    <div className="flex justify-center items-center py-24">
      <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (error)   return <p className="text-center text-[#a03030] py-16">{error}</p>
  if (!payout) return null

  const currentStep = STATUS_STEPS.findIndex((s) => s.key === payout.status)
  const isRejected  = payout.status === 'rejected'

  return (
    <div className="max-w-2xl mx-auto">

      {/* Back */}
      <button onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-[#0D1B3E] mb-5 transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 5l-7 7 7 7"/>
        </svg>
        Back to Wallet
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Payout Request</h1>
          {payout.transaction_number
            ? <p className="text-sm font-mono text-[#1a7a4a] mt-0.5">{payout.transaction_number}</p>
            : <p className="text-sm text-gray-400 mt-0.5">Transaction number pending approval</p>
          }
        </div>
        <span className={`text-xs px-3 py-1 rounded-full capitalize font-medium ${STATUS_COLOR[payout.status]}`}>
          {payout.status}
        </span>
      </div>

      {/* Status Timeline */}
      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5 mb-4">
        <div className="flex items-center justify-between relative">
          <div className="absolute top-5 left-0 right-0 h-0.5 bg-[#0D1B3E]/8 z-0" />
          <div className={`absolute top-5 left-0 h-0.5 z-0 transition-all duration-500 ${isRejected ? 'bg-[#a03030]' : 'bg-[#1a7a4a]'}`}
            style={{ width: isRejected ? '50%' : currentStep === 0 ? '0%' : '100%' }} />
          {STATUS_STEPS.map((step, i) => {
            const done    = !isRejected && i <= currentStep
            const active  = i === currentStep
            const rejected = isRejected && i === 1
            return (
              <div key={step.key} className="flex flex-col items-center z-10 flex-1">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all ${
                  rejected ? 'bg-[#fdecea] border-[#a03030]' :
                  done     ? 'bg-[#1a7a4a] border-[#1a7a4a]' :
                  active   ? 'bg-white border-[#C9A84C]' :
                             'bg-white border-[#0D1B3E]/15'
                }`}>
                  {rejected ? '❌' : done ? '✓' : step.icon}
                </div>
                <p className={`text-[10px] font-medium mt-1.5 text-center ${
                  rejected ? 'text-[#a03030]' :
                  done     ? 'text-[#1a7a4a]' :
                  active   ? 'text-[#C9A84C]' : 'text-gray-300'
                }`}>
                  {rejected && i === 1 ? 'Rejected' : step.label}
                </p>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 text-center mt-4">
          {isRejected ? STATUS_STEPS[2].desc : STATUS_STEPS[currentStep]?.desc}
        </p>
      </div>

      {/* Payout Details */}
      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5 mb-4">
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-4">Payout Details</p>

        {/* Amount highlight */}
        <div className="bg-[#F0F2F8] rounded-xl px-4 py-4 flex items-center justify-between mb-4">
          <span className="text-sm text-gray-400">Amount Requested</span>
          <span className="text-2xl font-bold text-[#0D1B3E]">{fmt(Number(payout.amount))}</span>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-xs text-gray-400">Payment Method</span>
            <span className="text-xs font-medium text-[#0D1B3E] capitalize">{payout.payment_method || '—'}</span>
          </div>
          {payout.payment_reference && (
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">Account / Reference</span>
              <span className="text-xs font-mono text-[#0D1B3E]">{payout.payment_reference}</span>
            </div>
          )}
          {payout.cutoff_date && (
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">Cutoff Date</span>
              <span className="text-xs text-[#0D1B3E]">{new Date(payout.cutoff_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
            </div>
          )}
          {payout.payout_date && (
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">Expected Payout Date</span>
              <span className="text-xs font-semibold text-[#1a7a4a]">{new Date(payout.payout_date).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-xs text-gray-400">Requested At</span>
            <span className="text-xs text-[#0D1B3E]">{fmtDate(payout.requested_at)}</span>
          </div>
          {payout.processed_at && (
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">Processed At</span>
              <span className="text-xs text-[#0D1B3E]">{fmtDate(payout.processed_at)}</span>
            </div>
          )}
          {payout.approver && (
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">Processed By</span>
              <span className="text-xs text-[#0D1B3E]">{payout.approver.full_name}</span>
            </div>
          )}

          {/* Transaction number */}
          {payout.transaction_number && (
            <div className="pt-3 border-t border-[#0D1B3E]/8">
              <p className="text-xs text-gray-400 mb-2">Transaction Number</p>
              <div className="bg-[#e8f7ef] rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-[#1a7a4a] tracking-wider">{payout.transaction_number}</span>
                <button onClick={() => navigator.clipboard.writeText(payout.transaction_number!)}
                  className="text-[10px] text-[#1a7a4a] hover:underline">Copy</button>
              </div>
            </div>
          )}

          {/* Notes from admin */}
          {payout.notes && (
            <div className="pt-3 border-t border-[#0D1B3E]/8">
              <p className="text-xs text-gray-400 mb-1">Note from Admin</p>
              <p className="text-xs text-[#0D1B3E] bg-[#F0F2F8] rounded-lg px-3 py-2">{payout.notes}</p>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}