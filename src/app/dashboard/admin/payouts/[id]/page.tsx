'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface PayoutDetail {
  id:                 string
  amount:             number
  status:             'pending' | 'approved' | 'rejected' | 'released'
  payment_method:     string | null
  payment_reference:  string | null
  transaction_number: string | null
  cutoff_date:        string | null
  payout_date:        string | null
  notes:              string | null
  requested_at:       string
  processed_at:       string | null
  user: {
    full_name:  string
    username:   string
    mobile:     string
    address:    string | null
    role:       string
  }
  approver: { full_name: string } | null
}

const fmt     = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: string)  => new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const STATUS_STEPS = [
  { key: 'pending',  label: 'Requested', icon: '📋', desc: 'Payout request submitted and awaiting admin review.' },
  { key: 'approved', label: 'Approved',  icon: '✅', desc: 'Verified by admin. Will be released on payout date.' },
  { key: 'released', label: 'Released',  icon: '💸', desc: 'Payout has been released. Funds sent to reseller.' },
]

const STATUS_COLOR: Record<string, string> = {
  pending:  'bg-[#fef9ee] text-[#9a6f1e] border border-[#C9A84C]/30',
  approved: 'bg-[#e8f7ef] text-[#1a7a4a] border border-[#1a7a4a]/20',
  rejected: 'bg-[#fdecea] text-[#a03030] border border-[#a03030]/20',
  released: 'bg-[#e8f0fe] text-[#1a56db] border border-[#1a56db]/20',
}

