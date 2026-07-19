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
    mobile:    string | null
    email:     string | null
    status:    string
    created_at: string
  }
  children: {
    id: string; is_active: boolean; city_muni_name: string | null
    user: { id: string; full_name: string; username: string; mobile: string | null; status: string }
  }[]
}

interface CityDist {
  id:             string
  city_muni_name: string | null
  is_active:      boolean
  province_name:  string | null
  user: {
    id:        string
    full_name: string
    username:  string
    mobile:    string | null
    status:    string
    created_at: string
  }
  reseller_count: number
}

const PAGE_SIZE = 15

export default function RegionalDistributorsPage() {
  const [tab, setTab] = useState<'provincial' | 'city'>('provincial')

  // Provincial state
  const [distributors, setDistributors]   = useState<Distributor[]>([])
  const [resellerMap, setResellerMap]     = useState<Record<string, number>>({})
  const [meta, setMeta]                   = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]             = useState(true)
  const [page, setPage]                   = useState(1)
  const [searchInput, setSearchInput]     = useState('')
  const [search, setSearch]               = useState('')
  const [statusFilter, setStatusFilter]   = useState('all')
  const [summary, setSummary]             = useState({ total: 0, active: 0, inactive: 0 })
  const [expanded, setExpanded]           = useState<string | null>(null)

  // City state
  const [cityDists, setCityDists]         = useState<CityDist[]>([])
  const [cityMeta, setCityMeta]           = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [cityLoading, setCityLoading]     = useState(false)
  const [cityPage, setCityPage]           = useState(1)
  const [citySearch, setCitySearch]       = useState('')
  const [citySearchInput, setCitySearchInput] = useState('')
  const [cityStatus, setCityStatus]       = useState('all')
  const [citySummary, setCitySummary]     = useState({ total: 0, active: 0, inactive: 0 })

  useEffect(() => { const t = setTimeout(() => setSearch(searchInput), 400); return () => clearTimeout(t) }, [searchInput])
  useEffect(() => { const t = setTimeout(() => setCitySearch(citySearchInput), 400); return () => clearTimeout(t) }, [citySearchInput])
  useEffect(() => { setPage(1) }, [search, statusFilter])
  useEffect(() => { setCityPage(1) }, [citySearch, cityStatus])

  const fetchProvincial = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status: statusFilter, search })
    fetch(`/api/regional/distributors?${params}`)
      .then(r => r.json())
      .then(d => {
        setDistributors(d.distributors || [])
        setResellerMap(d.resellerMap || {})
        setMeta(d.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        setSummary(d.summary || { total: 0, active: 0, inactive: 0 })
      })
      .finally(() => setLoading(false))
  }, [page, search, statusFilter])

  const fetchCity = useCallback(() => {
    setCityLoading(true)
    const params = new URLSearchParams({ page: String(cityPage), pageSize: String(PAGE_SIZE), status: cityStatus, search: citySearch })
    fetch(`/api/regional/city-distributors?${params}`)
      .then(r => r.json())
      .then(d => {
        setCityDists(d.distributors || [])
        setCityMeta(d.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        setCitySummary(d.summary || { total: 0, active: 0, inactive: 0 })
      })
      .finally(() => setCityLoading(false))
  }, [cityPage, citySearch, cityStatus])

  useEffect(() => { fetchProvincial() }, [fetchProvincial])
  useEffect(() => { if (tab === 'city') fetchCity() }, [tab, fetchCity])

  return (
    <div className="w-full space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[#0D1B3E]">Network Distributors</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage provincial and city distributors in your region</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit">
        <button onClick={() => setTab('provincial')}
          className={`text-xs px-4 py-2 rounded-lg font-medium transition-all ${tab === 'provincial' ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
          🏛️ Provincial ({summary.total})
        </button>
        <button onClick={() => setTab('city')}
          className={`text-xs px-4 py-2 rounded-lg font-medium transition-all ${tab === 'city' ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
          🏢 City ({citySummary.total || '...'})
        </button>
      </div>

      {/* ── PROVINCIAL TAB ── */}
      {tab === 'provincial' && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Provincial', value: summary.total,    color: '#0D1B3E' },
              { label: 'Active',           value: summary.active,   color: '#1a7a4a' },
              { label: 'Inactive',         value: summary.inactive, color: '#e05252' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.color}` }}>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
                <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Search + filters */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
              <div className="flex items-center gap-2 flex-1 bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-xl px-3 py-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-300"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                  placeholder="Search by name or username..."
                  className="flex-1 bg-transparent text-sm text-[#0D1B3E] outline-none placeholder:text-gray-300" />
              </div>
              {['all','active','inactive'].map(f => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${statusFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#f8f9fc] text-gray-400 hover:text-[#0D1B3E]'}`}>
                  {f}
                </button>
              ))}
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-5 px-4 py-2.5 bg-[#f8f9fc]">
              {['Provincial Distributor','Coverage','City Dists','Resellers','Status'].map(h => (
                <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{h}</p>
              ))}
            </div>

            {loading ? (
              <div className="px-4 py-12 text-center">
                <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Loading...</p>
              </div>
            ) : distributors.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-gray-400 text-sm">No provincial distributors found</p>
              </div>
            ) : distributors.map(d => (
              <div key={d.id}>
                <div className="grid grid-cols-5 px-4 py-3.5 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors items-center cursor-pointer"
                  onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-[#0D1B3E] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {d.user.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#0D1B3E]">{d.user.full_name}</p>
                      <p className="text-[10px] text-gray-400">@{d.user.username}</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">{d.coverage_area || '—'}</p>
                  <p className="text-xs font-semibold text-[#2563eb]">{d.children.length}</p>
                  <p className="text-xs font-semibold text-[#C9A84C]">
                    {d.children.reduce((s, c) => s + (c.user ? (resellerMap[c.user.id] || 0) : 0), 0)}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${d.is_active && d.user.status === 'active' ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#fdecea] text-[#a03030]'}`}>
                      {d.is_active && d.user.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                    <span className="text-gray-300 text-xs ml-2">{expanded === d.id ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded — city dists */}
                {expanded === d.id && (
                  <div className="px-5 py-4 bg-[#f8f9fc] border-b border-[#0D1B3E]/5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-xs">
                      <div><span className="text-gray-400">Mobile: </span><span className="font-medium text-[#0D1B3E]">{d.user.mobile || '—'}</span></div>
                      <div><span className="text-gray-400">Email: </span><span className="font-medium text-[#0D1B3E]">{d.user.email || '—'}</span></div>
                      <div><span className="text-gray-400">Joined: </span><span className="font-medium text-[#0D1B3E]">{new Date(d.user.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
                    </div>

                    {d.children.length > 0 && (
                      <>
                        <p className="text-xs font-semibold text-[#0D1B3E] mb-2">City Distributors under {d.user.full_name} ({d.children.length})</p>
                        <div className="rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
                          <div className="grid grid-cols-4 px-4 py-2 bg-white">
                            {['Name','City','Resellers','Status'].map(h => (
                              <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{h}</p>
                            ))}
                          </div>
                          {d.children.filter(c => c.user).map(c => (
                            <div key={c.id} className="grid grid-cols-4 px-4 py-2.5 border-t border-[#0D1B3E]/5 hover:bg-white items-center">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-[#C9A84C] flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                                  {c.user.full_name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold text-[#0D1B3E] truncate">{c.user.full_name}</p>
                                  <p className="text-[9px] text-gray-400">@{c.user.username}</p>
                                </div>
                              </div>
                              <p className="text-[11px] text-gray-500">{c.city_muni_name || '—'}</p>
                              <p className="text-[11px] font-semibold text-[#C9A84C]">👥 {resellerMap[c.user.id] || 0}</p>
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold w-fit ${c.is_active && c.user.status === 'active' ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#fdecea] text-[#a03030]'}`}>
                                {c.is_active && c.user.status === 'active' ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {d.children.length === 0 && (
                      <p className="text-xs text-gray-400">No city distributors under this provincial yet.</p>
                    )}
                  </div>
                )}
              </div>
            ))}

            <Pagination meta={meta} onPageChange={setPage} />
          </div>
        </>
      )}

      {/* ── CITY TAB ── */}
      {tab === 'city' && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total City Dists', value: citySummary.total,    color: '#0D1B3E' },
              { label: 'Active',           value: citySummary.active,   color: '#1a7a4a' },
              { label: 'Inactive',         value: citySummary.inactive, color: '#e05252' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.color}` }}>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
                <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Search + filters */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
              <div className="flex items-center gap-2 flex-1 bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-xl px-3 py-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-300"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input value={citySearchInput} onChange={e => setCitySearchInput(e.target.value)}
                  placeholder="Search by name or username..."
                  className="flex-1 bg-transparent text-sm text-[#0D1B3E] outline-none placeholder:text-gray-300" />
              </div>
              {['all','active','inactive'].map(f => (
                <button key={f} onClick={() => setCityStatus(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${cityStatus === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#f8f9fc] text-gray-400 hover:text-[#0D1B3E]'}`}>
                  {f}
                </button>
              ))}
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-5 px-4 py-2.5 bg-[#f8f9fc]">
              {['City Distributor','City','Province','Resellers','Status'].map(h => (
                <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{h}</p>
              ))}
            </div>

            {cityLoading ? (
              <div className="px-4 py-12 text-center">
                <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Loading...</p>
              </div>
            ) : cityDists.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-gray-400 text-sm">No city distributors found</p>
              </div>
            ) : cityDists.map(c => (
              <div key={c.id} className="grid grid-cols-5 px-4 py-3.5 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors items-center">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#C9A84C] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {c.user.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#0D1B3E]">{c.user.full_name}</p>
                    <p className="text-[10px] text-gray-400">@{c.user.username}</p>
                    {c.user.mobile && <p className="text-[9px] text-gray-300">{c.user.mobile}</p>}
                  </div>
                </div>
                <p className="text-xs text-gray-500">{c.city_muni_name || '—'}</p>
                <p className="text-xs text-gray-500">{c.province_name || '—'}</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">👥</span>
                  <p className="text-xs font-semibold text-[#C9A84C]">{c.reseller_count}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold w-fit ${c.is_active && c.user.status === 'active' ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#fdecea] text-[#a03030]'}`}>
                  {c.is_active && c.user.status === 'active' ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}

            <Pagination meta={cityMeta} onPageChange={setCityPage} />
          </div>
        </>
      )}

    </div>
  )
}