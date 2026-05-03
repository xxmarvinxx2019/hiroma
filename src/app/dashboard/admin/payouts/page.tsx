'use client'

import { useState, useEffect, useCallback } from 'react'

// ============================================================
// TYPES
// ============================================================

interface Payout {
  id: string
  amount: number
  status: string
  payment_method: string | null
  payment_reference: string | null
  requested_at: string
  processed_at: string | null
  user: {
    full_name: string
    username: string
    mobile: string
  }
  approver: { full_name: string } | null
}

interface PaginationMeta {
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ============================================================
// PAGINATION COMPONENT
// ============================================================

function Pagination({
  meta,
  onPageChange,
}: {
  meta: PaginationMeta
  onPageChange: (page: number) => void
}) {
  const pages = Array.from({ length: meta.totalPages }, (_, i) => i + 1)
  const showPages = pages.filter(
    (p) => p === 1 || p === meta.totalPages || Math.abs(p - meta.page) <= 1
  )

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-[#0D1B3E]/8">
      <p className="text-xs text-gray-400">
        Showing {Math.min((meta.page - 1) * meta.pageSize + 1, meta.total)}–
        {Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total} results
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(meta.page - 1)}
          disabled={meta.page === 1}
          className="text-xs px-3 py-1.5 rounded-lg bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        {showPages.map((p, i) => {
          const prev = showPages[i - 1]
          const showEllipsis = prev && p - prev > 1
          return (
            <span key={p} className="flex items-center gap-1">
              {showEllipsis && (
                <span className="text-xs text-gray-400 px-1">...</span>
              )}
              <button
                onClick={() => onPageChange(p)}
                className={`text-xs w-7 h-7 rounded-lg transition-colors ${
                  meta.page === p
                    ? 'bg-[#0D1B3E] text-white'
                    : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}
              >
                {p}
              </button>
            </span>
          )
        })}
        <button
          onClick={() => onPageChange(meta.page + 1)}
          disabled={meta.page === meta.totalPages}
          className="text-xs px-3 py-1.5 rounded-lg bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

const PAGE_SIZE = 15

export default function PayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [meta, setMeta] = useState<PaginationMeta>({
    total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1,
  })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Payout | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionForm, setActionForm] = useState({
    payment_method: '',
    payment_reference: '',
  })

  const fetchPayouts = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      status: statusFilter,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...(search && { search }),
    })
    fetch(`/api/admin/payouts?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setPayouts(data.payouts || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
      })
      .finally(() => setLoading(false))
  }, [statusFilter, page, search])

  useEffect(() => { fetchPayouts() }, [fetchPayouts])

