'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface Wallet {
  balance: number
  total_earned: number
  total_withdrawn: number
}

interface CommissionSummary {
  direct_referral: { amount: number; count: number }
  binary_pairing:  { amount: number; count: number }
  multilevel:      { amount: number; count: number }
  sponsor_point:   { amount: number; count: number }
}

interface Commission {
  id: string
  type: string
  amount: number
  points: number | null
  is_pair_overflow: boolean
  created_at: string
  source_user: { full_name: string; username: string } | null
}

interface Payout {
  id: string
  amount: number
  status: string
  payment_method: string | null
  payment_reference: string | null
  requested_at: string
  processed_at: string | null
}

const PAGE_SIZE = 10

const COMMISSION_LABELS: Record<string, string> = {
  direct_referral: 'Direct Referral',
  binary_pairing:  'Binary Pairing',
  multilevel:      'Multi-level',
  sponsor_point:   'Sponsor Point',
}

const COMMISSION_COLORS: Record<string, string> = {
  direct_referral: '#C9A84C',
  binary_pairing:  '#0D1B3E',
  multilevel:      '#2563eb',
  sponsor_point:   '#1a7a4a',
}

const PAYOUT_STATUS_COLORS: Record<string, string> = {
  pending:  'bg-[#fef9ee] text-[#9a6f1e]',
  approved: 'bg-[#e8f7ef] text-[#1a7a4a]',
  rejected: 'bg-[#fdecea] text-[#a03030]',
}

