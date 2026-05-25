'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

interface Distributor {
  id:            string
  coverage_area: string
  is_active:     boolean
  user: {
    id:        string
    full_name: string
    username:  string
    mobile:    string
    email:      string | null
    status:     string
    created_at: string
  }
  children: { id: string }[]
}

const PAGE_SIZE = 15



export default function DistributorsPage() {
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [meta, setMeta]     = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [page, setPage]     = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [summary, setSummary] = useState({ total: 0, active: 0, inactive: 0 })
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [search, statusFilter])

  const fetchDistributors = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page:     String(page),
      pageSize: String(PAGE_SIZE),
      status:   statusFilter,
      ...(search && { search }),
    })
    fetch(`/api/provincial/distributors?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setDistributors(d.distributors || [])
        setMeta(d.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (d.summary) setSummary(d.summary)
      })
      .finally(() => setLoading(false))
  }, [page, search, statusFilter])

  useEffect(() => { fetchDistributors() }, [fetchDistributors])

  return (
    <div className="max-w-6xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">My City Distributors</h1>
        <p className="text-sm text-gray-400 mt-0.5">City distributors under your provincial coverage</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total',    value: summary.total,    accent: '#0D1B3E' },
          { label: 'Active',   value: summary.active,   accent: '#1a7a4a' },
          { label: 'Inactive', value: summary.inactive, accent: '#e05252' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#0D1B3E]/8 flex-wrap">
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, username or mobile..."
            className="flex-1 min-w-[200px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />
          <div className="flex gap-1">
            {(['all', 'active', 'inactive'] as const).map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${statusFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'}`}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Header */}
        <div className="grid grid-cols-4 px-4 py-2 bg-[#F0F2F8]">
          {['Distributor', 'Coverage Area', 'City Dists', 'Status'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : distributors.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-gray-400 text-sm">No distributors found.</p>
          </div>
        ) : (
          distributors.map((d) => (
            <div key={d.id}>
              <div className="grid grid-cols-4 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center cursor-pointer"
                onClick={() => setExpanded(expanded === d.id ? null : d.id)}>

                {/* Distributor */}
                <div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{d.user.full_name}</p>
                  <p className="text-xs text-gray-400">@{d.user.username}</p>
                  <p className="text-[10px] text-gray-300">{d.user.mobile}</p>
                </div>

                {/* Coverage area */}
                <p className="text-xs text-gray-500">{d.coverage_area || '—'}</p>

                {/* Children count */}
                <p className="text-xs font-semibold text-[#0D1B3E]">{d.children.length}</p>

                {/* Status */}
                <div className="flex items-center justify-between">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${d.is_active && d.user.status === 'active' ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#fdecea] text-[#a03030]'}`}>
                    {d.is_active && d.user.status === 'active' ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-gray-300 text-xs">{expanded === d.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded details */}
              {expanded === d.id && (
                <div className="px-6 py-4 bg-[#F8F9FC] border-b border-[#0D1B3E]/5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Full Name</p>
                      <p className="text-xs font-medium text-[#0D1B3E]">{d.user.full_name}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Username</p>
                      <p className="text-xs font-medium text-[#0D1B3E]">@{d.user.username}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Mobile</p>
                      <p className="text-xs font-medium text-[#0D1B3E]">{d.user.mobile}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Email</p>
                      <p className="text-xs font-medium text-[#0D1B3E]">{d.user.email || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Coverage Area</p>
                      <p className="text-xs font-medium text-[#0D1B3E]">{d.coverage_area || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Member Since</p>
                      <p className="text-xs font-medium text-[#0D1B3E]">{new Date(d.user.created_at).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                    </div>

                  </div>
                </div>
              )}
            </div>
          ))
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>

    </div>
  )
}