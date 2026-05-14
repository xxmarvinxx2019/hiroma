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
  const [cityDists, setCityDists] = useState<CityDist[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'unused' | 'used' | 'expired'>('all')
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page: 1, pageSize: 15, totalPages: 1 })
  const [summary, setSummary] = useState({ total: 0, unused: 0, used: 0, expired: 0 })
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    package_id: '',
    city_dist_id: '',
    quantity: '1',
  })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')
  const [generatedPins, setGeneratedPins] = useState<string[]>([])

  // Fetch packages and city dists once on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/admin/packages').then((r) => r.json()),
      fetch('/api/admin/distributors').then((r) => r.json()),
    ]).then(([packagesData, distsData]) => {
      setPackages(packagesData.packages || [])
      setCityDists((distsData.distributors || []).filter((d: any) => d.distributor_profile?.dist_level === 'city'))
    })
  }, [])

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page), pageSize: '15',
      ...(statusFilter !== 'all' && { status: statusFilter }),
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
  }, [page, statusFilter, search])

  useEffect(() => { fetchData() }, [fetchData])

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
          { label: 'Expired',    value: summary.expired, accent: '#e05252' },
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
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">

        {/* Search & Filter */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by PIN code or username..."
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
          {['PIN code', 'Package', 'City distributor', 'Used by', 'Status'].map((h) => (
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
              className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center"
            >
              <p className="text-xs font-mono font-medium text-[#0D1B3E]">
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
            </div>
          ))
        )}
        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* Generate PIN Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="bg-[#0D1B3E] px-6 py-4 flex items-center justify-between">
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

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  City distributor <span className="text-[#C9A84C]">*</span>
                </label>
                <select
                  value={form.city_dist_id}
                  onChange={(e) => setForm({ ...form, city_dist_id: e.target.value })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                >
                  <option value="">Select city distributor</option>
                  {cityDists.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.full_name} (@{d.username})
                    </option>
                  ))}
                </select>
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
                  {formLoading ? 'Generating...' : 'Generate PINs'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}