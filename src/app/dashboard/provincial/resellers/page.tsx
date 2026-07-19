'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

interface Reseller {
  id:        string
  full_name: string
  username:  string
  mobile:    string | null
  address:   string | null
  status:    string
  created_at: string
  reseller_profile: {
    package:      { name: string } | null
    total_points: number
  } | null
  wallet:    { balance: number; total_earned: number } | null
  city_dist: { full_name: string; username: string } | null
}

const PAGE_SIZE = 15
const fmt = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`

export default function ProvincialResellersPage() {
  const [resellers, setResellers]       = useState<Reseller[]>([])
  const [meta, setMeta]                 = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]           = useState(true)
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState('')
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [summary, setSummary]           = useState({ total: 0, active: 0, inactive: 0 })

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [search, statusFilter])

  const fetchResellers = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status: statusFilter, search })
    fetch(`/api/provincial/resellers?${params}`)
      .then(r => r.json())
      .then(d => {
        setResellers(d.resellers || [])
        setMeta(d.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        setSummary(d.summary || { total: 0, active: 0, inactive: 0 })
      })
      .finally(() => setLoading(false))
  }, [page, search, statusFilter])

  useEffect(() => { fetchResellers() }, [fetchResellers])

  return (
    <div className="w-full space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#0D1B3E]">Resellers</h1>
        <p className="text-sm text-gray-400 mt-0.5">All resellers registered under your province</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Total Resellers', value: summary.total,    color: '#0D1B3E', icon: '👥' },
          { label: 'Active',          value: summary.active,   color: '#1a7a4a', icon: '✅' },
          { label: 'Inactive',        value: summary.inactive, color: '#e05252', icon: '⚠️' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:shadow-sm transition-all"
            style={{ borderTop: `2px solid ${s.color}` }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide">{s.label}</p>
              <span className="text-lg">{s.icon}</span>
            </div>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
        {/* Search + filters */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <div className="flex items-center gap-2 flex-1 bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-xl px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-300">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by name, username or mobile..."
              className="flex-1 bg-transparent text-sm text-[#0D1B3E] outline-none placeholder:text-gray-300" />
            {searchInput && (
              <button onClick={() => setSearchInput('')} className="text-gray-300 hover:text-gray-500">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
          {['all', 'active', 'inactive'].map(f => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${statusFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#f8f9fc] text-gray-400 hover:text-[#0D1B3E]'}`}>
              {f}
            </button>
          ))}
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-6 px-4 py-2.5 bg-[#f8f9fc] border-b border-[#0D1B3E]/8">
          {['Reseller', 'Package', 'City Distributor', 'Address', 'Total Earned', 'Status'].map(h => (
            <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{h}</p>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col items-center py-16">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : resellers.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <span className="text-4xl mb-3">👥</span>
            <p className="text-gray-400 text-sm">No resellers found in your province</p>
          </div>
        ) : resellers.map(r => (
          <div key={r.id} className="grid grid-cols-6 px-4 py-3.5 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors items-center">
            {/* Reseller */}
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[#0D1B3E] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {r.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#0D1B3E] truncate">{r.full_name}</p>
                <p className="text-[10px] text-gray-400">@{r.username}</p>
                {r.mobile && <p className="text-[9px] text-gray-300">{r.mobile}</p>}
              </div>
            </div>
            {/* Package */}
            <span className="text-[10px] bg-[#fef6e4] text-[#9a6f1e] px-2 py-0.5 rounded-full font-medium w-fit">
              {r.reseller_profile?.package?.name || '—'}
            </span>
            {/* City Dist */}
            <div className="min-w-0">
              <p className="text-xs text-gray-600 truncate">{r.city_dist?.full_name || '—'}</p>
              {r.city_dist && <p className="text-[9px] text-gray-400">@{r.city_dist.username}</p>}
            </div>
            {/* Address */}
            <p className="text-xs text-gray-500 truncate">{r.address || '—'}</p>
            {/* Total Earned */}
            <div>
              <p className="text-xs font-semibold text-[#1a7a4a]">{fmt(r.wallet?.total_earned || 0)}</p>
              <p className="text-[9px] text-gray-400">Bal: {fmt(r.wallet?.balance || 0)}</p>
            </div>
            {/* Status */}
            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold w-fit ${r.status === 'active' ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#fdecea] text-[#a03030]'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${r.status === 'active' ? 'bg-[#1a7a4a]' : 'bg-[#a03030]'}`} />
              {r.status === 'active' ? 'Active' : 'Inactive'}
            </span>
          </div>
        ))}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>
    </div>
  )
}