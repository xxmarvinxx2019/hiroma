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
  user: { full_name: string; username: string }
  source_user: { full_name: string; username: string } | null
}

// ============================================================
// HELPERS
// ============================================================

const typeColors: Record<string, string> = {
  direct_referral: 'bg-[#e8f7ef] text-[#1a7a4a]',
  binary_pairing: 'bg-[#eef0f8] text-[#0D1B3E]',
  multilevel: 'bg-[#fef6e4] text-[#9a6f1e]',
  sponsor_point: 'bg-[#fef9ee] text-[#C9A84C]',
}

const typeLabels: Record<string, string> = {
  direct_referral: 'Direct referral',
  binary_pairing: 'Binary pairing',
  multilevel: 'Multi-level',
  sponsor_point: 'Sponsor point',
}

// ============================================================
// PAGE
// ============================================================

const PAGE_SIZE = 15

export default function CommissionsPage() {
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [meta, setMeta] = useState<PaginationMeta>({
    total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1,
  })
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [summary, setSummary] = useState({
    totalCommissions: 0,
    totalPoints: 0,
    totalAmount: 0,
    totalOverflow: 0,
  })

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Reset page on filter change
  useEffect(() => { setPage(1) }, [typeFilter, search])

  const fetchCommissions = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...(typeFilter !== 'all' && { type: typeFilter }),
      ...(search && { search }),
    })
    fetch(`/api/admin/commissions?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setCommissions(data.commissions || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        setSummary(data.summary || {
          totalCommissions: 0, totalPoints: 0, totalAmount: 0, totalOverflow: 0,
        })
      })
      .finally(() => setLoading(false))
  }, [page, typeFilter, search])

  useEffect(() => { fetchCommissions() }, [fetchCommissions])

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Commissions</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Full history of all earnings across the network
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total records', value: summary.totalCommissions.toLocaleString(), accent: 'navy' },
          { label: 'Total amount paid', value: `₱${Number(summary.totalAmount).toLocaleString()}`, accent: 'gold' },
          { label: 'Total points earned', value: summary.totalPoints.toLocaleString(), accent: 'navy' },
          { label: 'Overflow to Hiroma', value: summary.totalOverflow.toLocaleString(), accent: 'gold' },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent === 'gold' ? '#C9A84C' : '#0D1B3E'}` }}
          >
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-xl font-semibold" style={{ color: s.accent === 'gold' ? '#C9A84C' : '#0D1B3E' }}>
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
            placeholder="Search by reseller name or username..."
            className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1 flex-wrap">
            {(['all', 'direct_referral', 'binary_pairing', 'multilevel', 'sponsor_point']).map((f) => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                  typeFilter === f
                    ? 'bg-[#0D1B3E] text-white'
                    : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}
              >
                {f === 'all' ? 'All' : typeLabels[f]}
              </button>
            ))}
          </div>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-6 px-4 py-2 bg-[#F0F2F8]">
          {['Reseller', 'Type', 'Amount', 'Points', 'Triggered by', 'Date'].map((h) => (
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
          <div className="px-4 py-12 text-center text-gray-400 text-sm">
            No commission records found
          </div>
        ) : (
          commissions.map((c) => (
            <div
              key={c.id}
              className="grid grid-cols-6 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center"
            >
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{c.user.full_name}</p>
                <p className="text-xs text-gray-400">@{c.user.username}</p>
              </div>
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${typeColors[c.type] || 'bg-[#F0F2F8] text-gray-400'}`}>
                  {typeLabels[c.type] || c.type}
                </span>
                {c.is_pair_overflow && (
                  <span className="text-xs text-[#a03030] block mt-0.5">↑ overflow</span>
                )}
              </span>
              <p className="text-xs font-semibold text-[#C9A84C]">
                {Number(c.amount) > 0 ? `₱${Number(c.amount).toLocaleString()}` : '—'}
              </p>
              <p className="text-xs font-medium text-[#0D1B3E]">
                {c.points ? `${c.points} pts` : '—'}
              </p>
              <div>
                {c.source_user ? (
                  <>
                    <p className="text-xs text-[#0D1B3E]">{c.source_user.full_name}</p>
                    <p className="text-xs text-gray-400">@{c.source_user.username}</p>
                  </>
                ) : (
                  <p className="text-xs text-gray-400">—</p>
                )}
              </div>
              <p className="text-xs text-gray-400">
                {new Date(c.created_at).toLocaleDateString('en-PH')}
              </p>
            </div>
          ))
        )}

        {/* Pagination */}
        <Pagination meta={meta} onPageChange={setPage} />
      </div>
    </div>
  )
}