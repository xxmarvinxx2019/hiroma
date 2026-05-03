'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ============================================================
// TYPES
// ============================================================

interface Distributor {
  id: string
  full_name: string
  username: string
  mobile: string
  address: string | null
  status: string
  created_at: string
  distributor_profile: {
    dist_level: string
    coverage_area: string
    is_active: boolean
    contract_signed_at: string | null
  } | null
}

// ============================================================
// HELPERS
// ============================================================

const levelColors: Record<string, string> = {
  regional: 'bg-[#eef0f8] text-[#0D1B3E]',
  provincial: 'bg-[#fef6e4] text-[#9a6f1e]',
  city: 'bg-[#e8f7ef] text-[#1a7a4a]',
}

const levelIcons: Record<string, string> = {
  regional: '🗺️',
  provincial: '🏛️',
  city: '🏙️',
}

// ============================================================
// PAGE
// ============================================================

export default function DistributorsPage() {
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'regional' | 'provincial' | 'city'>('all')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    full_name: '',
    username: '',
    mobile: '',
    password: '',
    address: '',
    dist_level: 'city',
    coverage_area: '',
  })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  const fetchDistributors = () => {
    setLoading(true)
    fetch('/api/admin/distributors')
      .then((r) => r.json())
      .then((data) => setDistributors(data.distributors || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchDistributors() }, [])

  const filtered = distributors.filter((d) => {
    const matchLevel = filter === 'all' || d.distributor_profile?.dist_level === filter
    const matchSearch =
      d.full_name.toLowerCase().includes(search.toLowerCase()) ||
      d.username.toLowerCase().includes(search.toLowerCase()) ||
      d.distributor_profile?.coverage_area.toLowerCase().includes(search.toLowerCase())
    return matchLevel && matchSearch
  })

  const handleFormSubmit = async () => {
    if (!form.full_name || !form.username || !form.mobile || !form.password || !form.coverage_area) {
      setFormError('Please fill in all required fields.')
      return
    }
    setFormLoading(true)
    setFormError('')
    setFormSuccess('')

    const res = await fetch('/api/admin/distributors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()

    if (!res.ok) {
      setFormError(data.error || 'Failed to create distributor.')
    } else {
      setFormSuccess('Distributor registered successfully!')
      setForm({ full_name: '', username: '', mobile: '', password: '', address: '', dist_level: 'city', coverage_area: '' })
      fetchDistributors()
      setTimeout(() => { setShowForm(false); setFormSuccess('') }, 1500)
    }
    setFormLoading(false)
  }

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Distributors</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Manage all regional, provincial and city distributors
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setFormError(''); setFormSuccess('') }}
          className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors"
        >
          + Register distributor
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {(['regional', 'provincial', 'city'] as const).map((level) => {
          const count = distributors.filter(
            (d) => d.distributor_profile?.dist_level === level
          ).length
          return (
            <div
              key={level}
              className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 cursor-pointer hover:border-[#C9A84C]/40 transition-colors"
              onClick={() => setFilter(filter === level ? 'all' : level)}
              style={{ borderTop: filter === level ? '2px solid #C9A84C' : undefined }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span>{levelIcons[level]}</span>
                <span className="text-xs text-gray-400 capitalize">{level}</span>
              </div>
              <p className="text-2xl font-semibold text-[#0D1B3E]">{count}</p>
              <p className="text-xs text-gray-400 mt-0.5">distributors</p>
            </div>
          )
        })}
      </div>

      {/* Search & Filter */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, username or area..."
            className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1">
            {(['all', 'regional', 'provincial', 'city'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  filter === f
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
          {['Distributor', 'Level', 'Coverage area', 'Status', 'Registered'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">
              {h}
            </p>
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
            No distributors found
          </div>
        ) : (
          filtered.map((dist) => (
            <div
              key={dist.id}
              className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center"
            >
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{dist.full_name}</p>
                <p className="text-xs text-gray-400">@{dist.username}</p>
                <p className="text-xs text-gray-400">{dist.mobile}</p>
              </div>
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${levelColors[dist.distributor_profile?.dist_level || 'city']}`}>
                  {levelIcons[dist.distributor_profile?.dist_level || 'city']} {dist.distributor_profile?.dist_level}
                </span>
              </span>
              <p className="text-xs text-gray-500">
                {dist.distributor_profile?.coverage_area || '—'}
              </p>
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  dist.status === 'active'
                    ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                    : 'bg-[#fdecea] text-[#a03030]'
                }`}>
                  {dist.status}
                </span>
              </span>
              <p className="text-xs text-gray-400">
                {new Date(dist.created_at).toLocaleDateString('en-PH')}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Register Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="bg-[#0D1B3E] px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">Register new distributor</h2>
              <button
                onClick={() => setShowForm(false)}
                className="text-white/50 hover:text-white text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Full name <span className="text-[#C9A84C]">*</span></label>
                  <input
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    placeholder="Juan dela Cruz"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Username <span className="text-[#C9A84C]">*</span></label>
                  <input
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="juandc"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Mobile <span className="text-[#C9A84C]">*</span></label>
                  <input
                    value={form.mobile}
                    onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                    placeholder="+63 9XX XXX XXXX"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Password <span className="text-[#C9A84C]">*</span></label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Set initial password"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Distributor level <span className="text-[#C9A84C]">*</span></label>
                  <select
                    value={form.dist_level}
                    onChange={(e) => setForm({ ...form, dist_level: e.target.value })}
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  >
                    <option value="regional">Regional</option>
                    <option value="provincial">Provincial</option>
                    <option value="city">City</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Coverage area <span className="text-[#C9A84C]">*</span></label>
                  <input
                    value={form.coverage_area}
                    onChange={(e) => setForm({ ...form, coverage_area: e.target.value })}
                    placeholder="e.g. Region VII / Cebu / Iloilo"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">Address</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="City / Municipality"
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
                  <p className="text-[#1a7a4a] text-xs">{formSuccess}</p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleFormSubmit}
                  disabled={formLoading}
                  className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] transition-colors disabled:opacity-60"
                >
                  {formLoading ? 'Registering...' : 'Register distributor'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}