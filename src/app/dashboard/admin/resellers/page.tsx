'use client'

import { useState, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

interface Reseller {
  id: string
  full_name: string
  username: string
  mobile: string
  address: string | null
  status: string
  created_at: string
  reseller_profile: {
    total_points: number
    daily_referral_count: number
    daily_pairs_count: number
    package: { name: string; price: number } | null
  } | null
  wallet: { balance: number } | null
}

// ============================================================
// PAGE
// ============================================================

export default function ResellersPage() {
  const [resellers, setResellers] = useState<Reseller[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'suspended'>('all')
  const [selected, setSelected] = useState<Reseller | null>(null)

  const fetchResellers = () => {
    setLoading(true)
    fetch('/api/admin/resellers')
      .then((r) => r.json())
      .then((data) => setResellers(data.resellers || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchResellers() }, [])

  const filtered = resellers.filter((r) => {
    const matchStatus = statusFilter === 'all' || r.status === statusFilter
    const matchSearch =
      r.full_name.toLowerCase().includes(search.toLowerCase()) ||
      r.username.toLowerCase().includes(search.toLowerCase()) ||
      (r.address || '').toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const handleStatusChange = async (userId: string, newStatus: string) => {
    await fetch(`/api/admin/resellers/${userId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    fetchResellers()
    setSelected(null)
  }

  const totalActive = resellers.filter((r) => r.status === 'active').length
  const totalSuspended = resellers.filter((r) => r.status === 'suspended').length
  const totalWalletBalance = resellers.reduce(
    (acc, r) => acc + Number(r.wallet?.balance || 0), 0
  )

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
          { label: 'Total resellers', value: resellers.length, accent: 'navy' },
          { label: 'Active', value: totalActive, accent: 'gold' },
          { label: 'Suspended', value: totalSuspended, accent: 'navy' },
          { label: 'Total wallet balance', value: `₱${totalWalletBalance.toLocaleString()}`, accent: 'gold' },
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
            {(['all', 'active', 'inactive', 'suspended'] as const).map((f) => (
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
        <div className="grid grid-cols-6 px-4 py-2 bg-[#F0F2F8]">
          {['Reseller', 'Package', 'Points', 'Wallet', 'Status', 'Action'].map((h) => (
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
              className="grid grid-cols-6 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center"
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

              {/* Status */}
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  r.status === 'active'
                    ? 'bg-[#e8f7ef] text-[#1a7a4a]'
                    : r.status === 'suspended'
                    ? 'bg-[#fdecea] text-[#a03030]'
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
      </div>

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">

            {/* Modal Header */}
            <div className="bg-[#0D1B3E] px-6 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">Reseller details</h2>
              <button
                onClick={() => setSelected(null)}
                className="text-white/50 hover:text-white text-lg cursor-pointer"
              >
                ✕
              </button>
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
                {selected.status !== 'suspended' && (
                  <button
                    onClick={() => handleStatusChange(selected.id, 'suspended')}
                    className="flex-1 bg-[#fdecea] text-[#a03030] text-xs font-semibold rounded-lg py-2.5 hover:bg-[#fbd5d5] transition-colors"
                  >
                    ✕ Suspend
                  </button>
                )}
                {selected.status !== 'inactive' && (
                  <button
                    onClick={() => handleStatusChange(selected.id, 'inactive')}
                    className="flex-1 bg-[#F0F2F8] text-gray-400 text-xs font-semibold rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors"
                  >
                    Deactivate
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}