'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

interface PinRequest {
  id:                  string
  quantity:            number
  total_amount:        number
  payment_method:      string
  payment_reference:   string | null
  payment_sender_name: string | null
  payment_datetime:    string | null
  payment_status:      string
  status:              string
  notes:               string | null
  created_at:          string
  city_dist: { id: string; full_name: string; username: string } | null
  package:   { id: string; name: string; price: number } | null
}

const PAGE_SIZE = 15

const STATUS_COLOR: Record<string, string> = {
  pending:  'bg-[#fef9ee] text-[#9a6f1e]',
  approved: 'bg-[#e8f7ef] text-[#1a7a4a]',
  rejected: 'bg-[#fdecea] text-[#a03030]',
}

const PAYMENT_LABEL: Record<string, string> = {
  cash_on_pickup: '💵 Cash',
  gcash:          '📱 GCash',
  bank_transfer:  '🏦 Bank',
}

export default function AdminPinRequestsPage() {
  const [requests, setRequests]   = useState<PinRequest[]>([])
  const [meta, setMeta]           = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]     = useState(true)
  const [summary, setSummary]     = useState({ total: 0, pending: 0, approved: 0, rejected: 0 })
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch]       = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage]           = useState(1)
  const [acting, setActing]       = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [statusFilter, search])

  const fetchRequests = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page:     String(page),
      pageSize: String(PAGE_SIZE),
      status:   statusFilter,
      ...(search && { search }),
    })
    fetch(`/api/pin-requests?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setRequests(d.requests || [])
        setMeta(d.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (d.summary) setSummary(d.summary)
      })
      .finally(() => setLoading(false))
  }, [page, statusFilter, search])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  const handleAction = async (id: string, status: string, payment_status?: string) => {
    setActing(id)
    await fetch('/api/pin-requests', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, status, payment_status }),
    })
    setActing(null)
    fetchRequests()
  }

  return (
    <div className="max-w-6xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">PIN Requests</h1>
        <p className="text-sm text-gray-400 mt-0.5">Review and approve PIN requests from city distributors</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',    value: summary.total,    accent: '#0D1B3E' },
          { label: 'Pending',  value: summary.pending,  accent: '#9a6f1e' },
          { label: 'Approved', value: summary.approved, accent: '#1a7a4a' },
          { label: 'Rejected', value: summary.rejected, accent: '#e05252' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8">

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#0D1B3E]/8 flex-wrap">
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by distributor or package..."
            className="flex-1 min-w-[200px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />
          {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${statusFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'}`}>
              {f}
              {f === 'pending' && summary.pending > 0 && (
                <span className="ml-1.5 bg-[#9a6f1e] text-white text-[9px] px-1.5 py-0.5 rounded-full">{summary.pending}</span>
              )}
            </button>
          ))}
        </div>

        {/* Header */}
        <div className="grid px-4 py-2 bg-[#F0F2F8]" style={{ gridTemplateColumns: '2fr 1fr 1fr 1.5fr 1fr 1.5fr' }}>
          {['City Distributor', 'Package', 'Qty / Total', 'Payment', 'Status', 'Actions'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-gray-400 text-sm">No PIN requests found.</p>
          </div>
        ) : (
          requests.map((r) => (
            <div key={r.id} className="grid px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 items-center"
              style={{ gridTemplateColumns: '2fr 1fr 1fr 1.5fr 1fr 1.5fr' }}>

              {/* City Distributor */}
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{r.city_dist?.full_name || '—'}</p>
                <p className="text-[10px] text-gray-400">@{r.city_dist?.username}</p>
                <p className="text-[10px] text-gray-300">{new Date(r.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>

              {/* Package */}
              <div>
                <span className="text-xs bg-[#fef6e4] text-[#9a6f1e] px-2 py-0.5 rounded-full">{r.package?.name || '—'}</span>
                <p className="text-[10px] text-gray-400 mt-0.5">₱{Number(r.package?.price || 0).toLocaleString()}/PIN</p>
              </div>

              {/* Qty / Total */}
              <div>
                <p className="text-xs font-semibold text-[#0D1B3E]">{r.quantity} PINs</p>
                <p className="text-xs text-[#C9A84C]">₱{Number(r.total_amount).toLocaleString()}</p>
              </div>

              {/* Payment */}
              <div>
                <p className="text-[10px] text-gray-500">{PAYMENT_LABEL[r.payment_method] || r.payment_method}</p>
                {r.payment_reference    && <p className="text-[10px] text-gray-400">Ref: {r.payment_reference}</p>}
                {r.payment_sender_name  && <p className="text-[10px] text-gray-400">Sender: {r.payment_sender_name}</p>}
                {r.payment_datetime     && <p className="text-[10px] text-gray-400">{new Date(r.payment_datetime).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
                {r.payment_status === 'paid'
                  ? <span className="text-[10px] text-[#1a7a4a] font-medium">✓ Paid</span>
                  : r.payment_method !== 'cash_on_pickup'
                  ? <span className="text-[10px] text-[#9a6f1e]">⏳ Unpaid</span>
                  : null}
              </div>

              {/* Status */}
              <span className={`text-xs px-2 py-0.5 rounded-full w-fit capitalize ${STATUS_COLOR[r.status]}`}>
                {r.status}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {r.status === 'pending' && (
                  <>
                    {/* Confirm payment if non-cash and unpaid */}
                    {r.payment_method !== 'cash_on_pickup' && r.payment_status !== 'paid' && (
                      <button onClick={() => handleAction(r.id, r.status, 'paid')} disabled={acting === r.id}
                        className="text-[10px] bg-[#e8f7ef] text-[#1a7a4a] px-2 py-1 rounded-lg hover:bg-[#d4f0e0] disabled:opacity-50 font-medium">
                        ✓ Paid
                      </button>
                    )}
                    <button onClick={() => handleAction(r.id, 'approved')} disabled={acting === r.id}
                      className="text-[10px] bg-[#0D1B3E] text-white px-2 py-1 rounded-lg hover:bg-[#162850] disabled:opacity-50 font-medium">
                      {acting === r.id ? '...' : 'Approve'}
                    </button>
                    <button onClick={() => handleAction(r.id, 'rejected')} disabled={acting === r.id}
                      className="text-[10px] bg-[#fdecea] text-[#a03030] px-2 py-1 rounded-lg hover:bg-[#fcd9d9] disabled:opacity-50">
                      Reject
                    </button>
                  </>
                )}
                {r.notes && (
                  <span className="text-[10px] text-gray-400 italic truncate max-w-[100px]" title={r.notes}>
                    📝 {r.notes}
                  </span>
                )}
              </div>
            </div>
          ))
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>
    </div>
  )
}