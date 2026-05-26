'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from "@/app/components/ui/Pagination"

// ============================================================
// TYPES
// ============================================================

interface Pin {
  id: string
  pin_code: string
  status: string
  created_at: string
  used_at: string | null
  package: { name: string } | null
  city_distributor: { full_name: string; username: string } | null
  used_by_user: { full_name: string; username: string } | null
}

interface Package {
  id: string
  name: string
  price: number
  is_active: boolean
}

interface CityDist {
  id: string
  full_name: string
  username: string
}

// ============================================================
// PAGE
// ============================================================

export default function PinsPage() {
  const [pins, setPins] = useState<Pin[]>([])
  const [packages, setPackages] = useState<Package[]>([])
  const [cityDists, setCityDists]       = useState<CityDist[]>([])
  const [distSearch, setDistSearch]     = useState('')
  const [showDistDrop, setShowDistDrop] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'unused' | 'used' | 'cancelled'>('all')
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page: 1, pageSize: 15, totalPages: 1 })
  const [summary, setSummary] = useState({ total: 0, unused: 0, used: 0, cancelled: 0 })
  const [packageFilter, setPackageFilter] = useState('')
  const [dateFrom, setDateFrom]           = useState('')
  const [dateTo, setDateTo]               = useState('')
  const [showFilters, setShowFilters]     = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    package_id: '',
    city_dist_id: '',
    quantity: '1',
  })
  const [formLoading, setFormLoading]   = useState(false)
  const [selectedIds, setSelectedIds]   = useState<string[]>([])
  const [cancelling, setCancelling]     = useState(false)
  const [cancelSuccess, setCancelSuccess] = useState('')
  const [showConfirm, setShowConfirm]     = useState(false)
  const [cancelError, setCancelError]     = useState('')
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')
  const [generatedPins, setGeneratedPins] = useState<string[]>([])

  // Fetch packages and city dists once on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/admin/packages?pageSize=100&active=true').then((r) => r.json()),
      fetch('/api/admin/distributors?pageSize=200&level=city').then((r) => r.json()),
    ]).then(([packagesData, distsData]) => {
      setPackages(packagesData.packages || [])
      setCityDists((distsData.distributors || []).filter((d: any) => d.distributor_profile?.dist_level === 'city'))
    })
  }, [])

  const handleBulkCancel = () => {
    if (selectedIds.length === 0) return
    setCancelError('')
    setShowConfirm(true)
  }

  const confirmCancel = async () => {
    setCancelling(true)
    setCancelError('')
    const res = await fetch('/api/admin/pins', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin_ids: selectedIds }),
    })
    const data = await res.json()
    setCancelling(false)
    if (res.ok) {
      setShowConfirm(false)
      setCancelSuccess(data.message)
      setSelectedIds([])
      // Re-fetch by changing page state to trigger useEffect
      window.dispatchEvent(new Event('pins-refresh'))
      setTimeout(() => setCancelSuccess(''), 3000)
    } else {
      setCancelError(data.error || 'Failed to cancel PINs.')
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page), pageSize: '15',
      ...(statusFilter !== 'all' && { status: statusFilter }),
      ...(packageFilter && { package: packageFilter }),
      ...(dateFrom && { dateFrom }),
      ...(dateTo   && { dateTo }),
      ...(search && { search }),
    })
    fetch(`/api/admin/pins?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setPins(data.pins || [])
        if (data.meta)    setMeta(data.meta)
        if (data.summary) setSummary(data.summary)
        setLoading(false)
      })
  }, [page, statusFilter, search, packageFilter, dateFrom, dateTo])

  // Reset page to 1 whenever any filter changes
  useEffect(() => { setPage(1) }, [statusFilter, search, packageFilter, dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const handler = () => fetchData()
    window.addEventListener('pins-refresh', handler)
    return () => window.removeEventListener('pins-refresh', handler)
  }, [fetchData])

  const filtered = pins


  const handleGenerate = async () => {
    if (!form.package_id || !form.city_dist_id || !form.quantity) {
      setFormError('All fields are required.')
      return
    }
    const qty = parseInt(form.quantity)
    if (qty < 1 || qty > 50) {
      setFormError('Quantity must be between 1 and 50.')
      return
    }

    setFormLoading(true)
    setFormError('')
    setFormSuccess('')
    setGeneratedPins([])

    const res = await fetch('/api/admin/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package_id: form.package_id,
        city_dist_id: form.city_dist_id,
        quantity: qty,
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      setFormError(data.error || 'Failed to generate PINs.')
    } else {
      setFormSuccess(`${qty} PIN${qty > 1 ? 's' : ''} generated successfully!`)
      setGeneratedPins(data.pins || [])
      fetchData()
    }
    setFormLoading(false)
  }

  const copyAll = () => {
    navigator.clipboard.writeText(generatedPins.join('\n'))
  }

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">PIN Manager</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Generate and track all reseller PINs
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm(true)
            setFormError('')
            setFormSuccess('')
            setGeneratedPins([])
          }}
          className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors"
        >
          + Generate PINs
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total PINs', value: summary.total,   accent: '#0D1B3E' },
          { label: 'Unused',     value: summary.unused,  accent: '#C9A84C' },
          { label: 'Used',       value: summary.used,    accent: '#1a7a4a' },
          { label: 'Cancelled',  value: summary.cancelled, accent: '#e05252' },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent}` }}
          >
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8">

        {/* Search & Filter */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PIN code or username..."
            className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1">
            {(['all', 'unused', 'used', 'cancelled'] as const).map((f) => (
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

        {/* Bulk cancel bar */}
        {selectedIds.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 bg-[#fef9ee] border-b border-[#C9A84C]/20">
            <p className="text-xs text-[#9a6f1e]">{selectedIds.length} PIN(s) selected</p>
            <div className="flex gap-2">
              <button onClick={() => setSelectedIds([])}
                className="text-xs text-gray-400 hover:text-[#0D1B3E] px-2 py-1">
                Clear
              </button>
              <button onClick={handleBulkCancel} disabled={cancelling}
                className="text-xs bg-[#fdecea] text-[#a03030] px-3 py-1.5 rounded-lg hover:bg-[#fcd9d9] disabled:opacity-50 font-medium">
                {cancelling ? 'Cancelling...' : `✕ Cancel ${selectedIds.length} PIN(s)`}
              </button>
            </div>
          </div>
        )}
        {cancelSuccess && (
          <div className="px-4 py-2 bg-[#e8f7ef] text-[#1a7a4a] text-xs border-b border-[#1a7a4a]/10">
            ✓ {cancelSuccess}
          </div>
        )}

        {/* Table Header */}
        <div className="grid px-4 py-2 bg-[#F0F2F8]" style={{ gridTemplateColumns: "32px 2fr 1fr 2fr 2fr 1fr 1fr" }}>
          <div className="flex items-center">
            <input type="checkbox"
              checked={selectedIds.length > 0 && pins.filter((p) => p.status === 'unused').length > 0 && pins.filter((p) => p.status === 'unused').every((p) => selectedIds.includes(p.id))}
              onChange={(e) => {
                const unusedIds = pins.filter((p) => p.status === 'unused').map((p) => p.id)
                setSelectedIds(e.target.checked ? unusedIds : [])
              }}
              className="w-3.5 h-3.5 accent-[#C9A84C]"
            />
          </div>
          {['PIN Code', 'Package', 'City Distributor', 'Used By', 'Status', 'Created'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-gray-400 text-sm">
            No PINs found
          </div>
        ) : (
          filtered.map((pin) => (
            <div
              key={pin.id}
              className="grid px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center" style={{ gridTemplateColumns: "32px 2fr 1fr 2fr 2fr 1fr 1fr" }}
            >
              {/* Col 1: Checkbox */}
              <div className="flex items-center">
                {pin.status === 'unused' && (
                  <input type="checkbox"
                    checked={selectedIds.includes(pin.id)}
                    onChange={() => toggleSelect(pin.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-3.5 h-3.5 accent-[#C9A84C] flex-shrink-0"
                  />
                )}
              </div>
              {/* Col 2: PIN Code */}
              <p className="text-xs font-mono font-medium text-[#0D1B3E] truncate pr-2">
                {pin.pin_code}
              </p>
              <span>
                <span className="text-xs bg-[#fef6e4] text-[#9a6f1e] px-2 py-0.5 rounded-full">
                  {pin.package?.name || '—'}
                </span>
              </span>
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">
                  {pin.city_distributor?.full_name || '—'}
                </p>
                <p className="text-xs text-gray-400">
                  @{pin.city_distributor?.username || '—'}
                </p>
              </div>
              <div>
                {pin.used_by_user ? (
                  <>
                    <p className="text-xs font-medium text-[#0D1B3E]">
                      {pin.used_by_user.full_name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {pin.used_at
                        ? new Date(pin.used_at).toLocaleDateString('en-PH')
                        : ''}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-gray-400">—</p>
                )}
              </div>
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
              {/* Created date */}
              <p className="text-[10px] text-gray-400">
                {new Date(pin.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          ))
        )}
        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* Generate PIN Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[85vh]">
            <div className="bg-[#0D1B3E] px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-white font-semibold text-sm">Generate PINs</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-white/50 hover:text-white text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Package <span className="text-[#C9A84C]">*</span>
                </label>
                <select
                  value={form.package_id}
                  onChange={(e) => setForm({ ...form, package_id: e.target.value })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                >
                  <option value="">Select a package</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — ₱{Number(p.price).toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="relative">
                <label className="block text-xs text-gray-400 mb-1">
                  City distributor <span className="text-[#C9A84C]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={distSearch || (form.city_dist_id ? (cityDists.find((d) => d.id === form.city_dist_id)?.full_name || '') : '')}
                    onChange={(e) => {
                      setDistSearch(e.target.value)
                      setShowDistDrop(true)
                      if (!e.target.value) setForm({ ...form, city_dist_id: '' })
                    }}
                    onFocus={() => setShowDistDrop(true)}
                    onBlur={() => setTimeout(() => setShowDistDrop(false), 150)}
                    placeholder="Search city distributor..."
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C] placeholder:text-gray-400"
                  />
                  {form.city_dist_id && (
                    <button
                      onClick={() => { setForm({ ...form, city_dist_id: '' }); setDistSearch('') }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#0D1B3E] text-xs"
                    >✕</button>
                  )}
                </div>
                {showDistDrop && (
                  <div className="absolute z-[200] w-full bg-white border border-[#0D1B3E]/15 rounded-xl shadow-xl mt-1 max-h-36 overflow-y-auto">
                    {cityDists
                      .filter((d) =>
                        !distSearch ||
                        d.full_name.toLowerCase().includes(distSearch.toLowerCase()) ||
                        d.username.toLowerCase().includes(distSearch.toLowerCase())
                      )
                      .map((d) => (
                        <div
                          key={d.id}
                          onMouseDown={() => {
                            setForm({ ...form, city_dist_id: d.id })
                            setDistSearch('')
                            setShowDistDrop(false)
                          }}
                          className={`px-3 py-2.5 cursor-pointer hover:bg-[#F0F2F8] transition-colors ${
                            form.city_dist_id === d.id ? 'bg-[#F0F2F8]' : ''
                          }`}
                        >
                          <p className="text-xs font-medium text-[#0D1B3E]">{d.full_name}</p>
                          <p className="text-[10px] text-gray-400">@{d.username}</p>
                        </div>
                      ))
                    }
                    {cityDists.filter((d) =>
                      !distSearch ||
                      d.full_name.toLowerCase().includes(distSearch.toLowerCase()) ||
                      d.username.toLowerCase().includes(distSearch.toLowerCase())
                    ).length === 0 && (
                      <p className="text-xs text-gray-400 px-3 py-3 text-center">No distributor found</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Quantity (max 50) <span className="text-[#C9A84C]">*</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                />
              </div>

              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <p className="text-red-500 text-xs">{formError}</p>
                </div>
              )}

              {formSuccess && (
                <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-3 py-2">
                  <p className="text-[#1a7a4a] text-xs font-medium">{formSuccess}</p>
                </div>
              )}

              {/* Generated PINs display */}
              {generatedPins.length > 0 && (
                <div className="bg-[#F0F2F8] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-[#0D1B3E]">Generated PINs</p>
                    <button
                      onClick={copyAll}
                      className="text-xs text-[#C9A84C] hover:underline font-medium"
                    >
                      Copy all
                    </button>
                  </div>
                  <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                    {generatedPins.map((pin) => (
                      <p key={pin} className="text-xs font-mono text-[#0D1B3E] bg-white rounded px-2 py-1 border border-[#0D1B3E]/10">
                        {pin}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={formLoading}
                  className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] transition-colors disabled:opacity-60"
                >
                  {formLoading ? '⏳ Generating...' : 'Generate PINs'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel Confirmation Modal ── */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <h2 className="text-sm font-semibold text-[#0D1B3E]">Cancel PIN{selectedIds.length > 1 ? 's' : ''}</h2>
              <p className="text-xs text-gray-400 mt-0.5">This action cannot be undone</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-start gap-3 bg-[#fdecea] rounded-xl p-3">
                <span className="text-lg">⚠️</span>
                <p className="text-xs text-[#a03030]">
                  You are about to cancel <span className="font-semibold">{selectedIds.length} PIN{selectedIds.length > 1 ? 's' : ''}</span>.
                  Cancelled PINs cannot be used for reseller registration.
                </p>
              </div>
              {cancelError && (
                <p className="text-xs text-[#a03030] bg-[#fdecea] px-3 py-2 rounded-lg">{cancelError}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setShowConfirm(false); setCancelError('') }}
                  disabled={cancelling}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors disabled:opacity-50"
                >
                  Keep PINs
                </button>
                <button
                  onClick={confirmCancel}
                  disabled={cancelling}
                  className="flex-1 bg-[#fdecea] text-[#a03030] text-sm rounded-lg py-2.5 hover:bg-[#fcd9d9] transition-colors disabled:opacity-50 font-medium"
                >
                  {cancelling ? 'Cancelling...' : `✕ Cancel ${selectedIds.length} PIN${selectedIds.length > 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}