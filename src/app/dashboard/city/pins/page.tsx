'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface Pin {
  id: string
  pin_code: string
  status: string
  created_at: string
  used_at: string | null
  package: { name: string; price: number } | null
  used_by_user: {
    full_name: string
    username: string
  } | null
}

const PAGE_SIZE = 15

// ============================================================
// PAGE
// ============================================================

export default function CityPinsPage() {
  const [pins, setPins] = useState<Pin[]>([])
  const [meta, setMeta] = useState<PaginationMeta>({
    total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1,
  })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'unused' | 'used' | 'expired'>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Summary counts
  const [summary, setSummary] = useState({
    total: 0,
    unused: 0,
    used: 0,
    expired: 0,
  })

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

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Reset page on filter/search change
  useEffect(() => { setPage(1) }, [statusFilter, search])

  const fetchPins = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      status: statusFilter,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...(search && { search }),
    })
    fetch(`/api/city/pins?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setPins(data.pins || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (data.summary) setSummary(data.summary)
      })
      .finally(() => setLoading(false))
  }, [statusFilter, page, search])

  useEffect(() => { fetchPins() }, [fetchPins])

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">My PINs</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          PINs assigned to your account by admin
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total PINs', value: summary.total, accent: 'navy' },
          { label: 'Unused', value: summary.unused, accent: 'gold' },
          { label: 'Used', value: summary.used, accent: 'navy' },
          { label: 'Expired', value: summary.expired, accent: 'navy' },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent === 'gold' ? '#C9A84C' : '#0D1B3E'}` }}
          >
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p
              className="text-2xl font-semibold"
              style={{ color: s.accent === 'gold' ? '#C9A84C' : '#0D1B3E' }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Info Banner */}
      {summary.unused === 0 && (
        <div className="bg-[#fef9ee] border border-[#C9A84C]/30 rounded-xl p-4 mb-6">
          <p className="text-xs font-medium text-[#9a6f1e] mb-1">⚠️ No unused PINs available</p>
          <p className="text-xs text-gray-400">
            You have no unused PINs. Please contact admin to purchase more PINs for reseller registrations.
          </p>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Search & Filter */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by PIN code or reseller username..."
            className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1">
            {(['all', 'unused', 'used', 'expired'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  statusFilter === f
                    ? 'bg-[#0D1B3E] text-white'
                    : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
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
          <div className="px-4 py-12 text-center text-gray-400 text-sm">
            No PINs found
          </div>
        ) : (
          pins.map((pin) => (
            <div
              key={pin.id}
              className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center"
            >
              {/* PIN Code */}
              <div className="flex items-center gap-2">
                <p className="text-xs font-mono font-medium text-[#0D1B3E] tracking-wide">
                  {pin.pin_code}
                </p>
                {pin.status === 'unused' && (
                  <button
                    onClick={() => handleCopy(pin.pin_code, pin.id)}
                    title="Copy PIN"
                    className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full transition-all ${
                      copiedId === pin.id
                        ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                        : 'bg-[#F0F2F8] text-gray-400 hover:bg-[#0D1B3E] hover:text-white'
                    }`}
                  >
                    {copiedId === pin.id ? '✓ Copied' : 'Copy'}
                  </button>
                )}
              </div>

              {/* Package */}
              <div>
                <span className="text-xs bg-[#fef6e4] text-[#9a6f1e] px-2 py-0.5 rounded-full">
                  {pin.package?.name || '—'}
                </span>
                {pin.package?.price && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    ₱{Number(pin.package.price).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Status */}
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  pin.status === 'unused'
                    ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                    : pin.status === 'used'
                    ? 'bg-[#eef0f8] text-[#0D1B3E]'
                    : 'bg-[#fdecea] text-[#a03030]'
                }`}>
                  {pin.status}
                </span>
              </span>

              {/* Used by */}
              <div>
                {pin.used_by_user ? (
                  <>
                    <p className="text-xs font-medium text-[#0D1B3E]">
                      {pin.used_by_user.full_name}
                    </p>
                    <p className="text-xs text-gray-400">
                      @{pin.used_by_user.username}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-gray-400">—</p>
                )}
              </div>

              {/* Date */}
              <div>
                {pin.status === 'used' && pin.used_at ? (
                  <>
                    <p className="text-xs text-gray-400">Used on</p>
                    <p className="text-xs font-medium text-[#0D1B3E]">
                      {new Date(pin.used_at).toLocaleDateString('en-PH')}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-gray-400">Assigned on</p>
                    <p className="text-xs font-medium text-[#0D1B3E]">
                      {new Date(pin.created_at).toLocaleDateString('en-PH')}
                    </p>
                  </>
                )}
              </div>
            </div>
          ))
        )}

        {/* Pagination */}
        <Pagination meta={meta} onPageChange={setPage} />
      </div>

    </div>
  )
}