export default function AdminPayoutDetailPage() {
  const params    = useParams()
  const router    = useRouter()
  const [payout, setPayout]   = useState<PayoutDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [processing, setProcessing] = useState(false)
  const [actionModal, setActionModal] = useState<'approve' | 'reject' | null>(null)
  const [notes, setNotes]     = useState('')
  const [resultTx, setResultTx] = useState<string | null>(null)

  useEffect(() => {
    const id = params?.id as string
    if (!id) return
    fetch(`/api/admin/payouts/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setPayout(data.payout)
      })
      .catch(() => setError('Failed to load payout.'))
      .finally(() => setLoading(false))
  }, [params?.id])

  const handleAction = async (action: 'approve' | 'reject') => {
    if (!payout) return
    setProcessing(true)
    const res  = await fetch('/api/admin/payouts', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ payout_id: payout.id, action, notes }),
    })
    const data = await res.json()
    setProcessing(false)
    setActionModal(null)
    setNotes('')
    if (data.success) {
      if (action === 'approve' && data.transaction_number) setResultTx(data.transaction_number)
      // Refresh payout
      fetch(`/api/admin/payouts/${payout.id}`)
        .then((r) => r.json())
        .then((d) => { if (d.payout) setPayout(d.payout) })
    }
  }

  if (loading) return (
    <div className="flex justify-center items-center py-24">
      <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (error) return <p className="text-center text-[#a03030] py-16">{error}</p>
  if (!payout) return null

  const isRejected  = payout.status === 'rejected'
  const currentStep = isRejected ? 1 : STATUS_STEPS.findIndex((s) => s.key === payout.status)

  return (
    <div className="max-w-3xl mx-auto">

      {/* Back */}
      <button onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-[#0D1B3E] mb-5 transition-colors">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 5l-7 7 7 7"/>
        </svg>
        Back to Payouts
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Payout Request</h1>
          {payout.transaction_number && (
            <p className="text-sm font-mono text-[#1a7a4a] mt-0.5">{payout.transaction_number}</p>
          )}
        </div>
        <span className={`text-xs px-3 py-1 rounded-full capitalize font-medium ${STATUS_COLOR[payout.status]}`}>
          {payout.status}
        </span>
      </div>

      {/* Status Timeline */}
      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5 mb-4">
        <div className="flex items-center justify-between relative">
          {/* Progress line */}
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
        {/* Current step description */}
        <p className="text-xs text-gray-400 text-center mt-4">
          {isRejected ? 'This payout request was rejected.' : STATUS_STEPS[currentStep]?.desc}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-4">

        {/* Payout Info */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Payout Details</p>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400">Amount</span>
              <span className="text-lg font-bold text-[#0D1B3E]">{fmt(Number(payout.amount))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">Payment Method</span>
              <span className="text-xs font-medium text-[#0D1B3E] capitalize">{payout.payment_method || '—'}</span>
            </div>
            {payout.payment_reference && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Reference</span>
                <span className="text-xs font-mono text-[#0D1B3E]">{payout.payment_reference}</span>
              </div>
            )}
            {payout.transaction_number && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400">Transaction No.</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-mono font-bold text-[#1a7a4a]">{payout.transaction_number}</span>
                  <button onClick={() => navigator.clipboard.writeText(payout.transaction_number!)}
                    className="text-[9px] text-[#C9A84C] hover:underline">Copy</button>
                </div>
              </div>
            )}
            {payout.cutoff_date && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Cutoff Date</span>
                <span className="text-xs text-[#0D1B3E]">{new Date(payout.cutoff_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
            )}
            {payout.payout_date && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Expected Payout</span>
                <span className="text-xs font-medium text-[#1a7a4a]">{new Date(payout.payout_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">Requested</span>
              <span className="text-xs text-[#0D1B3E]">{fmtDate(payout.requested_at)}</span>
            </div>
            {payout.processed_at && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Processed</span>
                <span className="text-xs text-[#0D1B3E]">{fmtDate(payout.processed_at)}</span>
              </div>
            )}
            {payout.approver && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Processed by</span>
                <span className="text-xs text-[#0D1B3E]">{payout.approver.full_name}</span>
              </div>
            )}
            {payout.notes && (
              <div className="pt-2 border-t border-[#0D1B3E]/8">
                <p className="text-xs text-gray-400 mb-1">Notes</p>
                <p className="text-xs text-[#0D1B3E]">{payout.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Reseller Info */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Reseller</p>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-[#0D1B3E]/8 flex items-center justify-center text-[#0D1B3E] font-bold text-sm">
              {payout.user.full_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#0D1B3E]">{payout.user.full_name}</p>
              <p className="text-xs text-gray-400">@{payout.user.username}</p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">Mobile</span>
              <span className="text-xs text-[#0D1B3E]">{payout.user.mobile}</span>
            </div>
            {payout.user.address && (
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Address</span>
                <span className="text-xs text-[#0D1B3E] text-right max-w-[60%]">{payout.user.address}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-xs text-gray-400">Role</span>
              <span className="text-xs text-[#0D1B3E] capitalize">{payout.user.role}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      {payout.status === 'pending' && (
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Actions</p>
          <div className="flex gap-3">
            <button onClick={() => setActionModal('approve')}
              className="flex-1 py-2.5 rounded-xl bg-[#1a7a4a] text-white text-sm font-medium hover:bg-[#155f3a] transition-colors">
              ✓ Approve Payout
            </button>
            <button onClick={() => setActionModal('reject')}
              className="flex-1 py-2.5 rounded-xl bg-[#fdecea] text-[#a03030] text-sm font-medium hover:bg-[#a03030] hover:text-white transition-colors">
              ✕ Reject Payout
            </button>
          </div>
        </div>
      )}

      {/* Action Modal */}
      {actionModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${
              actionModal === 'approve' ? 'bg-[#e8f7ef]' : 'bg-[#fdecea]'
            }`}>
              {actionModal === 'approve' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a7a4a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a03030" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              )}
            </div>
            <h2 className="text-base font-semibold text-[#0D1B3E] text-center mb-1 capitalize">{actionModal} Payout?</h2>
            <p className="text-xs text-gray-400 text-center mb-4">
              {fmt(Number(payout.amount))} for <span className="font-medium text-[#0D1B3E]">{payout.user.full_name}</span>
              {actionModal === 'approve' && <span className="block mt-1 text-[#1a7a4a]">A transaction number will be auto-generated.</span>}
            </p>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note (optional)..." rows={2}
              className="w-full border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] mb-4 resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { setActionModal(null); setNotes('') }}
                className="flex-1 py-2 rounded-lg border border-[#0D1B3E]/15 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleAction(actionModal)} disabled={processing}
                className={`flex-1 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 ${
                  actionModal === 'approve' ? 'bg-[#1a7a4a] hover:bg-[#155f3a]' : 'bg-[#a03030] hover:bg-[#7e2424]'
                }`}>
                {processing ? 'Processing...' : actionModal === 'approve' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction number result */}
      {resultTx && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-[#e8f7ef] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a7a4a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg>
            </div>
            <h2 className="text-base font-semibold text-[#0D1B3E] mb-1">Payout Approved!</h2>
            <p className="text-xs text-gray-400 mb-4">Transaction Number</p>
            <div className="bg-[#F0F2F8] rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3">
              <span className="font-mono text-sm font-bold text-[#0D1B3E] tracking-wider">{resultTx}</span>
              <button onClick={() => navigator.clipboard.writeText(resultTx)} className="text-[10px] text-[#C9A84C] hover:underline">Copy</button>
            </div>
            <button onClick={() => setResultTx(null)}
              className="w-full py-2 rounded-lg bg-[#0D1B3E] text-white text-sm font-medium hover:bg-[#162850]">Done</button>
          </div>
        </div>
      )}

    </div>
  )
}