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
  funding_order: { order_number: string | null; payment_reference: string | null } | null
  funding_pin_request: { id: string; payment_reference: string | null; status: string } | null
  funding_pin_transfer: { reference_number: string; status: string; sale_value: number } | null
}

interface UpgradePath {
  from_package_id: string
  customer_price: number
  pin_price: number
  from_package: { id: string; name: string }
  products: Array<{ product_id: string; quantity: number; product: { name: string } }>
}
interface Package { id: string; name: string; price: number; is_active: boolean; upgrade_paths_to: UpgradePath[] }
interface CityDist {
  id: string
  full_name: string
  username: string
  distributor_profile?: { dist_level: string } | null
}

const fmt = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_STYLES: Record<string, string> = {
  in_transit: 'bg-[#eef2ff] text-[#4338ca]',
  unused:    'bg-[#fff8e6] text-[#b87a00]',
  used:      'bg-[#e8f7ef] text-[#1a7a4a]',
  expired:   'bg-[#fff1f2] text-[#be123c]',
  cancelled: 'bg-[#fdecea] text-[#a03030]',
}

export default function PinsPage() {
  const [pins, setPins]               = useState<Pin[]>([])
  const [packages, setPackages]       = useState<Package[]>([])
  const [cityDists, setCityDists]     = useState<CityDist[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_transit' | 'unused' | 'used' | 'expired' | 'cancelled'>('unused')
  const [page, setPage]               = useState(1)
  const [meta, setMeta]               = useState<PaginationMeta>({ total: 0, page: 1, pageSize: 15, totalPages: 1 })
  const [summary, setSummary]         = useState({ total: 0, in_transit: 0, unused: 0, used: 0, expired: 0, cancelled: 0 })
  const [showForm, setShowForm]       = useState(false)
  const [form, setForm]               = useState({
    package_id: '', city_dist_id: '', quantity: '1', pin_type: 'registration', upgrade_from_package_id: '',
    payment_method: 'cash', payment_reference: '', payment_sender_name: '', payment_datetime: '', notes: '',
  })
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError]     = useState('')
  const [formSuccess, setFormSuccess] = useState('')
  const [generatedPins, setGeneratedPins] = useState<string[]>([])
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [issuanceResult, setIssuanceResult] = useState({ transaction_type: '', reference_number: '', message: '' })
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [cancelling, setCancelling]   = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [cancelDisposition, setCancelDisposition] = useState<'refunded' | 'credited' | 'retained'>('retained')
  const [cancelReference, setCancelReference] = useState('')
  const [distSearch, setDistSearch]   = useState('')
  const [showDistDrop, setShowDistDrop] = useState(false)
  const selectedUpgradePath = form.pin_type === 'upgrade'
    ? packages.find((pkg) => pkg.id === form.package_id)?.upgrade_paths_to?.find((path) => path.from_package_id === form.upgrade_from_package_id)
    : undefined
  const eligiblePinRecipients = form.pin_type === 'upgrade'
    ? cityDists.filter((distributor) => distributor.distributor_profile?.dist_level === 'city' || distributor.distributor_profile?.dist_level === 'branch')
    : cityDists
  const selectedRecipient = cityDists.find((distributor) => distributor.id === form.city_dist_id)
  const isBranchTransfer = selectedRecipient?.distributor_profile?.dist_level === 'branch'

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
      fetch('/api/admin/distributors?pageSize=200&parent_level=city,branch').then(r => r.json()),
    ]).then(([pd, dd]) => {
      setPackages(pd.packages || [])
      const list = (dd.distributors || []).filter((d: CityDist) => d.distributor_profile?.dist_level === 'city' || d.distributor_profile?.dist_level === 'branch')
      setCityDists(list)
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
        setSummary(d.summary || { total: 0, in_transit: 0, unused: 0, used: 0, expired: 0, cancelled: 0 })
      })
      .finally(() => setLoading(false))
  }, [page, statusFilter, search, dateMode, dateFrom, dateTo])

  useEffect(() => { fetchPins() }, [fetchPins])

  const handleGenerate = async () => {
    if (!form.package_id || !form.city_dist_id || !form.quantity || (form.pin_type === 'upgrade' && !form.upgrade_from_package_id)) {
      setFormError('All fields are required.'); return
    }
    if (!isBranchTransfer && (
      form.payment_reference.trim().length < 3
      || form.payment_sender_name.trim().length < 2
      || !form.payment_datetime
    )) {
      setFormError('Paid City PIN sales require official reference, payer name, and payment time.'); return
    }
    setFormLoading(true); setFormError(''); setFormSuccess('')
    const res  = await fetch('/api/admin/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        package_id: form.package_id,
        city_dist_id: form.city_dist_id,
        quantity: parseInt(form.quantity),
        pin_type: form.pin_type,
        upgrade_from_package_id: form.pin_type === 'upgrade' ? form.upgrade_from_package_id : undefined,
        workflow: isBranchTransfer ? 'internal_transfer' : 'paid_sale',
        payment_method: isBranchTransfer ? null : form.payment_method,
        payment_reference: isBranchTransfer ? null : form.payment_reference.trim(),
        payment_sender_name: isBranchTransfer ? null : form.payment_sender_name.trim(),
        payment_datetime: isBranchTransfer ? null : form.payment_datetime,
        notes: form.notes.trim() || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setFormError(data.error || 'Failed'); setFormLoading(false); return }
    const pins = data.pins || data.pin_codes || []
    setGeneratedPins(pins)
    setIssuanceResult({
      transaction_type: data.transaction_type || '',
      reference_number: data.reference_number || '',
      message: data.message || '',
    })
    setFormLoading(false)
    setShowForm(false)
    setForm({
      package_id: '', city_dist_id: '', quantity: '1', pin_type: 'registration', upgrade_from_package_id: '',
      payment_method: 'cash', payment_reference: '', payment_sender_name: '', payment_datetime: '', notes: '',
    })
    setShowSuccessModal(true)
    fetchPins() // fetch after modal is shown
  }

  const handleBulkCancel = async () => {
    if (!selectedIds.length) return
    const reason = cancelReason.trim()
    if (reason.length < 3) {
      setCancelError('Please enter a clear cancellation reason (at least 3 characters).')
      return
    }
    if (['refunded', 'credited'].includes(cancelDisposition) && cancelReference.trim().length < 3) {
      setCancelError('Enter the refund or credit reference.')
      return
    }
    setCancelling(true)
    setCancelError('')
    try {
      const response = await fetch('/api/admin/pins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin_ids: selectedIds,
          reason,
          disposition: cancelDisposition,
          disposition_reference: cancelReference.trim() || null,
        }),
      })
      const data = await response.json()
      if (!response.ok || data.cancelled !== selectedIds.length) {
        setCancelError(data.error || 'The selected PINs were not fully cancelled. Refresh and try again.')
        return
      }
      setSelectedIds([])
      setCancelReason('')
      setCancelDisposition('retained')
      setCancelReference('')
      setShowConfirm(false)
      await fetchPins()
    } catch {
      setCancelError('Unable to cancel PINs. Check your connection and try again.')
    } finally {
      setCancelling(false)
    }
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
          <p className="text-xs text-gray-400 mt-0.5">Record paid City sales and zero-revenue Branch custody transfers.</p>
        </div>
        <button onClick={() => { setShowForm(true); setFormError(''); setFormSuccess(''); setGeneratedPins([]); setShowDistDrop(false); setDistSearch('') }}
          className="flex items-center gap-2 bg-[#C9A84C] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#b8963e] transition-colors">
          + Generate PINs
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: 'TOTAL PINS', value: summary.total, color: '#2563eb', icon: '📋', sub: 'View details below' },
          { label: 'IN TRANSIT', value: summary.in_transit, color: '#4338ca', icon: '🚚', sub: 'Awaiting Branch receipt' },
          { label: 'UNUSED',     value: summary.unused,    color: '#9a6f1e', icon: '🔒', sub: `${summary.total > 0 ? ((summary.unused / summary.total) * 100).toFixed(2) : '0.00'}% of total` },
          { label: 'USED',       value: summary.used,      color: '#1a7a4a', icon: '✅', sub: `${summary.total > 0 ? ((summary.used / summary.total) * 100).toFixed(2) : '0.00'}% of total` },
          { label: 'EXPIRED',    value: summary.expired,   color: '#be123c', icon: '⌛', sub: `${summary.total > 0 ? ((summary.expired / summary.total) * 100).toFixed(2) : '0.00'}% of total` },
          { label: 'CANCELLED',  value: summary.cancelled,   color: '#64748b', icon: '🚫', sub: `${summary.total > 0 ? ((summary.cancelled / summary.total) * 100).toFixed(2) : '0.00'}% of total` },
        ].map(s => (
          <div key={s.label} className="rounded-2xl border p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg" style={{ background: `linear-gradient(145deg, rgba(255,255,255,.15), rgba(0,0,0,.14)), ${s.color}`, borderColor: 'rgba(255,255,255,.3)', boxShadow: `0 8px 20px ${s.color}38` }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/80">{s.label} <span className="text-white/60">({displayDate})</span></p>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: 'rgba(255,255,255,.2)' }}>{s.icon}</div>
            </div>
            <p className="text-3xl font-extrabold text-white">{s.value}</p>
            <p className="mt-1 text-[10px] font-medium text-white/70">{s.sub}</p>
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
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors capitalize ${dateMode === m ? 'bg-[#010521] text-white' : 'bg-[#f8f9fc] text-gray-400 hover:text-[#0D1B3E]'}`}>
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
              placeholder="Search PIN, package, status, user, or date..."
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
              { key: 'in_transit', label: `In Transit (${summary.in_transit})` },
              { key: 'unused',    label: `Unused (${summary.unused})` },
              { key: 'used',      label: `Used (${summary.used})` },
              { key: 'expired',   label: `Expired (${summary.expired})` },
              { key: 'cancelled', label: `Cancelled (${summary.cancelled})` },
              { key: 'all',       label: `All (${summary.total})` },
            ] as const).map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${statusFilter === f.key ? 'bg-[#010521] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.length > 0 && (
              <button onClick={() => { setCancelError(''); setCancelReason(''); setCancelDisposition('retained'); setCancelReference(''); setShowConfirm(true) }}
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
              <p className="text-[10px] font-mono text-gray-400">
                {pin.funding_pin_transfer?.reference_number
                  || pin.funding_order?.order_number
                  || (pin.funding_pin_request ? `REQ-${pin.funding_pin_request.id.slice(0, 8).toUpperCase()}` : 'Legacy source')}
              </p>
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
              <div>
                <label className="text-xs font-semibold text-[#0D1B3E] mb-1.5 block">PIN purpose</label>
                <select value={form.pin_type} onChange={e => setForm({ ...form, pin_type: e.target.value, package_id: '', city_dist_id: '', upgrade_from_package_id: '' })}
                  className="w-full text-sm border border-[#0D1B3E]/15 rounded-xl px-3 py-2.5 outline-none focus:border-[#C9A84C] bg-[#f8f9fc]">
                  <option value="registration">New reseller registration PIN</option>
                  <option value="upgrade">Package upgrade PIN</option>
                </select>
                <p className="mt-1 text-[10px] text-gray-400">Upgrade PINs use the exact price and products configured in Admin Packages.</p>
              </div>
              {form.pin_type === 'upgrade' && (
                <div>
                  <label className="text-xs font-semibold text-[#0D1B3E] mb-1.5 block">Reseller’s current package</label>
                  <select value={form.upgrade_from_package_id} onChange={e => setForm({ ...form, upgrade_from_package_id: e.target.value, package_id: '' })}
                    className="w-full text-sm border border-[#0D1B3E]/15 rounded-xl px-3 py-2.5 outline-none focus:border-[#C9A84C] bg-[#f8f9fc]">
                    <option value="">Select current package...</option>
                    {packages.filter((source) => packages.some((target) => target.upgrade_paths_to?.some((path) => path.from_package_id === source.id))).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              {/* Package */}
              <div>
                <label className="text-xs font-semibold text-[#0D1B3E] mb-1.5 block">Package</label>
                <select value={form.package_id} onChange={e => setForm({ ...form, package_id: e.target.value })}
                  className="w-full text-sm border border-[#0D1B3E]/15 rounded-xl px-3 py-2.5 outline-none focus:border-[#C9A84C] bg-[#f8f9fc]">
                  <option value="">Select package...</option>
                  {packages.filter((pkg) => form.pin_type !== 'upgrade' || !form.upgrade_from_package_id || pkg.upgrade_paths_to?.some((path) => path.from_package_id === form.upgrade_from_package_id)).map(p => {
                    const configuredPath = p.upgrade_paths_to?.find((path) => path.from_package_id === form.upgrade_from_package_id)
                    return <option key={p.id} value={p.id}>{p.name} — {fmt(form.pin_type === 'upgrade' && configuredPath ? configuredPath.pin_price : p.price)}</option>
                  })}
                </select>
              </div>
              {form.pin_type === 'upgrade' && form.upgrade_from_package_id && form.package_id && (
                selectedUpgradePath ? (
                  <div className="rounded-xl border border-[#C9A84C]/40 bg-[#fffaf0] p-3 text-xs">
                    <div className="flex justify-between"><span className="text-gray-500">Customer upgrade price</span><strong className="text-[#0D1B3E]">{fmt(selectedUpgradePath.customer_price)}</strong></div>
                    <div className="mt-1 flex justify-between"><span className="text-gray-500">Upgrade PIN price</span><strong className="text-[#1a7a4a]">{fmt(selectedUpgradePath.pin_price)}</strong></div>
                    <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Products to release</p>
                    {selectedUpgradePath.products.map((item) => <div key={item.product_id} className="mt-1 flex justify-between"><span>{item.product.name}</span><span>×{item.quantity}</span></div>)}
                  </div>
                ) : (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">This upgrade path is not configured in Packages.</p>
                )
              )}
              {/* City Dist */}
              <div className="relative">
                <label className="text-xs font-semibold text-[#0D1B3E] mb-1.5 block">Assign to City Distributor or Branch</label>
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
                    {eligiblePinRecipients.filter(d => !distSearch || d.full_name.toLowerCase().includes(distSearch.toLowerCase()) || d.username.toLowerCase().includes(distSearch.toLowerCase())).map(d => (
                      <button key={d.id} onClick={() => { setForm({ ...form, city_dist_id: d.id }); setDistSearch(''); setShowDistDrop(false) }}
                        className={`w-full text-left px-4 py-2.5 hover:bg-[#f8f9fc] text-sm transition-colors ${form.city_dist_id === d.id ? 'bg-[#f0f2f8]' : ''}`}>
                        <p className="font-medium text-[#0D1B3E]">{d.full_name}</p>
                        <p className="text-[10px] text-gray-400">@{d.username}{d.distributor_profile?.dist_level ? ` · ${d.distributor_profile.dist_level}` : ''}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedRecipient && (
                isBranchTransfer ? (
                  <div className="rounded-xl border border-[#4338ca]/20 bg-[#eef2ff] px-3 py-2">
                    <p className="text-xs font-semibold text-[#4338ca]">Internal Branch transfer · Sale ₱0</p>
                    <p className="mt-1 text-[10px] text-[#4338ca]/75">PINs will be in transit and cannot be used until this Branch receives the complete batch.</p>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-xl border border-[#1a7a4a]/20 bg-[#e8f7ef]/60 p-3">
                    <p className="text-xs font-semibold text-[#1a7a4a]">Paid City Distributor sale</p>
                    <select value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })}
                      className="w-full text-xs border border-[#0D1B3E]/15 rounded-lg px-3 py-2 outline-none focus:border-[#C9A84C] bg-white">
                      <option value="cash">Cash / official receipt</option>
                      <option value="gcash">GCash</option>
                      <option value="bank_transfer">Bank transfer</option>
                    </select>
                    <input value={form.payment_reference} maxLength={120}
                      onChange={e => setForm({ ...form, payment_reference: e.target.value })}
                      placeholder="Official receipt / payment reference *"
                      className="w-full text-xs border border-[#0D1B3E]/15 rounded-lg px-3 py-2 outline-none focus:border-[#C9A84C] bg-white" />
                    <input value={form.payment_sender_name} maxLength={120}
                      onChange={e => setForm({ ...form, payment_sender_name: e.target.value })}
                      placeholder="Payer / sender name *"
                      className="w-full text-xs border border-[#0D1B3E]/15 rounded-lg px-3 py-2 outline-none focus:border-[#C9A84C] bg-white" />
                    <input type="datetime-local" value={form.payment_datetime}
                      onChange={e => setForm({ ...form, payment_datetime: e.target.value })}
                      className="w-full text-xs border border-[#0D1B3E]/15 rounded-lg px-3 py-2 outline-none focus:border-[#C9A84C] bg-white" />
                  </div>
                )
              )}
              {/* Quantity */}
              <div>
                <label className="text-xs font-semibold text-[#0D1B3E] mb-1.5 block">Quantity</label>
                <input type="number" min="1" max="50" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })}
                  className="w-full text-sm border border-[#0D1B3E]/15 rounded-xl px-3 py-2.5 outline-none focus:border-[#C9A84C] bg-[#f8f9fc]" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[#0D1B3E] mb-1.5 block">Notes (optional)</label>
                <textarea value={form.notes} maxLength={500} rows={2}
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Custody or payment notes"
                  className="w-full resize-none text-xs border border-[#0D1B3E]/15 rounded-xl px-3 py-2 outline-none focus:border-[#C9A84C] bg-[#f8f9fc]" />
              </div>

              {formError && <p className="text-xs text-[#e05252] bg-[#fdecea] px-3 py-2 rounded-lg">{formError}</p>}


              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[#0D1B3E]/15 text-xs font-medium text-gray-500 hover:bg-[#f8f9fc] transition-colors">
                  Close
                </button>
                <button onClick={handleGenerate} disabled={formLoading}
                  className="flex-1 py-2.5 rounded-xl bg-[#C9A84C] text-white text-xs font-bold hover:bg-[#b8963e] transition-colors disabled:opacity-50">
                  {formLoading ? 'Recording...' : isBranchTransfer ? 'Dispatch PINs' : 'Record Sale & Issue'}
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
                  <p className="text-sm font-bold text-[#1a7a4a]">
                    {issuanceResult.transaction_type === 'internal_transfer' ? 'Branch PIN Transfer Dispatched' : 'Paid PIN Sale Recorded'}
                  </p>
                  <p className="text-[10px] text-[#1a7a4a]/70">
                    {issuanceResult.transaction_type === 'internal_transfer'
                      ? 'PINs remain unusable until the Branch receives the complete batch'
                      : 'PINs are funded by the recorded paid receipt'}
                  </p>
                </div>
              </div>
              <button onClick={() => { setShowSuccessModal(false); setGeneratedPins([]) }}
                className="text-gray-400 hover:text-[#0D1B3E]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="p-6">
              <div className="mb-4 rounded-xl border border-[#0D1B3E]/8 bg-[#f8f9fc] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Ledger reference</p>
                <p className="font-mono text-xs font-semibold text-[#0D1B3E]">{issuanceResult.reference_number || '—'}</p>
                {issuanceResult.message && <p className="mt-1 text-[10px] text-gray-500">{issuanceResult.message}</p>}
              </div>
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
                  className="flex-1 py-2.5 rounded-xl bg-[#010521] text-white text-xs font-bold hover:bg-[#1A2F5E] transition-colors">
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
            <div className="mb-3 rounded-xl border border-[#e05252]/15 bg-[#fff8f7] px-3 py-2">
              <p className="text-[11px] font-semibold text-[#0D1B3E] mb-1">Selected PINs</p>
              <p className="max-h-20 overflow-y-auto break-all font-mono text-[11px] leading-5 text-gray-600">
                {pins.filter((pin) => selectedIds.includes(pin.id)).map((pin) => pin.pin_code).join(', ')}
              </p>
            </div>
            <label className="block text-xs font-semibold text-[#0D1B3E] mb-1" htmlFor="pin-cancellation-disposition">Financial disposition</label>
            <select id="pin-cancellation-disposition" value={cancelDisposition}
              onChange={(event) => { setCancelDisposition(event.target.value as typeof cancelDisposition); setCancelReference(''); setCancelError('') }}
              className="mb-3 w-full rounded-xl border border-[#0D1B3E]/15 px-3 py-2 text-xs text-[#0D1B3E] outline-none focus:border-[#e05252]">
              <option value="retained">Retained by Hiroma (no refund/credit)</option>
              <option value="refunded">Refunded</option>
              <option value="credited">Credited to customer</option>
            </select>
            {cancelDisposition !== 'retained' && (
              <>
                <label className="block text-xs font-semibold text-[#0D1B3E] mb-1" htmlFor="pin-cancellation-reference">
                  {cancelDisposition === 'refunded' ? 'Refund reference' : 'Credit reference'}
                </label>
                <input id="pin-cancellation-reference" value={cancelReference} maxLength={120}
                  onChange={(event) => { setCancelReference(event.target.value); setCancelError('') }}
                  placeholder="Official reference *"
                  className="mb-3 w-full rounded-xl border border-[#0D1B3E]/15 px-3 py-2 text-xs text-[#0D1B3E] outline-none focus:border-[#e05252]" />
              </>
            )}
            <label className="block text-xs font-semibold text-[#0D1B3E] mb-1" htmlFor="pin-cancellation-reason">Cancellation reason</label>
            <textarea id="pin-cancellation-reason" value={cancelReason} maxLength={500} rows={3}
              onChange={(event) => { setCancelReason(event.target.value); setCancelError('') }}
              placeholder="Example: PIN order was issued incorrectly"
              className="mb-3 w-full resize-none rounded-xl border border-[#0D1B3E]/15 px-3 py-2 text-xs text-[#0D1B3E] outline-none focus:border-[#e05252] focus:ring-2 focus:ring-[#e05252]/10" />
            {cancelError && <p className="text-xs text-[#e05252] mb-3">{cancelError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setShowConfirm(false); setCancelError(''); setCancelReason(''); setCancelDisposition('retained'); setCancelReference('') }} disabled={cancelling}
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
