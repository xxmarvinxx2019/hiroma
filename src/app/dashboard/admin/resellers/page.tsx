'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from "@/app/components/ui/Pagination"

// ============================================================
// TYPES
// ============================================================

interface Reseller {
  id: string
  full_name: string
  username: string
  email: string | null
  mobile: string
  address: string | null
  status: string
  created_at: string
  reseller_profile: {
    total_points:         number
    daily_referral_count: number
    daily_pairs_count:    number
    package:   { name: string; price: number } | null
    city_dist: {
      full_name: string
      username:  string
      distributor_profile: { coverage_area: string } | null
    } | null
  } | null
  wallet: { balance: number } | null
}

interface Stats {
  total: number
  active: number
  inactive: number
}

// ============================================================
// PAGE
// ============================================================

export default function ResellersPage() {
  const [resellers, setResellers] = useState<Reseller[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [selected, setSelected]   = useState<Reseller | null>(null)
  const [showEdit, setShowEdit]     = useState(false)
  const [editForm, setEditForm]     = useState({ full_name: '', username: '', mobile: '', address: '', email: '', password: '' })
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError]   = useState('')
  const [editSuccess, setEditSuccess] = useState('')
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState<PaginationMeta>({ total: 0, page: 1, pageSize: 15, totalPages: 1 })
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, inactive: 0 })
  const [searchInput, setSearchInput] = useState('')

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [statusFilter, search])

  const fetchResellers = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page), pageSize: '15',
      ...(statusFilter !== 'all' && { status: statusFilter }),
      ...(search && { search }),
    })
    fetch(`/api/admin/resellers?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setResellers(data.resellers || [])
        if (data.meta)  setMeta(data.meta)
        if (data.stats) setStats(data.stats)
        setLoading(false)
      })
  }, [page, statusFilter, search])

  useEffect(() => { fetchResellers() }, [fetchResellers])

  const filtered = resellers

  const handleStatusChange = async (userId: string, newStatus: string) => {
    await fetch(`/api/admin/resellers/${userId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    fetchResellers()
    setSelected(null)
  }

  const openEdit = (r: Reseller) => {
    setEditForm({
      full_name: r.full_name,
      username:  r.username,
      mobile:    r.mobile  || '',
      address:   r.address || '',
      email:     r.email   || '',
      password:  '',
    })
    setEditError('')
    setEditSuccess('')
    setShowEdit(true)
  }

  const handleEditSubmit = async () => {
    if (!selected) return
    if (!editForm.full_name.trim()) { setEditError('Full name is required.'); return }
    console.log('[EDIT] Sending:', { id: selected.id, username: editForm.username, selectedUsername: selected.username })
    setEditLoading(true); setEditError(''); setEditSuccess('')
    const res = await fetch(`/api/admin/resellers/${selected.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm), // includes full_name, username, email, mobile, address
    })
    const data = await res.json()
    setEditLoading(false)
    if (res.ok) {
      setEditSuccess('Reseller updated successfully.')
      fetchResellers()
      setTimeout(() => setShowEdit(false), 1500)
    } else {
      setEditError(data.error || 'Failed to update.')
    }
  }


  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Resellers</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Manage all MLM resellers in the network
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Resellers', value: stats.total,     accent: '#0D1B3E' },
          { label: 'Active',           value: stats.active,    accent: '#1a7a4a' },
          { label: 'Inactive',         value: stats.inactive,  accent: '#C9A84C' },
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
            placeholder="Search by name, username or city..."
            className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
          <div className="flex gap-1">
            {(['all', 'active', 'inactive'] as const).map((f) => (
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
        <div className="grid px-4 py-2 bg-[#F0F2F8]" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1.5fr 1fr 80px' }}>
          {['Reseller', 'Package', 'Points', 'Wallet', 'Registered By', 'Status', 'Action'].map((h) => (
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
            No resellers found
          </div>
        ) : (
          filtered.map((r) => (
            <div
              key={r.id}
              className="grid px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1.5fr 1fr 80px' }}
            >
              {/* Reseller */}
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{r.full_name}</p>
                <p className="text-xs text-gray-400">@{r.username}</p>
                <p className="text-xs text-gray-400">{r.address || '—'}</p>
              </div>

              {/* Package */}
              <span>
                <span className="text-xs bg-[#fef6e4] text-[#9a6f1e] px-2 py-0.5 rounded-full">
                  {r.reseller_profile?.package?.name || '—'}
                </span>
              </span>

              {/* Points */}
              <p className="text-xs font-medium text-[#C9A84C]">
                {r.reseller_profile?.total_points || 0} pts
              </p>

              {/* Wallet */}
              <p className="text-xs font-medium text-[#0D1B3E]">
                ₱{Number(r.wallet?.balance || 0).toLocaleString()}
              </p>

              {/* Registered By */}
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{r.reseller_profile?.city_dist?.full_name || '—'}</p>
                <p className="text-[10px] text-gray-400">{r.reseller_profile?.city_dist?.distributor_profile?.coverage_area || '—'}</p>
                <p className="text-[10px] text-gray-300">{new Date(r.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
              </div>

              {/* Status */}
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  r.status === 'active'
                    ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                    : r.status === 'inactive'
                    ? 'bg-[#fef9ee] text-[#9a6f1e]'
                    : 'bg-[#F0F2F8] text-gray-400'
                }`}>
                  {r.status}
                </span>
              </span>

              {/* Action */}
              <button
                onClick={() => setSelected(r)}
                className="text-xs text-[#C9A84C] hover:underline font-medium text-left"
              >
                View
              </button>
            </div>
          ))
        )}
        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">

            {/* Modal Header */}
            <div className="bg-[#0D1B3E] px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">Reseller details</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEdit(selected)}
                  className="text-[#C9A84C] hover:text-white text-xs font-medium px-2 py-1 rounded border border-[#C9A84C]/40 hover:border-white/30 transition-colors"
                >
                  ✏ Edit
                </button>
                <button
                  onClick={() => setSelected(null)}
                  className="text-white/50 hover:text-white text-lg cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6">
              {/* Info */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-full bg-[#C9A84C]/20 border border-[#C9A84C]/40 flex items-center justify-center">
                  <span className="text-[#C9A84C] font-bold text-lg">
                    {selected.full_name.charAt(0)}
                  </span>
                </div>
                <div>
                  <p className="text-[#0D1B3E] font-semibold">{selected.full_name}</p>
                  <p className="text-gray-400 text-xs">@{selected.username}</p>
                </div>
              </div>

              <div className="flex flex-col gap-2 mb-5">
                {[
                  { label: 'Mobile', value: selected.mobile },
                  { label: 'Address', value: selected.address || '—' },
                  { label: 'Package', value: selected.reseller_profile?.package?.name || '—' },
                  { label: 'Total points', value: `${selected.reseller_profile?.total_points || 0} pts` },
                  { label: 'Wallet balance', value: `₱${Number(selected.wallet?.balance || 0).toLocaleString()}` },
                  { label: 'Daily referrals', value: `${selected.reseller_profile?.daily_referral_count || 0} / 10` },
                  { label: 'Daily pairs', value: `${selected.reseller_profile?.daily_pairs_count || 0} / 12` },
                  { label: 'Registered', value: new Date(selected.created_at).toLocaleDateString('en-PH') },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between py-1.5 border-b border-[#0D1B3E]/5">
                    <span className="text-xs text-gray-400">{item.label}</span>
                    <span className="text-xs font-medium text-[#0D1B3E]">{item.value}</span>
                  </div>
                ))}
              </div>

              {/* Status Actions */}
              <p className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Change status</p>
              <div className="flex gap-2">
                {selected.status !== 'active' && (
                  <button
                    onClick={() => handleStatusChange(selected.id, 'active')}
                    className="flex-1 bg-[#e8f7ef] text-[#1a7a4a] text-xs font-semibold rounded-lg py-2.5 hover:bg-[#d0f0e0] transition-colors"
                  >
                    ✓ Activate
                  </button>
                )}
                {selected.status !== 'inactive' && (
                  <button
                    onClick={() => handleStatusChange(selected.id, 'inactive')}
                    className="flex-1 bg-[#fdecea] text-[#a03030] text-xs font-semibold rounded-lg py-2.5 hover:bg-[#fbd5d5] transition-colors"
                  >
                    ✕ Deactivate
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Reseller Modal */}
      {showEdit && selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#0D1B3E]">Edit Reseller</h2>
                <p className="text-xs text-gray-400 mt-0.5">@{selected.username}</p>
              </div>
              <button onClick={() => setShowEdit(false)} className="text-gray-400 hover:text-[#0D1B3E] text-lg">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Full Name <span className="text-[#C9A84C]">*</span></label>
                <input
                  value={editForm.full_name}
                  onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Username <span className="text-[#C9A84C]">*</span></label>
                <input
                  value={editForm.username}
                  onChange={(e) => setEditForm({ ...editForm, username: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Email</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Mobile</label>
                <input
                  value={editForm.mobile}
                  onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Address</label>
                <input
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  New Password
                  <span className="text-gray-300 ml-1">(leave blank to keep current)</span>
                </label>
                <input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="Enter new password"
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
              </div>
              {editError   && <p className="text-xs text-[#a03030]">{editError}</p>}
              {editSuccess && <p className="text-xs text-[#1a7a4a] bg-[#e8f7ef] px-3 py-2 rounded-lg">{editSuccess}</p>}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowEdit(false)}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors">
                  Cancel
                </button>
                <button onClick={handleEditSubmit} disabled={editLoading}
                  className="flex-1 bg-[#C9A84C] text-white text-sm rounded-lg py-2.5 hover:bg-[#b8963e] transition-colors disabled:opacity-50 font-medium">
                  {editLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}