function fmt(n: number) {
  return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ============================================================
// PAYOUT MODAL
// ============================================================

function PayoutModal({
  balance,
  onClose,
  onSuccess,
}: {
  balance: number
  onClose: () => void
  onSuccess: () => void
}) {
  const [amount, setAmount]       = useState('')
  const [method, setMethod]       = useState('')
  const [reference, setReference] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState('')

  const METHODS = ['GCash', 'Maya', 'BDO', 'BPI', 'UnionBank', 'Cash']

  const handleSubmit = async () => {
    setError('')
    if (!amount || parseFloat(amount) <= 0) { setError('Enter a valid amount.'); return }
    if (parseFloat(amount) > balance)        { setError('Amount exceeds your balance.'); return }
    if (!method)                             { setError('Select a payment method.'); return }

    setSubmitting(true)
    const res = await fetch('/api/reseller/wallet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseFloat(amount), payment_method: method, payment_reference: reference }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) onSuccess()
    else setError(data.error || 'Something went wrong.')
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Request Payout</h2>
            <p className="text-xs text-gray-400 mt-0.5">Available: <span className="text-[#1a7a4a] font-medium">{fmt(balance)}</span></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">

          {/* Amount */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₱</span>
              <input
                type="number" min={1} max={balance} value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg pl-7 pr-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors"
              />
            </div>
            <div className="flex gap-2 mt-1.5">
              {[100, 500, 1000].map((v) => (
                <button key={v} onClick={() => setAmount(String(Math.min(v, balance)))}
                  className="text-xs px-2 py-1 bg-[#F0F2F8] text-gray-500 rounded hover:bg-[#e4e6ef] transition-colors">
                  ₱{v}
                </button>
              ))}
              <button onClick={() => setAmount(String(balance))}
                className="text-xs px-2 py-1 bg-[#F0F2F8] text-gray-500 rounded hover:bg-[#e4e6ef] transition-colors">
                Max
              </button>
            </div>
          </div>

          {/* Payment method */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Payment Method</label>
            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <button key={m} onClick={() => setMethod(m)}
                  className={`text-xs py-2 rounded-lg border transition-colors ${
                    method === m
                      ? 'bg-[#0D1B3E] text-white border-[#0D1B3E]'
                      : 'bg-[#F0F2F8] text-gray-500 border-transparent hover:border-[#0D1B3E]/20'
                  }`}>{m}</button>
              ))}
            </div>
          </div>

          {/* Account / reference */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Account Number / Reference</label>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. 09XX XXX XXXX"
              className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
            />
          </div>

          {error && <p className="text-xs text-[#a03030] bg-[#fdecea] px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
              className="flex-1 bg-[#F0F2F8] text-gray-500 text-sm py-2 rounded-lg hover:bg-[#e4e6ef] transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="flex-1 bg-[#C9A84C] text-white text-sm py-2 rounded-lg hover:bg-[#b8963e] transition-colors disabled:opacity-50 font-medium">
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function ResellerWalletPage() {
  const [wallet, setWallet]               = useState<Wallet | null>(null)
  const [commissionSummary, setSummary]   = useState<CommissionSummary | null>(null)
  const [commissions, setCommissions]     = useState<Commission[]>([])
  const [payouts, setPayouts]             = useState<Payout[]>([])
  const [meta, setMeta]                   = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]             = useState(true)
  const [tab, setTab]                     = useState<'commissions' | 'payouts'>('commissions')
  const [page, setPage]                   = useState(1)
  const [showPayout, setShowPayout]       = useState(false)

  useEffect(() => { setPage(1) }, [tab])

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ tab, page: String(page), pageSize: String(PAGE_SIZE) })
    fetch(`/api/reseller/wallet?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.wallet)             setWallet(data.wallet)
        if (data.commission_summary) setSummary(data.commission_summary)
        if (data.commissions)        setCommissions(data.commissions)
        if (data.payouts)            setPayouts(data.payouts)
        if (data.meta)               setMeta(data.meta)
      })
      .finally(() => setLoading(false))
  }, [tab, page])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Wallet & Earnings</h1>
          <p className="text-sm text-gray-400 mt-0.5">Your balance and commission history</p>
        </div>
        <button
          onClick={() => setShowPayout(true)}
          className="bg-[#C9A84C] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#b8963e] transition-colors font-medium"
        >
          Request Payout
        </button>
      </div>

      {/* Wallet cards */}
      {wallet && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'Available Balance', value: fmt(wallet.balance),         accent: '#C9A84C' },
            { label: 'Total Earned',      value: fmt(wallet.total_earned),    accent: '#0D1B3E' },
            { label: 'Total Withdrawn',   value: fmt(wallet.total_withdrawn), accent: '#1a7a4a' },
          ].map((c) => (
            <div key={c.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-5"
              style={{ borderTop: `2px solid ${c.accent}` }}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{c.label}</p>
              <p className="text-2xl font-semibold" style={{ color: c.accent }}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Commission summary */}
      {commissionSummary && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-5">
          <p className="text-sm font-semibold text-[#0D1B3E] mb-4">Earnings Breakdown</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(commissionSummary).map(([type, data]) => (
              <div key={type} className="rounded-xl p-3 border border-[#0D1B3E]/8">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COMMISSION_COLORS[type] }} />
                  <p className="text-[10px] text-gray-400 leading-tight">{COMMISSION_LABELS[type]}</p>
                </div>
                <p className="text-base font-semibold text-[#0D1B3E]">{fmt(data.amount)}</p>
                <p className="text-[10px] text-gray-400">{data.count} transactions</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History tabs */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Tab header */}
        <div className="flex border-b border-[#0D1B3E]/8">
          {([
            { key: 'commissions', label: 'Commission History' },
            { key: 'payouts',     label: 'Payout History' },
          ] as const).map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'text-[#C9A84C] border-b-2 border-[#C9A84C]'
                  : 'text-gray-400 hover:text-[#0D1B3E]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Commission history */}
        {tab === 'commissions' && (
          <>
            <div className="grid grid-cols-4 px-4 py-2 bg-[#F0F2F8]">
              {['Type', 'Source', 'Amount', 'Date'].map((h) => (
                <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
              ))}
            </div>
            {loading ? (
              <div className="py-12 text-center">
                <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Loading...</p>
              </div>
            ) : commissions.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-12">No commissions yet.</p>
            ) : (
              commissions.map((c) => (
                <div key={c.id} className="grid grid-cols-4 px-4 py-3 border-b border-[#0D1B3E]/5 items-center hover:bg-[#F0F2F8]/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: COMMISSION_COLORS[c.type] }} />
                    <div>
                      <p className="text-xs font-medium text-[#0D1B3E]">{COMMISSION_LABELS[c.type]}</p>
                      {c.is_pair_overflow && (
                        <span className="text-[9px] text-[#9a6f1e] bg-[#fef9ee] px-1.5 py-0.5 rounded-full">overflow</span>
                      )}
                    </div>
                  </div>
                  <div>
                    {c.source_user ? (
                      <>
                        <p className="text-xs text-[#0D1B3E]">{c.source_user.full_name}</p>
                        <p className="text-[10px] text-gray-400">@{c.source_user.username}</p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-400">—</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#0D1B3E]">{fmt(Number(c.amount))}</p>
                    {c.points && <p className="text-[10px] text-[#1a7a4a]">+{c.points} pts</p>}
                  </div>
                  <p className="text-xs text-gray-400">{new Date(c.created_at).toLocaleDateString('en-PH')}</p>
                </div>
              ))
            )}
          </>
        )}

        {/* Payout history */}
        {tab === 'payouts' && (
          <>
            <div className="grid grid-cols-4 px-4 py-2 bg-[#F0F2F8]">
              {['Amount', 'Method', 'Status', 'Date'].map((h) => (
                <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
              ))}
            </div>
            {loading ? (
              <div className="py-12 text-center">
                <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Loading...</p>
              </div>
            ) : payouts.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-12">No payout requests yet.</p>
            ) : (
              payouts.map((p) => (
                <div key={p.id} className="grid grid-cols-4 px-4 py-3 border-b border-[#0D1B3E]/5 items-center hover:bg-[#F0F2F8]/50 transition-colors">
                  <p className="text-xs font-semibold text-[#0D1B3E]">{fmt(Number(p.amount))}</p>
                  <div>
                    <p className="text-xs text-[#0D1B3E]">{p.payment_method || '—'}</p>
                    {p.payment_reference && (
                      <p className="text-[10px] text-gray-400">{p.payment_reference}</p>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full w-fit capitalize ${PAYOUT_STATUS_COLORS[p.status]}`}>
                    {p.status}
                  </span>
                  <div>
                    <p className="text-xs text-gray-400">{new Date(p.requested_at).toLocaleDateString('en-PH')}</p>
                    {p.processed_at && (
                      <p className="text-[10px] text-gray-300">Processed: {new Date(p.processed_at).toLocaleDateString('en-PH')}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* Payout modal */}
      {showPayout && wallet && (
        <PayoutModal
          balance={wallet.balance}
          onClose={() => setShowPayout(false)}
          onSuccess={() => { setShowPayout(false); fetchData() }}
        />
      )}
    </div>
  )
}