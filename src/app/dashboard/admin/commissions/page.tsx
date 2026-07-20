'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

interface Commission {
  id:          string
  type:        string
  amount:      number
  points:      number | null
  created_at:  string
  is_pair_overflow: boolean
  user:        { full_name: string; username: string }
  source_user: { full_name: string; username: string } | null
}

// sponsor_point in DB = Product Binary in UI
// multilevel is removed from display
const TYPE_LABELS: Record<string, string> = {
  direct_referral: 'Direct Referral',
  binary_pairing:  'Binary Pairing',
  sponsor_point:   'Product Binary',
}

const TYPE_COLORS: Record<string, string> = {
  direct_referral: '#C9A84C',
  binary_pairing:  '#2563eb',
  sponsor_point:   '#1a7a4a',
}

const TYPE_ICONS: Record<string, string> = {
  direct_referral: '🤝',
  binary_pairing:  '🌳',
  sponsor_point:   '📦',
}

const fmt = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtS = (n: number) => {
  if (n >= 1000000) return `₱${(n/1000000).toFixed(2)}M`
  if (n >= 1000)    return `₱${(n/1000).toFixed(1)}K`
  return fmt(n)
}

const PAGE_SIZE = 20

export default function AdminCommissionsPage() {
  const [commissions, setCommissions]   = useState<Commission[]>([])
  const [meta, setMeta]                 = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]           = useState(true)
  const [page, setPage]                 = useState(1)
  const [typeFilter, setTypeFilter]     = useState('all')
  const [searchInput, setSearchInput]   = useState('')
  const [search, setSearch]             = useState('')
  const [summary, setSummary]           = useState<{
    total_records:      number
    total_amount:       number
    total_points:       number
    overflow_to_hiroma: number
    direct_referral:    { amount: number; count: number }
    binary_pairing:     { amount: number; count: number }
    sponsor_point:      { amount: number; count: number }
  }>({
    total_records:       0,
    total_amount:        0,
    total_points:        0,
    overflow_to_hiroma:  0,
    direct_referral:     { amount: 0, count: 0 },
    binary_pairing:      { amount: 0, count: 0 },
    sponsor_point:       { amount: 0, count: 0 },
  })

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [search, typeFilter])

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), type: typeFilter, search })
    fetch(`/api/admin/commissions?${params}`)
      .then(r => r.json())
      .then(d => {
        setCommissions(d.commissions || [])
        setMeta(d.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        const s = d.summary || {}
        setSummary({
          total_records:      Number(s.total_records      ?? s.totalRecords      ?? d.meta?.total ?? 0),
          total_amount:       Number(s.total_amount       ?? s.totalAmount       ?? 0),
          total_points:       Number(s.total_points       ?? s.totalPoints       ?? 0),
          overflow_to_hiroma: Number(s.overflow_to_hiroma ?? s.overflowToHiroma  ?? 0),
          direct_referral:    s.direct_referral    || { amount: 0, count: 0 },
          binary_pairing:     s.binary_pairing     || { amount: 0, count: 0 },
          sponsor_point:      s.sponsor_point      || { amount: 0, count: 0 },
        })
      })
      .finally(() => setLoading(false))
  }, [page, search, typeFilter])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="w-full space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#0D1B3E]">Commissions</h1>
        <p className="text-sm text-gray-400 mt-0.5">Full history of all earnings across the network</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Records',       value: (summary.total_records || 0).toLocaleString(), color: '#0D1B3E', icon: '📋', sub: 'All commission entries' },
          { label: 'Total Amount Paid',   value: fmtS(summary.total_amount || 0),             color: '#C9A84C', icon: '💰', sub: 'Across all types' },
          { label: 'Total Points Earned', value: (summary.total_points || 0).toLocaleString(),  color: '#2563eb', icon: '⭐', sub: 'Binary + Product points' },
          { label: 'Overflow to Hiroma',  value: (summary.overflow_to_hiroma || 0).toLocaleString(), color: '#e05252', icon: '🔄', sub: 'Capped pair overflow', badge: summary.overflow_to_hiroma > 0 ? 'Overflow' : undefined },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:shadow-sm transition-all"
            style={{ borderTop: `2px solid ${s.color}` }}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: s.color + '15' }}>{s.icon}</div>
              {s.badge && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: s.color + '15', color: s.color }}>{s.badge}</span>}
            </div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Type breakdown cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { key: 'direct_referral', label: 'Direct Referral', icon: '🤝', color: '#C9A84C' },
          { key: 'binary_pairing',  label: 'Binary Pairing',  icon: '🌳', color: '#2563eb' },
          { key: 'sponsor_point',   label: 'Product Binary',  icon: '📦', color: '#1a7a4a' },
        ].map(t => {
          const data = summary[t.key as keyof typeof summary] as { amount: number; count: number }
          return (
            <div key={t.key} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:shadow-sm transition-all cursor-pointer"
              style={{ borderTop: `2px solid ${t.color}` }}
              onClick={() => setTypeFilter(typeFilter === t.key ? 'all' : t.key)}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: t.color + '15' }}>{t.icon}</div>
                  <p className="text-sm font-bold text-[#0D1B3E]">{t.label}</p>
                </div>
                {typeFilter === t.key && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: t.color + '15', color: t.color }}>Filtered</span>}
              </div>
              <p className="text-xl font-bold" style={{ color: t.color }}>{fmtS(data?.amount || 0)}</p>
              <p className="text-[10px] text-gray-400 mt-1">{(data?.count || 0).toLocaleString()} transactions</p>
            </div>
          )
        })}
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[#0D1B3E]/8">
          <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-xl px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-300 flex-shrink-0">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by reseller name or username..."
              className="flex-1 bg-transparent text-sm text-[#0D1B3E] outline-none placeholder:text-gray-300" />
            {searchInput && (
              <button onClick={() => setSearchInput('')} className="text-gray-300 hover:text-gray-500">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
          <div className="flex gap-1">
            {[
              { key: 'all',            label: 'All'            },
              { key: 'direct_referral', label: '🤝 Direct'     },
              { key: 'binary_pairing',  label: '🌳 Binary'     },
              { key: 'sponsor_point',   label: '📦 Product Binary' },
            ].map(f => (
              <button key={f.key} onClick={() => setTypeFilter(f.key)}
                className={`text-xs px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${typeFilter === f.key ? 'bg-[#0D1B3E] text-white' : 'bg-[#f8f9fc] text-gray-400 hover:text-[#0D1B3E]'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-6 px-5 py-2.5 bg-[#f8f9fc] border-b border-[#0D1B3E]/8">
          {['Reseller', 'Type', 'Amount', 'Points', 'Triggered By', 'Date'].map(h => (
            <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{h}</p>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col items-center py-16">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-gray-400 text-sm">Loading commissions...</p>
          </div>
        ) : commissions.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <span className="text-4xl mb-3">💰</span>
            <p className="text-gray-400 text-sm">No commissions found</p>
          </div>
        ) : commissions.map(c => {
          const color = TYPE_COLORS[c.type] || '#9ca3af'
          const icon  = TYPE_ICONS[c.type]  || '💸'
          const label = TYPE_LABELS[c.type]  || c.type
          return (
            <div key={c.id} className="grid grid-cols-6 px-5 py-3.5 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors items-center">
              {/* Reseller */}
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#0D1B3E] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {c.user.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#0D1B3E] truncate">{c.user.full_name}</p>
                  <p className="text-[10px] text-gray-400">@{c.user.username}</p>
                </div>
              </div>
              {/* Type */}
              <div className="flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style={{ backgroundColor: color + '15' }}>{icon}</div>
                <div>
                  <p className="text-[11px] font-semibold" style={{ color }}>{label}</p>
                  {c.is_pair_overflow && <p className="text-[9px] text-[#e05252]">Overflow</p>}
                </div>
              </div>
              {/* Amount */}
              <p className="text-xs font-bold" style={{ color }}>{fmt(Number(c.amount))}</p>
              {/* Points */}
              <p className="text-xs font-semibold text-gray-500">
                {c.points ? `${Number(c.points).toLocaleString()} pts` : '—'}
              </p>
              {/* Triggered by */}
              <div>
                {c.source_user ? (
                  <>
                    <p className="text-xs font-semibold text-[#0D1B3E] truncate">{c.source_user.full_name}</p>
                    <p className="text-[10px] text-gray-400">@{c.source_user.username}</p>
                  </>
                ) : <p className="text-xs text-gray-300">—</p>}
              </div>
              {/* Date */}
              <p className="text-xs text-gray-400">
                {new Date(c.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          )
        })}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>
    </div>
  )
}