  // Reset to page 1 when filter or search changes
  useEffect(() => { setPage(1) }, [statusFilter, search])

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const handleApprove = async () => {
    if (!selected || !actionForm.payment_method) {
      alert('Please select a payment method.')
      return
    }
    setActionLoading(true)
    await fetch(`/api/admin/payouts/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        payment_method: actionForm.payment_method,
        payment_reference: actionForm.payment_reference,
      }),
    })
    setActionLoading(false)
    setSelected(null)
    setActionForm({ payment_method: '', payment_reference: '' })
    fetchPayouts()
  }

  const handleReject = async () => {
    if (!selected) return
    setActionLoading(true)
    await fetch(`/api/admin/payouts/${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' }),
    })
    setActionLoading(false)
    setSelected(null)
    fetchPayouts()
  }

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Payouts</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Review and approve reseller withdrawal requests
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total results', value: meta.total, accent: 'navy' },
          { label: 'Current page', value: `${meta.page} of ${meta.totalPages}`, accent: 'gold' },
          { label: 'Page size', value: `${PAGE_SIZE} per page`, accent: 'navy' },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent === 'gold' ? '#C9A84C' : '#0D1B3E'}` }}
          >
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent === 'gold' ? '#C9A84C' : '#0D1B3E' }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Search & Filter */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or username..."
            className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1">
            {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  statusFilter === f
                    ? 'bg-[#0D1B3E] text-white'
                    : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-6 px-4 py-2 bg-[#F0F2F8]">
          {['Reseller', 'Amount', 'Payment method', 'Status', 'Requested', 'Action'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : payouts.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">
            No {statusFilter === 'all' ? '' : statusFilter} payout requests found
          </div>
        ) : (
          payouts.map((payout) => (
            <div
              key={payout.id}
              className="grid grid-cols-6 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center"
            >
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{payout.user.full_name}</p>
                <p className="text-xs text-gray-400">@{payout.user.username}</p>
                <p className="text-xs text-gray-400">{payout.user.mobile}</p>
              </div>
              <p className="text-xs font-semibold text-[#C9A84C]">
                ₱{Number(payout.amount).toLocaleString()}
              </p>
              <p className="text-xs text-gray-400">
                {payout.payment_method || '—'}
              </p>
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  payout.status === 'pending'
                    ? 'bg-[#fef6e4] text-[#9a6f1e]'
                    : payout.status === 'approved'
                    ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                    : 'bg-[#fdecea] text-[#a03030]'
                }`}>
                  {payout.status}
                </span>
              </span>
              <p className="text-xs text-gray-400">
                {new Date(payout.requested_at).toLocaleDateString('en-PH')}
              </p>
              {payout.status === 'pending' ? (
                <button
                  onClick={() => {
                    setSelected(payout)
                    setActionForm({ payment_method: '', payment_reference: '' })
                  }}
                  className="text-xs text-[#C9A84C] hover:underline font-medium text-left"
                >
                  Review
                </button>
              ) : (
                <p className="text-xs text-gray-400">
                  {payout.processed_at
                    ? new Date(payout.processed_at).toLocaleDateString('en-PH')
                    : '—'}
                </p>
              )}
            </div>
          ))
        )}

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <Pagination meta={meta} onPageChange={setPage} />
        )}
      </div>

      {/* Review Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="bg-[#0D1B3E] px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">Review payout request</h2>
              <button
                onClick={() => setSelected(null)}
                className="text-white/50 hover:text-white text-lg cursor-pointer"
              >✕</button>
            </div>
            <div className="p-6">
              <div className="bg-[#F0F2F8] rounded-xl p-4 mb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-[#C9A84C]/20 border border-[#C9A84C]/40 flex items-center justify-center">
                    <span className="text-[#C9A84C] font-bold">{selected.user.full_name.charAt(0)}</span>
                  </div>
                  <div>
                    <p className="text-[#0D1B3E] font-semibold text-sm">{selected.user.full_name}</p>
                    <p className="text-gray-400 text-xs">@{selected.user.username}</p>
                  </div>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#0D1B3E]/8">
                  <span className="text-xs text-gray-400">Amount requested</span>
                  <span className="text-sm font-bold text-[#C9A84C]">₱{Number(selected.amount).toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#0D1B3E]/8">
                  <span className="text-xs text-gray-400">Mobile</span>
                  <span className="text-xs font-medium text-[#0D1B3E]">{selected.user.mobile}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-xs text-gray-400">Requested on</span>
                  <span className="text-xs font-medium text-[#0D1B3E]">
                    {new Date(selected.requested_at).toLocaleDateString('en-PH')}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 mb-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Payment method <span className="text-[#C9A84C]">*</span>
                  </label>
                  <select
                    value={actionForm.payment_method}
                    onChange={(e) => setActionForm({ ...actionForm, payment_method: e.target.value })}
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  >
                    <option value="">Select payment method</option>
                    <option value="GCash">GCash</option>
                    <option value="Bank transfer">Bank transfer</option>
                    <option value="Maya">Maya</option>
                    <option value="Cash">Cash</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Reference number</label>
                  <input
                    value={actionForm.payment_reference}
                    onChange={(e) => setActionForm({ ...actionForm, payment_reference: e.target.value })}
                    placeholder="Transaction / reference number"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleReject}
                  disabled={actionLoading}
                  className="flex-1 bg-[#fdecea] text-[#a03030] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#fbd5d5] transition-colors disabled:opacity-60"
                >
                  {actionLoading ? '...' : '✕ Reject'}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] transition-colors disabled:opacity-60"
                >
                  {actionLoading ? 'Processing...' : '✓ Approve payout'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}