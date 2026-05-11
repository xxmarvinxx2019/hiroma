'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface DownlineNode {
  id: string
  position: string | null
  is_overflow: boolean
  created_at: string
  user: {
    full_name: string
    username: string
    mobile: string
    status: string
    reseller_profile: {
      total_points: number
      package: { name: string } | null
    } | null
  }
  sponsor: { full_name: string; username: string } | null
  parent:  { user: { full_name: string; username: string } } | null
}

interface Summary {
  total: number
  left:  number
  right: number
}

const PAGE_SIZE = 15

// ============================================================
// PAGE
// ============================================================

export default function ResellerGenealogyPage() {
  const [downline, setDownline]   = useState<DownlineNode[]>([])
  const [summary, setSummary]     = useState<Summary>({ total: 0, left: 0, right: 0 })
  const [meta, setMeta]           = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]     = useState(true)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]           = useState('')
  const [position, setPosition]       = useState('all')
  const [page, setPage]               = useState(1)
  const [expandedId, setExpandedId]   = useState<string | null>(null)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [position, search])

  const fetchDownline = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      position, page: String(page), pageSize: String(PAGE_SIZE),
      ...(search && { search }),
    })
    fetch(`/api/reseller/genealogy?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setDownline(data.downline || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (data.summary) setSummary(data.summary)
      })
      .finally(() => setLoading(false))
  }, [position, page, search])

  useEffect(() => { fetchDownline() }, [fetchDownline])

  return (
    <div className="max-w-6xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Genealogy / Downline</h1>
        <p className="text-sm text-gray-400 mt-0.5">All resellers in your network</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Downline', value: summary.total, accent: '#0D1B3E' },
          { label: 'Left Leg',       value: summary.left,  accent: '#2563eb' },
          { label: 'Right Leg',      value: summary.right, accent: '#9a6f1e' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name or username..."
            className="flex-1 min-w-[200px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1">
            {(['all', 'left', 'right'] as const).map((f) => (
              <button key={f} onClick={() => setPosition(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  position === f
                    ? f === 'left'  ? 'bg-[#2563eb] text-white'
                    : f === 'right' ? 'bg-[#9a6f1e] text-white'
                    : 'bg-[#0D1B3E] text-white'
                    : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}>{f === 'all' ? 'All' : `${f.charAt(0).toUpperCase() + f.slice(1)} Leg`}</button>
            ))}
          </div>
        </div>

        {/* Header */}
        <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
          {['Reseller', 'Package', 'Leg', 'Points', 'Joined'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : downline.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">
              {summary.total === 0 ? 'No downline yet.' : 'No results found.'}
            </p>
          </div>
        ) : (
          downline.map((node) => (
            <div key={node.id}>
              <div
                className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center cursor-pointer"
                onClick={() => setExpandedId(expandedId === node.id ? null : node.id)}
              >
                {/* Reseller */}
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-[#0D1B3E]/8 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-[#0D1B3E]">
                      {node.user.full_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[#0D1B3E]">{node.user.full_name}</p>
                    <p className="text-[10px] text-gray-400">@{node.user.username}</p>
                  </div>
                </div>

                {/* Package */}
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#eef0f8] text-[#0D1B3E] w-fit">
                  {node.user.reseller_profile?.package?.name || '—'}
                </span>

                {/* Leg / position */}
                <span className={`text-xs px-2 py-0.5 rounded-full w-fit capitalize ${
                  node.position === 'left'
                    ? 'bg-[#f0f7ff] text-[#2563eb]'
                    : node.position === 'right'
                    ? 'bg-[#fef9ee] text-[#9a6f1e]'
                    : 'bg-[#F0F2F8] text-gray-400'
                }`}>
                  {node.position || '—'}
                  {node.is_overflow && <span className="ml-1 text-[9px] opacity-70">(overflow)</span>}
                </span>

                {/* Points */}
                <p className="text-xs font-medium text-[#0D1B3E]">
                  {(node.user.reseller_profile?.total_points || 0).toLocaleString()} pts
                </p>

                {/* Joined */}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">
                    {new Date(node.created_at).toLocaleDateString('en-PH')}
                  </p>
                  <span className="text-gray-300 text-xs">{expandedId === node.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded details */}
              {expandedId === node.id && (
                <div className="px-6 py-3 bg-[#F8F9FC] border-b border-[#0D1B3E]/5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                    <div>
                      <p className="text-gray-400 mb-0.5">Mobile</p>
                      <p className="font-medium text-[#0D1B3E]">{node.user.mobile || '—'}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 mb-0.5">Status</p>
                      <span className={`px-2 py-0.5 rounded-full capitalize text-[10px] ${
                        node.user.status === 'active'
                          ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                          : 'bg-[#fdecea] text-[#a03030]'
                      }`}>{node.user.status}</span>
                    </div>
                    <div>
                      <p className="text-gray-400 mb-0.5">Sponsor</p>
                      <p className="font-medium text-[#0D1B3E]">
                        {node.sponsor ? `${node.sponsor.full_name} (@${node.sponsor.username})` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 mb-0.5">Parent Node</p>
                      <p className="font-medium text-[#0D1B3E]">
                        {node.parent ? `${node.parent.user.full_name} (@${node.parent.user.username})` : '—'}
                      </p>
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