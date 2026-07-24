'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

interface Pin {
  id:               string
  pin_code:         string
  status:           string
  created_at:       string
  used_at:          string | null
  package:          { name: string } | null
  city_distributor: { full_name: string; username: string } | null
  used_by_user:     { full_name: string; username: string } | null
}

interface Package { id: string; name: string; price: number; is_active: boolean }
interface CityDist { id: string; full_name: string; username: string }

const fmt = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_STYLES: Record<string, string> = {
  unused:    'bg-[#fff8e6] text-[#b87a00]',
  used:      'bg-[#e8f7ef] text-[#1a7a4a]',
  cancelled: 'bg-[#fdecea] text-[#a03030]',
}

export default function PinsPage() {
  const [pins, setPins]               = useState<Pin[]>([])
  const [packages, setPackages]       = useState<Package[]>([])
  const [cityDists, setCityDists]     = useState<CityDist[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'unused' | 'used' | 'cancelled'>('all')
  const [page, setPage]               = useState(1)
  const [meta, setMeta]               = useState<PaginationMeta>({ total: 0, page: 1, pageSize: 15, totalPages: 1 })
  const [summary, setSummary]         = useState({ total: 0, unused: 0, used: 0, cancelled: 0 })
  const [showForm, setShowForm]       = useState(false)
  const [form, setForm]               = useState({ package_id: '', city_dist_id: '', quantity: '1' })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError]     = useState('')
  const [formSuccess, setFormSuccess] = useState('')
  const [generatedPins, setGeneratedPins] = useState<string[]>([])
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [cancelling, setCancelling]   = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [distSearch, setDistSearch]   = useState('')
  const [showDistDrop, setShowDistDrop] = useState(false)

  // Date filter
  const todayStr = new Date().toISOString().slice(0, 10)
  const [dateMode, setDateMode]     = useState<'today' | 'yesterday' | 'week' | 'month' | 'custom'>('today')
  const [dateFrom, setDateFrom]     = useState(todayStr)
  const [dateTo, setDateTo]         = useState(todayStr)

  // Compute date range from mode
  const getDateRange = () => {
    const today = new Date()
    const fmt   = (d: Date) => d.toISOString().slice(0, 10)
    switch (dateMode) {
      case 'today':
        return { from: fmt(today), to: fmt(today) }
      case 'yesterday': {
        const y = new Date(today); y.setDate(y.getDate() - 1)
        return { from: fmt(y), to: fmt(y) }
      }
      case 'week': {
        const w = new Date(today); w.setDate(w.getDate() - 7)
        return { from: fmt(w), to: fmt(today) }
      }
      case 'month': {
        const m = new Date(today); m.setDate(1)
        return { from: fmt(m), to: fmt(today) }
      }
      case 'custom':
        return { from: dateFrom, to: dateTo }
      default:
        return { from: fmt(today), to: fmt(today) }
    }
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/packages?pageSize=100&active=true').then(r => r.json()),
      fetch('/api/admin/distributors?pageSize=200&level=city').then(r => r.json()),
    ]).then(([pd, dd]) => {
      setPackages(pd.packages || [])
      const list = (dd.distributors || []).filter((d: any) => d.distributor_profile?.dist_level === 'city')
      setCityDists([{ id: dd.adminUser?.id || '', full_name: '⭐ Admin (Self)', username: 'admin' }, ...list])
    })
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [search, statusFilter, dateMode, dateFrom, dateTo])

  const fetchPins = useCallback(() => {
    setLoading(true)
    const { from, to } = getDateRange()
    const params = new URLSearchParams({
      page: String(page), pageSize: '15',
      ...(statusFilter !== 'all' && { status: statusFilter }),
      ...(search && { search }),
      from, to,
    })
    fetch(`/api/admin/pins?${params}`)
      .then(r => r.json())
      .then(d => {
        setPins(d.pins || [])
        setMeta(d.meta || { total: 0, page: 1, pageSize: 15, totalPages: 1 })
        setSummary(d.summary || { total: 0, unused: 0, used: 0, cancelled: 0 })
      })
      .finally(() => setLoading(false))
  }, [page, statusFilter, search, dateMode, dateFrom, dateTo])

  useEffect(() => { fetchPins() }, [fetchPins])

  const handleGenerate = async () => {
    if (!form.package_id || !form.city_dist_id || !form.quantity) {
      setFormError('All fields are required.'); return
    }
    setFormLoading(true); setFormError(''); setFormSuccess('')
    const res  = await fetch('/api/admin/pins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ package_id: form.package_id, city_dist_id: form.city_dist_id, quantity: parseInt(form.quantity) }) })
    const data = await res.json()
    if (!res.ok) { setFormError(data.error || 'Failed'); setFormLoading(false); return }
    setGeneratedPins(data.pin_codes || [])
    setFormLoading(false)
    fetchPins()
    setShowForm(false)
    setForm({ package_id: '', city_dist_id: '', quantity: '1' })
    setShowSuccessModal(true)
  }

  const handleBulkCancel = async () => {
    if (!selectedIds.length) return
    setCancelling(true)
    await fetch('/api/admin/pins', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin_ids: selectedIds, action: 'cancel' }) })
    setSelectedIds([]); setShowConfirm(false); setCancelling(false)
    fetchPins()
  }

  const exportCSV = () => {
    const headers = ['PIN Code', 'Package', 'Distributor', 'Used By', 'Status', 'Created At']
    const rows    = pins.map(p => [p.pin_code, p.package?.name || '', p.city_distributor?.full_name || '', p.used_by_user?.full_name || '', p.status, new Date(p.created_at).toLocaleString('en-PH')])
    const csv     = [headers, ...rows].map(r => r.join(',')).join('\n')
    const a       = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `pins-${todayStr}.csv`; a.click()
  }

  const { from: displayFrom } = getDateRange()
  const displayDate = dateMode === 'today' ? 'Today' : dateMode === 'yesterday' ? 'Yesterday' : dateMode === 'week' ? 'This Week' : dateMode === 'month' ? 'This Month' : `${dateFrom} — ${dateTo}`

  return (
    <div className="w-full space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B3E]">PIN Manager</h1>
          <p className="text-xs text-gray-400 mt-0.5">Generate and track all impulse PINs.</p>
        </div>
        <button onClick={() => { setShowForm(true); setFormError(''); setFormSuccess(''); setGeneratedPins([]); setShowDistDrop(false); setDistSearch('') }}
          className="flex items-center gap-2 bg-[#C9A84C] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#b8963e] transition-colors">
          + Generate PINs
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'TOTAL PINS', value: summary.total, color: '#2563eb', icon: '📋', sub: 'View details below' },
          { label: 'UNUSED',     value: summary.unused,    color: '#C9A84C', icon: '🔒', sub: `${summary.total > 0 ? ((summary.unused / summary.total) * 100).toFixed(2) : '0.00'}% of total` },
          { label: 'USED',       value: summary.used,      color: '#1a7a4a', icon: '✅', sub: `${summary.total > 0 ? ((summary.used / summary.total) * 100).toFixed(2) : '0.00'}% of total` },
          { label: 'CANCELLED',  value: summary.cancelled,   color: '#64748b', icon: '🚫', sub: `${summary.total > 0 ? ((summary.cancelled / summary.total) * 100).toFixed(2) : '0.00'}% of total` },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5" style={{ borderTop: `2px solid ${s.color}` }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">{s.label} <span className="text-gray-300">({displayDate})</span></p>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: s.color + '15' }}>{s.icon}</div>
            </div>
            <p className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Date Range + Quick Filters + Search */}
      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date picker (custom) */}
          <div className="flex items-center gap-2 border border-[#0D1B3E]/10 rounded-xl px-3 py-2 bg-[#f8f9fc]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span className="text-xs text-[#0D1B3E] font-medium">{displayDate}</span>
          </div>

          {/* Quick filter tabs */}
          <div className="flex gap-1">
            {(['today','yesterday','week','month','custom'] as const).map(m => (
              <button key={m} onClick={() => setDateMode(m)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors capitalize ${dateMode === m ? 'bg-[#0D1B3E] text-white' : 'bg-[#f8f9fc] text-gray-400 hover:text-[#0D1B3E]'}`}>
                {m === 'today' ? 'Today' : m === 'yesterday' ? 'Yesterday' : m === 'week' ? 'This Week' : m === 'month' ? 'This Month' : 'Custom'}
              </button>
            ))}
          </div>

          {/* Custom date range */}
          {dateMode === 'custom' && (
            <div className="flex items-center gap-2 border border-[#0D1B3E]/10 rounded-xl px-3 py-2 bg-[#f8f9fc]">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="text-xs text-[#0D1B3E] outline-none bg-transparent" />
              <span className="text-gray-300 text-xs">—</span>
              <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="text-xs text-[#0D1B3E] outline-none bg-transparent" />
            </div>
          )}

          {/* Search */}
          <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-xl px-3 py-2 ml-auto">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-300">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by PIN code or username..."
              className="flex-1 bg-transparent text-xs text-[#0D1B3E] outline-none placeholder:text-gray-300" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
        {/* Status tabs + Export */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#0D1B3E]/8">
          <div className="flex gap-1">
            {([
              { key: 'all',       label: `All (${summary.total})` },
              { key: 'unused',    label: `Unused (${summary.unused})` },
              { key: 'used',      label: `Used (${summary.used})` },
              { key: 'cancelled', label: `Cancelled (${summary.cancelled})` },
            ] as const).map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${statusFilter === f.key ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <button onClick={() => setShowConfirm(true)}
                className="text-xs bg-[#fdecea] text-[#e05252] px-3 py-1.5 rounded-lg font-medium hover:bg-[#e05252] hover:text-white transition-colors">
                Cancel {selectedIds.length} PIN{selectedIds.length > 1 ? 's' : ''}
              </button>
            )}
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 text-xs border border-[#0D1B3E]/15 text-[#0D1B3E] px-3 py-1.5 rounded-lg hover:bg-[#f8f9fc] transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export
            </button>
          </div>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-6 px-5 py-2.5 bg-[#f8f9fc] border-b border-[#0D1B3E]/8">
          <div className="flex items-center gap-3">
            <input type="checkbox"
              checked={selectedIds.length > 0 && pins.filter(p => p.status === 'unused').every(p => selectedIds.includes(p.id))}
              onChange={e => {
                const unusedIds = pins.filter(p => p.status === 'unused').map(p => p.id)
                setSelectedIds(e.target.checked ? unusedIds : [])
              }}
              className="rounded" />
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">PIN Code</p>
          </div>
          {['Package', 'Distributor', 'Used By', 'Status', 'Created At'].map(h => (
            <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{h}</p>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col items-center py-16">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-gray-400 text-sm">Loading PINs...</p>
          </div>
        ) : pins.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <span className="text-4xl mb-3">🔑</span>
            <p className="text-gray-400 text-sm">No PINs found for this period</p>
          </div>
        ) : pins.map(pin => (
          <div key={pin.id} className="grid grid-cols-6 px-5 py-3.5 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors items-center">
            <div className="flex items-center gap-3">
              {pin.status === 'unused' && (
                <input type="checkbox" checked={selectedIds.includes(pin.id)}
                  onChange={e => setSelectedIds(prev => e.target.checked ? [...prev, pin.id] : prev.filter(id => id !== pin.id))}
                  className="rounded" />
              )}
              {pin.status !== 'unused' && <div className="w-4" />}
              <p className="text-xs font-mono font-semibold text-[#0D1B3E]">{pin.pin_code}</p>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold w-fit" style={{ background: '#C9A84C18', color: '#C9A84C' }}>
              {pin.package?.name || '—'}
            </span>
            <div>
              <p className="text-xs font-medium text-[#0D1B3E]">{pin.city_distributor?.full_name || '—'}</p>
              <p className="text-[10px] text-gray-400">@{pin.city_distributor?.username || ''}</p>
            </div>
            <div>
              {pin.used_by_user ? (
                <>
                  <p className="text-xs font-medium text-[#0D1B3E]">{pin.used_by_user.full_name}</p>
                  <p className="text-[10px] text-gray-400">@{pin.used_by_user.username}</p>
                </>
              ) : <p className="text-xs text-gray-300">—</p>}
            </div>
            <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold w-fit ${STATUS_STYLES[pin.status] || 'bg-gray-100 text-gray-400'}`}>
              {pin.status}
            </span>
            <div>
              <p className="text-xs text-gray-500">{new Date(pin.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              <p className="text-[10px] text-gray-400">{new Date(pin.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>
        ))}

        <div className="px-5 py-3 border-t border-[#0D1B3E]/5 flex items-center justify-between">
          <p className="text-xs text-gray-400">Showing {Math.min((page-1)*15+1, meta.total)} to {Math.min(page*15, meta.total)} of {meta.total} entries</p>
          <Pagination meta={meta} onPageChange={setPage} />
        </div>
      </div>

      {/* Generate PIN Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#0D1B3E]/8 w-[480px] mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#0D1B3E]/8 bg-[#f8f9fc] rounded-t-2xl">
              <p className="text-sm font-bold text-[#0D1B3E]">Generate PINs</p>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-[#0D1B3E]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Package */}
              <div>
                <label className="text-xs font-semibold text-[#0D1B3E] mb-1.5 block">Package</label>
                <select value={form.package_id} onChange={e => setForm({ ...form, package_id: e.target.value })}
                  className="w-full text-sm border border-[#0D1B3E]/15 rounded-xl px-3 py-2.5 outline-none focus:border-[#C9A84C] bg-[#f8f9fc]">
                  <option value="">Select package...</option>
                  {packages.map(p => <option key={p.id} value={p.id}>{p.name} — {fmt(p.price)}</option>)}
                </select>
              </div>
              {/* City Dist */}
              <div className="relative">
                <label className="text-xs font-semibold text-[#0D1B3E] mb-1.5 block">Assign to City Distributor</label>
                <input
                  value={distSearch !== '' ? distSearch : form.city_dist_id ? (cityDists.find(d => d.id === form.city_dist_id)?.full_name || '') : ''}
                  onChange={e => {
                    setDistSearch(e.target.value)
                    setShowDistDrop(true)
                    if (!e.target.value) setForm({ ...form, city_dist_id: '' })
                  }}
                  onFocus={() => { setShowDistDrop(true); setDistSearch('') }}
                  onBlur={() => setTimeout(() => { setShowDistDrop(false); setDistSearch('') }, 200)}
                  placeholder="Search distributor..."
                  autoComplete="off"
                  className="w-full text-sm border border-[#0D1B3E]/15 rounded-xl px-3 py-2.5 outline-none focus:border-[#C9A84C] bg-[#f8f9fc]" />
                {showDistDrop && (
                  <div className="absolute top-full left-0 right-0 z-[9999] bg-white border border-[#0D1B3E]/10 rounded-xl shadow-xl mt-1 max-h-48 overflow-y-auto">
                    {cityDists.filter(d => !distSearch || d.full_name.toLowerCase().includes(distSearch.toLowerCase()) || d.username.toLowerCase().includes(distSearch.toLowerCase())).map(d => (
                      <button key={d.id} onClick={() => { setForm({ ...form, city_dist_id: d.id }); setDistSearch(''); setShowDistDrop(false) }}
                        className={`w-full text-left px-4 py-2.5 hover:bg-[#f8f9fc] text-sm transition-colors ${form.city_dist_id === d.id ? 'bg-[#f0f2f8]' : ''}`}>
                        <p className="font-medium text-[#0D1B3E]">{d.full_name}</p>
                        <p className="text-[10px] text-gray-400">@{d.username}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Quantity */}
              <div>
                <label className="text-xs font-semibold text-[#0D1B3E] mb-1.5 block">Quantity</label>
                <input type="number" min="1" max="100" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })}
                  className="w-full text-sm border border-[#0D1B3E]/15 rounded-xl px-3 py-2.5 outline-none focus:border-[#C9A84C] bg-[#f8f9fc]" />
              </div>

              {formError && <p className="text-xs text-[#e05252] bg-[#fdecea] px-3 py-2 rounded-lg">{formError}</p>}


              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[#0D1B3E]/15 text-xs font-medium text-gray-500 hover:bg-[#f8f9fc] transition-colors">
                  Close
                </button>
                <button onClick={handleGenerate} disabled={formLoading}
                  className="flex-1 py-2.5 rounded-xl bg-[#C9A84C] text-white text-xs font-bold hover:bg-[#b8963e] transition-colors disabled:opacity-50">
                  {formLoading ? 'Generating...' : 'Generate PINs'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal - Generated PINs */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#0D1B3E]/8 w-[520px] mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#0D1B3E]/8 bg-[#e8f7ef] rounded-t-2xl">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#1a7a4a]/20 flex items-center justify-center text-xl">✅</div>
                <div>
                  <p className="text-sm font-bold text-[#1a7a4a]">{generatedPins.length} PINs Generated Successfully!</p>
                  <p className="text-[10px] text-[#1a7a4a]/70">PINs are ready to be assigned to resellers</p>
                </div>
              </div>
              <button onClick={() => { setShowSuccessModal(false); setGeneratedPins([]) }}
                className="text-gray-400 hover:text-[#0D1B3E]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="p-6">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Generated PIN Codes</p>
              <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                {generatedPins.map((pin, i) => (
                  <div key={pin} className="flex items-center justify-between bg-[#f8f9fc] border border-[#0D1B3E]/8 rounded-xl px-3 py-2">
                    <p className="text-[11px] font-mono font-semibold text-[#0D1B3E]">{pin}</p>
                    <button onClick={() => navigator.clipboard.writeText(pin)}
                      className="text-gray-300 hover:text-[#C9A84C] transition-colors ml-1">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => { setShowSuccessModal(false); setGeneratedPins([]) }}
                  className="flex-1 py-2.5 rounded-xl bg-[#0D1B3E] text-white text-xs font-bold hover:bg-[#1A2F5E] transition-colors">
                  Done
                </button>
                <button onClick={() => {
                  const text = generatedPins.join('\n')
                  navigator.clipboard.writeText(text)
                }} className="py-2.5 px-4 rounded-xl border border-[#0D1B3E]/15 text-xs font-medium text-gray-500 hover:bg-[#f8f9fc] transition-colors">
                  Copy All
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl border border-[#0D1B3E]/8 p-6 w-80 mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[#fdecea] flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e05252" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-[#0D1B3E]">Cancel {selectedIds.length} PIN{selectedIds.length > 1 ? 's' : ''}?</p>
                <p className="text-xs text-gray-400 mt-0.5">This action cannot be undone</p>
              </div>
            </div>
            {cancelError && <p className="text-xs text-[#e05252] mb-3">{cancelError}</p>}
            <div className="flex gap-2">
              <button onClick={() => setShowConfirm(false)}
                className="flex-1 py-2 rounded-xl border border-[#0D1B3E]/15 text-xs font-medium text-gray-500 hover:bg-[#f8f9fc] transition-colors">
                Keep PINs
              </button>
              <button onClick={handleBulkCancel} disabled={cancelling}
                className="flex-1 py-2 rounded-xl bg-[#e05252] text-white text-xs font-bold hover:bg-[#c03030] transition-colors disabled:opacity-50">
                {cancelling ? 'Cancelling...' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}