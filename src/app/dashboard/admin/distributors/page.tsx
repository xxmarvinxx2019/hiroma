'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'
import Link from 'next/link'

// ============================================================
// TYPES
// ============================================================

interface AssignParentTarget {
  user_id: string
  full_name: string
  username: string
  dist_level: string
  profile_id: string
}

interface Distributor {
  id: string
  full_name: string
  username: string
  mobile: string
  address: string | null
  status: string
  created_at: string
  distributor_profile: {
    id:            string
    dist_level:    string
    coverage_area: string
    is_active:     boolean
    contract_signed_at: string | null
    region_name:    string | null
    province_name:  string | null
    city_muni_name: string | null
    parent: {
      user: { full_name: string; username: string }
      dist_level: string
      coverage_area: string
    } | null
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
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page: 1, pageSize: 15, totalPages: 1 })
  const [assignTarget, setAssignTarget] = useState<AssignParentTarget | null>(null)
  const [assignParentId, setAssignParentId] = useState('')
  const [assignOptions, setAssignOptions] = useState<{ id: string; full_name: string; username: string; dist_level: string; coverage_area: string }[]>([])
  const [assignSaving, setAssignSaving] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [assignSuccess, setAssignSuccess] = useState('')
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
    parent_dist_id: '',
    region_code: '', region_name: '',
    province_code: '', province_name: '',
    city_muni_code: '', city_muni_name: '',
  })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  const [parentOptions, setParentOptions] = useState<{ id: string; full_name: string; username: string; dist_level: string; coverage_area: string }[]>([])

  // PSGC location state
  const [regions, setRegions]         = useState<{ code: string; name: string }[]>([])
  const [provinces, setProvinces]     = useState<{ code: string; name: string }[]>([])
  const [cityMunis, setCityMunis]     = useState<{ code: string; name: string }[]>([])
  const [loadingProv, setLoadingProv] = useState(false)
  const [loadingCity, setLoadingCity] = useState(false)

  // Load regions on mount
  useEffect(() => {
    fetch('https://psgc.gitlab.io/api/regions/')
      .then((r) => r.json())
      .then((data) => setRegions(data.map((r: { code: string; name: string }) => ({ code: r.code, name: r.name })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))))
      .catch(() => {})
  }, [])

  // Load provinces when region changes
  useEffect(() => {
    if (!form.region_code) { setProvinces([]); setCityMunis([]); return }
    setLoadingProv(true)
    fetch(`https://psgc.gitlab.io/api/regions/${form.region_code}/provinces/`)
      .then((r) => r.json())
      .then((data) => setProvinces(data.map((p: { code: string; name: string }) => ({ code: p.code, name: p.name })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))))
      .catch(() => setProvinces([]))
      .finally(() => setLoadingProv(false))
    setForm((f) => ({ ...f, province_code: '', province_name: '', city_muni_code: '', city_muni_name: '' }))
    setCityMunis([])
  }, [form.region_code])

  // Load cities when province changes
  useEffect(() => {
    if (!form.province_code) { setCityMunis([]); return }
    setLoadingCity(true)
    fetch(`https://psgc.gitlab.io/api/provinces/${form.province_code}/cities-municipalities/`)
      .then((r) => r.json())
      .then((data) => setCityMunis(data.map((c: { code: string; name: string }) => ({ code: c.code, name: c.name })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))))
      .catch(() => setCityMunis([]))
      .finally(() => setLoadingCity(false))
    setForm((f) => ({ ...f, city_muni_code: '', city_muni_name: '' }))
  }, [form.province_code])

  // Fetch parent options when level changes
  useEffect(() => {
    if (form.dist_level === 'regional') {
      setParentOptions([])
      setForm((f) => ({ ...f, parent_dist_id: '' }))
      return
    }
    const parentLevel = form.dist_level === 'provincial' ? 'regional' : 'provincial,regional'
    fetch(`/api/admin/distributors?parent_level=${parentLevel}`)
      .then((r) => r.json())
      .then((data) => {
        const filtered = (data.distributors || []).filter((d: { distributor_profile?: { dist_level: string } }) => {
          if (form.dist_level === 'provincial') return d.distributor_profile?.dist_level === 'regional'
          return ['provincial', 'regional'].includes(d.distributor_profile?.dist_level || '')
        })
        setParentOptions(filtered// eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((d: any) => ({
          id: d.id,
          full_name: d.full_name,
          username: d.username,
          dist_level: d.distributor_profile?.dist_level || '',
          coverage_area: d.distributor_profile?.coverage_area || '',
        })))
      })
    setForm((f) => ({ ...f, parent_dist_id: '' }))
  }, [form.dist_level])

  const openAssignModal = (dist: Distributor) => {
    setAssignTarget({
      user_id:    dist.id,
      full_name:  dist.full_name,
      username:   dist.username,
      dist_level: dist.distributor_profile?.dist_level || '',
      profile_id: dist.distributor_profile?.id || '',
    })
    setAssignParentId('')
    setAssignError('')
    setAssignSuccess('')
    // Load eligible parents
    const level = dist.distributor_profile?.dist_level
    const parentLevel = level === 'provincial' ? 'regional' : level === 'city' ? 'provincial,regional' : ''
    if (!parentLevel) return
    fetch(`/api/admin/distributors?parent_level=${parentLevel}`)
      .then((r) => r.json())
      .then((data) => {
        setAssignOptions((data.distributors || [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((d: any) => d.id !== dist.id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((d: any) => ({
            id:            d.distributor_profile?.id || '', // profile id for parent_dist_id
            full_name:     d.full_name,
            username:      d.username,
            dist_level:    d.distributor_profile?.dist_level    || '',
            coverage_area: d.distributor_profile?.coverage_area || '',
          })))
      })
  }

  const handleAssignParent = async () => {
    if (!assignTarget) return
    setAssignSaving(true)
    setAssignError('')
    setAssignSuccess('')
    const res = await fetch('/api/admin/distributors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        distributor_id: assignTarget.user_id,
        parent_dist_id: assignParentId || null,
      }),
    })
    const data = await res.json()
    setAssignSaving(false)
    if (res.ok) {
      setAssignSuccess(data.message || 'Parent assigned successfully.')
      fetchDistributors()
    } else {
      setAssignError(data.error || 'Something went wrong.')
    }
  }

  useEffect(() => { setPage(1) }, [filter, search])

  const fetchDistributors = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page), pageSize: '15',
      ...(filter !== 'all' && { level: filter }),
      ...(search && { search }),
    })
    fetch(`/api/admin/distributors?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setDistributors(data.distributors || [])
        if (data.meta) setMeta(data.meta)
        setLoading(false)
      })
  }, [filter, search, page])

  useEffect(() => { fetchDistributors() }, [fetchDistributors])

  const filtered = distributors

  const handleFormSubmit = async () => {
    if (!form.full_name || !form.username || !form.mobile || !form.password || !form.region_code) {
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
      setForm({
        full_name: '', username: '', mobile: '', password: '', address: '',
        dist_level: 'city', coverage_area: '', parent_dist_id: '',
        region_code: '', region_name: '',
        province_code: '', province_name: '',
        city_muni_code: '', city_muni_name: '',
      })
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
        <div className="grid grid-cols-6 px-4 py-2 bg-[#F0F2F8]">
          {['Distributor', 'Level', 'Coverage area', 'Status', 'Registered', 'Parent'].map((h) => (
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
              className="grid grid-cols-6 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center"
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
              <div>
                {dist.distributor_profile?.dist_level !== 'regional' && (
                  <button
                    onClick={() => openAssignModal(dist)}
                    className="text-xs text-[#C9A84C] hover:underline whitespace-nowrap"
                  >
                    {dist.distributor_profile?.parent ? 'Change Parent' : 'Assign Parent'}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        <Pagination meta={meta} onPageChange={setPage} />
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
                {/* Region */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Region <span className="text-[#C9A84C]">*</span></label>
                  <select
                    value={form.region_code}
                    onChange={(e) => {
                      const selected = regions.find((r) => r.code === e.target.value)
                      setForm((f) => ({ ...f, region_code: e.target.value, region_name: selected?.name || '' }))
                    }}
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                  >
                    <option value="">Select region...</option>
                    {regions.map((r) => (
                      <option key={r.code} value={r.code}>{r.name}</option>
                    ))}
                  </select>
                </div>

                {/* Province — shown for provincial and city */}
                {(form.dist_level === 'provincial' || form.dist_level === 'city') && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Province <span className="text-[#C9A84C]">*</span></label>
                    <select
                      value={form.province_code}
                      onChange={(e) => {
                        const selected = provinces.find((p) => p.code === e.target.value)
                        setForm((f) => ({ ...f, province_code: e.target.value, province_name: selected?.name || '' }))
                      }}
                      disabled={!form.region_code || loadingProv}
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] disabled:opacity-50"
                    >
                      <option value="">{loadingProv ? 'Loading...' : 'Select province...'}</option>
                      {provinces.map((p) => (
                        <option key={p.code} value={p.code}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* City/Municipality — shown for city only */}
                {form.dist_level === 'city' && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">City / Municipality <span className="text-[#C9A84C]">*</span></label>
                    <select
                      value={form.city_muni_code}
                      onChange={(e) => {
                        const selected = cityMunis.find((c) => c.code === e.target.value)
                        setForm((f) => ({ ...f, city_muni_code: e.target.value, city_muni_name: selected?.name || '' }))
                      }}
                      disabled={!form.province_code || loadingCity}
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] disabled:opacity-50"
                    >
                      <option value="">{loadingCity ? 'Loading...' : 'Select city/municipality...'}</option>
                      {cityMunis.map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Coverage area preview */}
                {form.region_name && (
                  <div className="bg-[#e8f7ef] rounded-lg px-3 py-2">
                    <p className="text-xs text-gray-400 mb-0.5">Coverage area (auto-generated)</p>
                    <p className="text-xs font-medium text-[#1a7a4a]">
                      {[form.city_muni_name, form.province_name, form.region_name].filter(Boolean).join(', ')}
                    </p>
                  </div>
                )}
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

      {/* Assign Parent Modal */}
      {assignTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#0D1B3E]">Assign Parent Distributor</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {assignTarget.full_name} (@{assignTarget.username}) · {assignTarget.dist_level}
                </p>
              </div>
              <button onClick={() => setAssignTarget(null)} className="text-gray-400 hover:text-[#0D1B3E] text-lg leading-none">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Select {assignTarget.dist_level === 'provincial' ? 'Regional' : 'Provincial or Regional'} Parent
                </label>
                <select
                  value={assignParentId}
                  onChange={(e) => setAssignParentId(e.target.value)}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                >
                  <option value="">— Remove parent (use location matching) —</option>
                  {assignOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.full_name} (@{o.username}) · {o.coverage_area} [{o.dist_level}]
                    </option>
                  ))}
                </select>
                {assignOptions.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1">
                    No eligible parent distributors found.
                  </p>
                )}
              </div>

              <div className="bg-[#F0F2F8] rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400 leading-relaxed">
                  Selecting <span className="font-medium text-[#0D1B3E]">— Remove parent —</span> will clear the explicit assignment.
                  The system will automatically route orders based on location matching.
                </p>
              </div>

              {assignSuccess && <p className="text-xs text-[#1a7a4a] bg-[#e8f7ef] px-3 py-2 rounded-lg">{assignSuccess}</p>}
              {assignError   && <p className="text-xs text-[#a03030] bg-[#fdecea] px-3 py-2 rounded-lg">{assignError}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setAssignTarget(null)}
                  className="flex-1 bg-[#F0F2F8] text-gray-500 text-sm py-2 rounded-lg hover:bg-[#e4e6ef] transition-colors">
                  Cancel
                </button>
                <button onClick={handleAssignParent} disabled={assignSaving}
                  className="flex-1 bg-[#0D1B3E] text-white text-sm py-2 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-50 font-medium">
                  {assignSaving ? 'Saving...' : 'Save Assignment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}