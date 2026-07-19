'use client'

import Link from 'next/link'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

interface Pin {
  id: string
  pin_code: string
  status: string
  created_at: string
  used_at: string | null
  package: { name: string; price: number } | null
  used_by_user: { full_name: string; username: string } | null
}

interface Package {
  id:   string
  name: string
}

const PAGE_SIZE = 15

export default function CityPinsPage() {
  const [pins, setPins]       = useState<Pin[]>([])
  const [packages, setPackages] = useState<Package[]>([])
  const [meta, setMeta]       = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Filters
  const [statusFilter,  setStatusFilter]  = useState<'all' | 'unused' | 'used' | 'expired'>('all')
  const [packageFilter, setPackageFilter] = useState('')
  const [dateFrom,      setDateFrom]      = useState('')
  const [dateTo,        setDateTo]        = useState('')
  const [searchInput,   setSearchInput]   = useState('')
  const [search,        setSearch]        = useState('')
  const [page,          setPage]          = useState(1)
  const [showFilters,   setShowFilters]   = useState(false)

  const [summary, setSummary] = useState({ total: 0, unused: 0, used: 0, expired: 0 })

  const activeFilterCount = [packageFilter, dateFrom, dateTo].filter(Boolean).length

  const handleCopy = async (pinCode: string, pinId: string) => {
    try {
      await navigator.clipboard.writeText(pinCode)
    } catch {
      const el = document.createElement('textarea')
      el.value = pinCode
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopiedId(pinId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const clearFilters = () => {
    setPackageFilter('')
    setDateFrom('')
    setDateTo('')
    setStatusFilter('all')
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [statusFilter, packageFilter, dateFrom, dateTo, search])

  const fetchPins = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      status:   statusFilter,
      page:     String(page),
      pageSize: String(PAGE_SIZE),
      ...(search        && { search }),
      ...(packageFilter && { package: packageFilter }),
      ...(dateFrom      && { dateFrom }),
      ...(dateTo        && { dateTo }),
    })
    fetch(`/api/city/pins?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setPins(data.pins || [])
        setPackages(data.packages || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (data.summary) setSummary(data.summary)
      })
      .finally(() => setLoading(false))
  }, [statusFilter, packageFilter, dateFrom, dateTo, page, search])

  useEffect(() => { fetchPins() }, [fetchPins])

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">My PINs</h1>
        <p className="text-sm text-gray-400 mt-0.5">PINs assigned to your account by admin</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total PINs', value: summary.total,   accent: '#0D1B3E' },
          { label: 'Unused',     value: summary.unused,  accent: '#C9A84C' },
          { label: 'Used',       value: summary.used,    accent: '#0D1B3E' },
          { label: 'Expired',    value: summary.expired, accent: '#e05252' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* No unused PINs warning */}
      {summary.unused === 0 && (
        <div className="bg-[#fef9ee] border border-[#C9A84C]/30 rounded-xl p-4 mb-6">
          <p className="text-xs font-medium text-[#9a6f1e] mb-1">⚠️ No unused PINs available</p>
          <p className="text-xs text-gray-400">Please contact admin to purchase more PINs for reseller registrations.</p>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Search + Filter bar */}
        <div className="px-4 py-3 border-b border-[#0D1B3E]/8 space-y-3">

          {/* Row 1: search + status + filter toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by PIN code or reseller..."
              className="flex-1 min-w-[200px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />

            {/* Status filters */}
            <div className="flex gap-1">
              {(['all', 'unused', 'used', 'expired'] as const).map((f) => (
                <button key={f} onClick={() => setStatusFilter(f)}
                  className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                    statusFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                  }`}>{f}</button>
              ))}
            </div>

            {/* Filter toggle button */}
            <button onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                showFilters || activeFilterCount > 0
                  ? 'bg-[#C9A84C] text-[#0D1B3E] border-[#C9A84C]'
                  : 'bg-[#F0F2F8] text-gray-400 border-[#0D1B3E]/10 hover:text-[#0D1B3E]'
              }`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 3h10M3 6h6M5 9h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="bg-[#0D1B3E] text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Clear all */}
            {(activeFilterCount > 0 || search || statusFilter !== 'all') && (
              <button onClick={clearFilters}
                className="text-xs text-[#a03030] hover:underline">
                Clear all
              </button>
            )}
          </div>

          {/* Row 2: expanded filters */}
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">

              {/* Package filter */}
              <div>
                <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Package</label>
                <select value={packageFilter} onChange={(e) => setPackageFilter(e.target.value)}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
                  <option value="">All packages</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* Date from */}
              <div>
                <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Date From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />
              </div>

              {/* Date to */}
              <div>
                <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Date To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />
              </div>

            </div>
          )}

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {packageFilter && (
                <span className="flex items-center gap-1 text-[10px] bg-[#eef0f8] text-[#0D1B3E] px-2 py-1 rounded-full">
                  📦 {packages.find((p) => p.id === packageFilter)?.name || 'Package'}
                  <button onClick={() => setPackageFilter('')} className="hover:text-[#a03030]">✕</button>
                </span>
              )}
              {dateFrom && (
                <span className="flex items-center gap-1 text-[10px] bg-[#eef0f8] text-[#0D1B3E] px-2 py-1 rounded-full">
                  📅 From: {new Date(dateFrom).toLocaleDateString('en-PH')}
                  <button onClick={() => setDateFrom('')} className="hover:text-[#a03030]">✕</button>
                </span>
              )}
              {dateTo && (
                <span className="flex items-center gap-1 text-[10px] bg-[#eef0f8] text-[#0D1B3E] px-2 py-1 rounded-full">
                  📅 To: {new Date(dateTo).toLocaleDateString('en-PH')}
                  <button onClick={() => setDateTo('')} className="hover:text-[#a03030]">✕</button>
                </span>
              )}
            </div>
          )}

        </div>

        {/* Table Header */}
        <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
          {['PIN code', 'Package', 'Status', 'Used by', 'Date'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : pins.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No PINs found</p>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-[#C9A84C] hover:underline mt-1">Clear filters</button>
            )}
          </div>
        ) : (
          pins.map((pin) => (
            <div key={pin.id}
              className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center">

              {/* PIN Code */}
              <div className="flex items-center gap-2 flex-wrap">
                {pin.status === 'unused' ? (
                  <Link href={`/dashboard/city/resellers/register?pin=${pin.pin_code}`}
                    className="text-xs font-mono font-semibold text-[#2563eb] tracking-wide hover:text-[#C9A84C] hover:underline transition-colors"
                    title="Click to register a reseller with this PIN">
                    {pin.pin_code}
                  </Link>
                ) : (
                  <p className="text-xs font-mono font-medium text-gray-400 tracking-wide">{pin.pin_code}</p>
                )}
                {pin.status === 'unused' && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleCopy(pin.pin_code, pin.id)}
                      className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full transition-all ${
                        copiedId === pin.id
                          ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                          : 'bg-[#F0F2F8] text-gray-400 hover:bg-[#0D1B3E] hover:text-white'
                      }`}>
                      {copiedId === pin.id ? '✓ Copied' : 'Copy'}
                    </button>
                    <span className="text-[9px] text-[#2563eb]/50">↗ Register</span>
                  </div>
                )}
              </div>

              {/* Package */}
              <div>
                <span className="text-xs bg-[#fef6e4] text-[#9a6f1e] px-2 py-0.5 rounded-full">
                  {pin.package?.name || '—'}
                </span>
                {pin.package?.price && (
                  <p className="text-xs text-gray-400 mt-0.5">₱{Number(pin.package.price).toLocaleString()}</p>
                )}
              </div>

              {/* Status */}
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  pin.status === 'unused'  ? 'bg-[#e8f7ef] text-[#1a7a4a]' :
                  pin.status === 'used'    ? 'bg-[#eef0f8] text-[#0D1B3E]' :
                                             'bg-[#fdecea] text-[#a03030]'
                }`}>{pin.status}</span>
              </span>

              {/* Used by */}
              <div>
                {pin.used_by_user ? (
                  <>
                    <p className="text-xs font-medium text-[#0D1B3E]">{pin.used_by_user.full_name}</p>
                    <p className="text-xs text-gray-400">@{pin.used_by_user.username}</p>
                  </>
                ) : <p className="text-xs text-gray-400">—</p>}
              </div>

              {/* Date */}
              <div>
                {pin.status === 'used' && pin.used_at ? (
                  <>
                    <p className="text-xs text-gray-400">Used on</p>
                    <p className="text-xs font-medium text-[#0D1B3E]">{new Date(pin.used_at).toLocaleDateString('en-PH')}</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-gray-400">Assigned on</p>
                    <p className="text-xs font-medium text-[#0D1B3E]">{new Date(pin.created_at).toLocaleDateString('en-PH')}</p>
                  </>
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