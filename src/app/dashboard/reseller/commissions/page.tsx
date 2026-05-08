'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface Commission {
  id: string
  type: string
  amount: number
  points: number | null
  cascade_remainder: number | null
  is_pair_overflow: boolean
  created_at: string
  source_user: { full_name: string; username: string } | null
}

interface Summary {
  direct_referral: { amount: number; count: number }
  binary_pairing:  { amount: number; count: number }
  multilevel:      { amount: number; count: number }
  sponsor_point:   { amount: number; count: number }
}

const PAGE_SIZE = 15

const COMMISSION_META: Record<string, { label: string; color: string; bg: string; desc: string }> = {
  direct_referral: {
    label: 'Direct Referral',
    color: '#C9A84C',
    bg:    '#fef9ee',
    desc:  'Earned when you personally refer a new reseller',
  },
  binary_pairing: {
    label: 'Binary Pairing',
    color: '#0D1B3E',
    bg:    '#eef0f8',
    desc:  'Earned when both your left and right legs match',
  },
  multilevel: {
    label: 'Multi-level',
    color: '#2563eb',
    bg:    '#f0f7ff',
    desc:  'Earnings flowing upline from downline activity',
  },
  sponsor_point: {
    label: 'Sponsor Point',
    color: '#1a7a4a',
    bg:    '#e8f7ef',
    desc:  'Points converted when both referred legs each purchase 2 bottles',
  },
}

function fmt(n: number) {
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ============================================================
// PAGE
// ============================================================

export default function ResellerCommissionsPage() {
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [summary, setSummary]         = useState<Summary | null>(null)
  const [grandTotal, setGrandTotal]   = useState({ amount: 0, count: 0 })
  const [meta, setMeta]               = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]         = useState(true)
  const [typeFilter, setTypeFilter]   = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]           = useState('')
  const [page, setPage]               = useState(1)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [typeFilter, search])

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      type: typeFilter, page: String(page), pageSize: String(PAGE_SIZE),
      ...(search && { search }),
    })
    fetch(`/api/reseller/commissions?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setCommissions(data.commissions || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (data.summary)     setSummary(data.summary)
        if (data.grand_total) setGrandTotal(data.grand_total)
      })
      .finally(() => setLoading(false))
  }, [typeFilter, page, search])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Commissions</h1>
        <p className="text-sm text-gray-400 mt-0.5">Detailed breakdown of all your earnings</p>
      </div>

      {/* Grand total banner */}
      <div className="bg-[#0D1B3E] rounded-2xl p-5 flex items-center justify-between">
        <div>
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Total Commissions Earned</p>
          <p className="text-white text-3xl font-semibold">{fmt(grandTotal.amount)}</p>
          <p className="text-white/40 text-xs mt-1">{grandTotal.count} transactions</p>
        </div>
        <div className="w-14 h-14 rounded-full bg-[#C9A84C]/20 border border-[#C9A84C]/40 flex items-center justify-center">
          <span className="text-2xl">📊</span>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(summary).map(([type, data]) => {
            const meta = COMMISSION_META[type]
            return (
              <div
                key={type}
                onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
                className={`bg-white rounded-xl border-2 p-4 cursor-pointer transition-all ${
                  typeFilter === type
                    ? 'border-current shadow-sm scale-[1.02]'
                    : 'border-[#0D1B3E]/8 hover:border-[#0D1B3E]/20'
                }`}
                style={{ borderTop: `3px solid ${meta.color}` }}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                  <p className="text-[10px] text-gray-400 leading-tight">{meta.label}</p>
                </div>
                <p className="text-lg font-semibold text-[#0D1B3E]">{fmt(data.amount)}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{data.count} transactions</p>
                <p className="text-[9px] text-gray-300 mt-1 leading-tight">{meta.desc}</p>
              </div>
            )
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by source name or username..."
            className="flex-1 min-w-[200px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1 flex-wrap">
            {(['all', 'direct_referral', 'binary_pairing', 'multilevel', 'sponsor_point'] as const).map((f) => (
              <button key={f} onClick={() => setTypeFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                  typeFilter === f
                    ? 'text-white'
                    : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}
                style={typeFilter === f ? {
                  background: f === 'all' ? '#0D1B3E' : COMMISSION_META[f]?.color,
                } : {}}>
                {f === 'all' ? 'All' : COMMISSION_META[f]?.label}
              </button>
            ))}
          </div>
        </div>

        {/* Header */}
        <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
          {['Type', 'Source', 'Amount', 'Points', 'Date'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : commissions.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No commissions found.</p>
          </div>
        ) : (
          commissions.map((c) => {
            const m = COMMISSION_META[c.type]
            return (
              <div key={c.id}
                className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center">

                {/* Type */}
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: m?.bg }}>
                    <div className="w-2 h-2 rounded-full" style={{ background: m?.color }} />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[#0D1B3E]">{m?.label}</p>
                    {c.is_pair_overflow && (
                      <span className="text-[9px] bg-[#fef9ee] text-[#9a6f1e] px-1.5 py-0.5 rounded-full">
                        overflow
                      </span>
                    )}
                  </div>
                </div>

                {/* Source */}
                <div>
                  {c.source_user ? (
                    <>
                      <p className="text-xs text-[#0D1B3E] font-medium">{c.source_user.full_name}</p>
                      <p className="text-[10px] text-gray-400">@{c.source_user.username}</p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400">—</p>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <p className="text-xs font-semibold text-[#0D1B3E]">{fmt(Number(c.amount))}</p>
                  {c.cascade_remainder != null && Number(c.cascade_remainder) > 0 && (
                    <p className="text-[10px] text-gray-400">
                      remainder: {fmt(Number(c.cascade_remainder))}
                    </p>
                  )}
                </div>

                {/* Points */}
                <p className="text-xs font-medium" style={{ color: c.points ? '#1a7a4a' : '#d1d5db' }}>
                  {c.points ? `+${c.points} pts` : '—'}
                </p>

                {/* Date */}
                <p className="text-xs text-gray-400">
                  {new Date(c.created_at).toLocaleDateString('en-PH', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </p>
              </div>
            )
          })
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>
    </div>
  )
}