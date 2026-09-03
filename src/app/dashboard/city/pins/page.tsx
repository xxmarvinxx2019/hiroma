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
  cancelled_at: string | null
  cancellation_reason: string | null
  pin_type: 'registration' | 'upgrade'
  upgrade_from_package: { id: string; name: string } | null
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
  const [loadError, setLoadError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Filters
  const [statusFilter,  setStatusFilter]  = useState<'all' | 'in_transit' | 'unused' | 'used' | 'expired' | 'cancelled'>('unused')
  const [packageFilter, setPackageFilter] = useState('')
  const [pinTypeFilter, setPinTypeFilter] = useState<'all' | 'registration' | 'upgrade'>('all')
  const [dateFrom,      setDateFrom]      = useState('')
  const [dateTo,        setDateTo]        = useState('')
  const [searchInput,   setSearchInput]   = useState('')
  const [search,        setSearch]        = useState('')
  const [page,          setPage]          = useState(1)
  const [showFilters,   setShowFilters]   = useState(false)

  const [summary, setSummary] = useState({ total: 0, in_transit: 0, unused: 0, used: 0, expired: 0, cancelled: 0, registration: 0, upgrade: 0 })

  const advancedFilterCount = [packageFilter, dateFrom, dateTo].filter(Boolean).length
  const hasChangedFilters = advancedFilterCount > 0 || pinTypeFilter !== 'all' || statusFilter !== 'unused' || Boolean(search)

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
    setPinTypeFilter('all')
    setDateFrom('')
    setDateTo('')
    setStatusFilter('unused')
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1) }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const fetchPins = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      status:   statusFilter,
      page:     String(page),
      pageSize: String(PAGE_SIZE),
      ...(search        && { search }),
      ...(packageFilter && { package: packageFilter }),
      ...(pinTypeFilter !== 'all' && { pinType: pinTypeFilter }),
      ...(dateFrom      && { dateFrom }),
      ...(dateTo        && { dateTo }),
    })
    fetch(`/api/city/pins?${params}`)
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Unable to load PIN inventory.')
        return data
      })
      .then((data) => {
        setLoadError('')
        setPins(data.pins || [])
        setPackages(data.packages || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (data.summary) setSummary(data.summary)
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : 'Unable to load PIN inventory.')
      })
      .finally(() => setLoading(false))
  }, [statusFilter, packageFilter, pinTypeFilter, dateFrom, dateTo, page, search])

  useEffect(() => {
    const timer = window.setTimeout(fetchPins, 0)
    return () => window.clearTimeout(timer)
  }, [fetchPins])

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">My PINs</h1>
        <p className="text-sm text-gray-400 mt-0.5">PINs assigned to your account by admin</p>
      </div>

      <div className="mb-5 rounded-xl border border-[#0D1B3E]/10 bg-white px-4 py-3 text-xs leading-5 text-gray-600">
        <strong className="text-[#0D1B3E]">Inventory reconciliation:</strong> {summary.registration} registration PIN{summary.registration === 1 ? '' : 's'} + {summary.upgrade} upgrade PIN{summary.upgrade === 1 ? '' : 's'} = {summary.total} total. Amounts use the historical allocation stored when each PIN was issued.
      </div>

      {loadError && (
        <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-bold">PIN inventory could not be loaded</p>
          <p className="mt-1 text-xs">{loadError} The figures below have not been refreshed; your PIN records were not deleted.</p>
          <button type="button" onClick={fetchPins} className="mt-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-800">
            Retry
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {[
          { label: 'Total PINs', value: summary.total, color: '#0D1B3E', icon: '🔑', sub: 'All time' },
          { label: 'Available', value: summary.unused, color: '#9A7219', icon: '🔓', sub: 'Ready to use', badge: summary.unused === 0 ? 'Request more' : undefined },
          { label: 'Used', value: summary.used, color: '#187B4B', icon: '✅', sub: 'Activated by resellers' },
          { label: 'Expired', value: summary.expired, color: '#C23B43', icon: '❌', sub: 'No longer valid' },
          { label: 'Cancelled', value: summary.cancelled, color: '#526176', icon: '🚫', sub: 'Permanently unusable' },
        ].map((s) => (
          <div key={s.label}
            className="min-h-[154px] rounded-xl border border-white/10 p-4 text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            style={{ backgroundColor: s.color }}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg bg-white/15 ring-1 ring-white/10">
                {s.icon}
              </div>
              {s.badge && (
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/15">
                  {s.badge}
                </span>
              )}
            </div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-white/90 [text-shadow:0_1px_1px_rgba(0,0,0,0.2)]">{s.label}</p>
            <p className="text-2xl font-extrabold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.28)]">{s.value}</p>
            <p className="mt-1 text-[11px] font-semibold leading-4 text-white/85 [text-shadow:0_1px_1px_rgba(0,0,0,0.18)]">{s.sub}</p>
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

          {/* Row 1: search + advanced filter toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search PIN, package, status, reseller, or date..."
              className="flex-1 min-w-[200px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />

            {/* Filter toggle button */}
            <button onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                showFilters || advancedFilterCount > 0
                  ? 'bg-[#C9A84C] text-[#0D1B3E] border-[#C9A84C]'
                  : 'bg-[#F0F2F8] text-gray-400 border-[#0D1B3E]/10 hover:text-[#0D1B3E]'
              }`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 3h10M3 6h6M5 9h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Filters
              {advancedFilterCount > 0 && (
                <span className="bg-[#010521] text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                  {advancedFilterCount}
                </span>
              )}
            </button>

            {/* Clear all */}
            {hasChangedFilters && (
              <button onClick={clearFilters}
                className="text-xs text-[#a03030] hover:underline">
                Clear all
              </button>
            )}
          </div>

          <div className="grid overflow-hidden rounded-xl border border-[#0D1B3E]/15 bg-white shadow-md lg:grid-cols-2">
            <fieldset className="min-w-0 bg-[#0D1B3E] p-3.5 lg:pr-5">
              <legend className="sr-only">PIN type</legend>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-sm" aria-hidden="true">🔑</span>
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-white">PIN type</p>
                  <p className="text-[10px] text-white/70">Choose Registration or Upgrade PINs</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-3" aria-label="Filter by PIN type">
                {([
                  { value: 'registration', label: 'Registration', count: summary.registration },
                  { value: 'upgrade', label: 'Upgrade', count: summary.upgrade },
                  { value: 'all', label: 'All types', count: summary.total },
                ] as const).map((item) => (
                  <button key={item.value} type="button" onClick={() => { setPinTypeFilter(item.value); setPage(1) }}
                    aria-pressed={pinTypeFilter === item.value}
                    className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                      pinTypeFilter === item.value
                        ? item.value === 'upgrade' ? 'bg-purple-600 text-white ring-2 ring-white/70' : item.value === 'registration' ? 'bg-[#2E67E8] text-white ring-2 ring-white/70' : 'bg-white text-[#0D1B3E] ring-2 ring-white/70'
                        : 'border border-white/25 bg-white/10 text-white hover:bg-white/20'
                    }`}>
                    {item.label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${pinTypeFilter === item.value && item.value === 'all' ? 'bg-[#0D1B3E]/10 text-[#0D1B3E]' : 'bg-white/20 text-white'}`}>{item.count}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="min-w-0 border-t border-white/20 bg-[#0D1B3E] p-3.5 lg:border-l lg:border-t-0 lg:pl-5">
              <legend className="sr-only">Lifecycle status</legend>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-sm text-white" aria-hidden="true">◷</span>
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-white">Lifecycle status</p>
                  <p className="text-[10px] text-white/70">Choose where the PIN is in its lifecycle</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-6" aria-label="Filter by PIN lifecycle status">
                {([
                  { value: 'in_transit', active: 'bg-[#4338ca] text-white ring-2 ring-white/70 shadow-sm', idle: 'border-white/25 bg-white/90 text-[#4338ca] hover:bg-white' },
                  { value: 'unused', active: 'bg-[#A77C18] text-white ring-2 ring-white/70 shadow-sm', idle: 'border-white/25 bg-white/90 text-[#7A5910] hover:bg-white' },
                  { value: 'used', active: 'bg-[#187B4B] text-white ring-2 ring-white/70 shadow-sm', idle: 'border-white/25 bg-white/90 text-[#12633C] hover:bg-white' },
                  { value: 'expired', active: 'bg-[#C23B43] text-white ring-2 ring-white/70 shadow-sm', idle: 'border-white/25 bg-white/90 text-[#A12F36] hover:bg-white' },
                  { value: 'cancelled', active: 'bg-[#65758A] text-white ring-2 ring-white/70 shadow-sm', idle: 'border-white/25 bg-white/90 text-[#435065] hover:bg-white' },
                  { value: 'all', active: 'bg-[#0D1B3E] text-white ring-2 ring-white/70 shadow-sm', idle: 'border-white/25 bg-white/90 text-[#0D1B3E] hover:bg-white' },
                ] as const).map((item) => (
                  <button key={item.value} type="button" onClick={() => { setStatusFilter(item.value); setPage(1) }}
                    aria-pressed={statusFilter === item.value}
                    className={`min-h-9 rounded-lg border px-2 py-2 text-xs font-bold capitalize transition-colors ${
                      statusFilter === item.value ? item.active : item.idle
                    }`}>{item.value === 'all' ? 'All statuses' : item.value}</button>
                ))}
              </div>
            </fieldset>
          </div>

          <p className="text-[10px] leading-4 text-gray-500">
            PIN type and lifecycle status work together—for example, you can view only unused Upgrade PINs or only used Registration PINs.
          </p>

          {/* Row 2: expanded filters */}
          {showFilters && (
            <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">

              {/* Package filter */}
              <div>
                <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Package</label>
                <select value={packageFilter} onChange={(e) => { setPackageFilter(e.target.value); setPage(1) }}
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
                <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />
              </div>

              {/* Date to */}
              <div>
                <label className="block text-[10px] text-gray-400 uppercase tracking-wide mb-1">Date To</label>
                <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />
              </div>

            </div>
            <p className="text-[10px] leading-4 text-gray-500">Date filtering follows the selected status: Used uses the usage date; Cancelled uses the cancellation date; Available and Expired use the assignment date because legacy PINs have no dedicated expiry timestamp; All checks any recorded lifecycle date.</p>
            </>
          )}

          {/* Active filter chips */}
          {(advancedFilterCount > 0 || pinTypeFilter !== 'all') && (
            <div className="flex items-center gap-2 flex-wrap">
              {packageFilter && (
                <span className="flex items-center gap-1 text-[10px] bg-[#eef0f8] text-[#0D1B3E] px-2 py-1 rounded-full">
                  📦 {packages.find((p) => p.id === packageFilter)?.name || 'Package'}
                  <button onClick={() => setPackageFilter('')} className="hover:text-[#a03030]">✕</button>
                </span>
              )}
              {pinTypeFilter !== 'all' && <span className="flex items-center gap-1 text-[10px] bg-[#eef0f8] text-[#0D1B3E] px-2 py-1 rounded-full">🔑 {pinTypeFilter === 'registration' ? 'Registration PINs' : 'Upgrade PINs'}<button onClick={() => setPinTypeFilter('all')} className="hover:text-[#a03030]">✕</button></span>}
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
        <div className="hidden md:grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
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
            {(advancedFilterCount > 0 || pinTypeFilter !== 'all') && (
              <button onClick={clearFilters} className="text-xs text-[#C9A84C] hover:underline mt-1">Clear filters</button>
            )}
          </div>
        ) : (
          pins.map((pin) => (
            <div key={pin.id} className="border-b border-[#0D1B3E]/5 last:border-b-0">
            <div className="hidden md:grid grid-cols-5 px-4 py-3 hover:bg-[#F0F2F8]/50 transition-colors items-center">

              {/* PIN Code */}
              <div className="flex items-center gap-2 flex-wrap">
                {pin.status === 'unused' && pin.pin_type === 'registration' ? (
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
                          : 'bg-[#F0F2F8] text-gray-400 hover:bg-[#010521] hover:text-white'
                      }`}>
                      {copiedId === pin.id ? '✓ Copied' : 'Copy'}
                    </button>
                    <span className={`text-[9px] ${pin.pin_type === 'registration' ? 'text-[#2563eb]/60' : 'text-[#9a6f1e]'}`}>{pin.pin_type === 'registration' ? '↗ Register' : 'Use in Upgrade Package'}</span>
                  </div>
                )}
              </div>

              {/* Package */}
              <div>
                <span className={`mb-1 inline-flex text-[9px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 ${pin.pin_type === 'registration' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{pin.pin_type}</span>
                <div />
                <span className="text-xs bg-[#fef6e4] text-[#9a6f1e] px-2 py-0.5 rounded-full">
                  {pin.pin_type === 'upgrade' && pin.upgrade_from_package ? `${pin.upgrade_from_package.name} → ` : ''}{pin.package?.name || '—'}
                </span>
                {pin.package?.price && (
                  <p className="text-xs text-gray-400 mt-0.5">₱{Number(pin.package.price).toLocaleString()}</p>
                )}
              </div>

              {/* Status */}
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  pin.status === 'unused'  ? 'bg-[#e8f7ef] text-[#1a7a4a]' :
                  pin.status === 'in_transit' ? 'bg-[#eef2ff] text-[#4338ca]' :
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
                ) : pin.status === 'cancelled' && pin.cancelled_at ? (
                  <><p className="text-xs text-gray-400">Cancelled on</p><p className="text-xs font-medium text-[#0D1B3E]">{new Date(pin.cancelled_at).toLocaleDateString('en-PH')}</p>{pin.cancellation_reason && <p className="mt-0.5 truncate text-[10px] text-[#a03030]" title={pin.cancellation_reason}>{pin.cancellation_reason}</p>}</>
                ) : (
                  <>
                    <p className="text-xs text-gray-400">{pin.status === 'expired' ? 'Assigned on · expiry timestamp unavailable' : 'Assigned on'}</p>
                    <p className="text-xs font-medium text-[#0D1B3E]">{new Date(pin.created_at).toLocaleDateString('en-PH')}</p>
                  </>
                )}
              </div>
            </div>
            <article className="space-y-3 p-4 md:hidden">
              <div className="flex items-start justify-between gap-3"><div><p className="break-all font-mono text-xs font-bold text-[#0D1B3E]">{pin.pin_code}</p><p className="mt-1 text-[10px] text-gray-500">Assigned {new Date(pin.created_at).toLocaleDateString('en-PH')}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${pin.status === 'unused' ? 'bg-green-50 text-green-700' : pin.status === 'in_transit' ? 'bg-indigo-50 text-indigo-700' : pin.status === 'used' ? 'bg-slate-100 text-slate-700' : 'bg-red-50 text-red-700'}`}>{pin.status}</span></div>
              {pin.status === 'in_transit' && <p className="rounded-lg bg-indigo-50 p-2 text-xs text-indigo-700">Internal transfer pending Branch receipt. This PIN cannot be used yet.</p>}
              <div className="grid grid-cols-2 gap-3 text-xs"><div><p className="text-[10px] uppercase text-gray-400">Type</p><p className="mt-1 font-bold capitalize text-[#0D1B3E]">{pin.pin_type}</p></div><div><p className="text-[10px] uppercase text-gray-400">Package / path</p><p className="mt-1 font-bold text-[#0D1B3E]">{pin.pin_type === 'upgrade' && pin.upgrade_from_package ? `${pin.upgrade_from_package.name} → ` : ''}{pin.package?.name || '—'}</p></div><div><p className="text-[10px] uppercase text-gray-400">PIN allocation</p><p className="mt-1 font-bold text-[#9a6f1e]">₱{Number(pin.package?.price || 0).toLocaleString()}</p></div><div><p className="text-[10px] uppercase text-gray-400">Used by</p><p className="mt-1 font-bold text-[#0D1B3E]">{pin.used_by_user?.full_name || '—'}</p></div></div>
              {pin.status === 'cancelled' && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">Cancelled {pin.cancelled_at ? new Date(pin.cancelled_at).toLocaleDateString('en-PH') : 'date unavailable'}{pin.cancellation_reason ? ` · ${pin.cancellation_reason}` : ''}</div>}
              {pin.status === 'expired' && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Expired status recorded; no dedicated expiration timestamp exists for this legacy record.</p>}
              {pin.status === 'unused' && <div className="flex gap-2"><button onClick={() => handleCopy(pin.pin_code, pin.id)} className="flex-1 rounded-lg border px-3 py-2 text-xs font-bold">{copiedId === pin.id ? '✓ Copied' : 'Copy PIN'}</button>{pin.pin_type === 'registration' ? <Link href={`/dashboard/city/resellers/register?pin=${pin.pin_code}`} className="flex-1 rounded-lg bg-[#C9A84C] px-3 py-2 text-center text-xs font-bold text-[#0D1B3E]">Register Reseller</Link> : <span className="flex-1 rounded-lg bg-purple-50 px-3 py-2 text-center text-xs font-bold text-purple-700">Use from Reseller Upgrade</span>}</div>}
            </article>
            </div>
          ))
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>

    </div>
  )
}
