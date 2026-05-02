'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ============================================================
// TYPES
// ============================================================

interface DashboardStats {
  totalResellers: number
  totalDistributors: number
  pendingPayouts: number
  pendingPayoutsAmount: number
  pinsSoldToday: number
  newResellersToday: number
  totalProducts: number
  activePins: number
}

interface RecentReseller {
  id: string
  full_name: string
  username: string
  address: string | null
  created_at: string
  reseller_profile: {
    package: { name: string }
  } | null
}

interface RecentPayout {
  id: string
  amount: number
  requested_at: string
  user: { full_name: string; username: string }
}

// ============================================================
// STAT CARD
// ============================================================

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: 'gold' | 'navy'
}) {
  return (
    <div
      className="bg-white rounded-xl p-4 border border-[#0D1B3E]/8"
      style={{
        borderTop: `2px solid ${accent === 'gold' ? '#C9A84C' : '#0D1B3E'}`,
      }}
    >
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p
        className="text-2xl font-semibold"
        style={{ color: accent === 'gold' ? '#C9A84C' : '#0D1B3E' }}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [recentResellers, setRecentResellers] = useState<RecentReseller[]>([])
  const [recentPayouts, setRecentPayouts] = useState<RecentPayout[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/stats').then((r) => r.json()),
      fetch('/api/admin/resellers/recent').then((r) => r.json()),
      fetch('/api/admin/payouts/recent').then((r) => r.json()),
    ])
      .then(([statsData, resellersData, payoutsData]) => {
        setStats(statsData.stats)
        setRecentResellers(resellersData.resellers || [])
        setRecentPayouts(payoutsData.payouts || [])
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">
            Dashboard overview
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {new Date().toLocaleDateString('en-PH', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/admin/pins"
            className="bg-[#0D1B3E] text-white text-xs font-medium rounded-lg px-4 py-2 hover:bg-[#1A2F5E] transition-colors"
          >
            Generate PIN
          </Link>
          <Link
            href="/dashboard/admin/distributors/new"
            className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors"
          >
            + Add distributor
          </Link>
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total resellers"
          value={stats?.totalResellers?.toLocaleString() || '0'}
          sub={`+${stats?.newResellersToday || 0} today`}
          accent="navy"
        />
        <StatCard
          label="PINs sold today"
          value={stats?.pinsSoldToday || 0}
          sub={`${stats?.activePins || 0} active PINs`}
          accent="gold"
        />
        <StatCard
          label="Pending payouts"
          value={`₱${stats?.pendingPayoutsAmount?.toLocaleString() || '0'}`}
          sub={`${stats?.pendingPayouts || 0} requests`}
          accent="navy"
        />
        <StatCard
          label="Distributors"
          value={stats?.totalDistributors || 0}
          sub="Across 3 levels"
          accent="gold"
        />
      </div>

      {/* ── Main Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

        {/* Recent Resellers */}
        <div className="md:col-span-2 bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/8">
            <h2 className="text-sm font-semibold text-[#0D1B3E]">
              Recent reseller registrations
            </h2>
            <Link
              href="/dashboard/admin/resellers"
              className="text-xs text-[#C9A84C] hover:underline font-medium"
            >
              View all
            </Link>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-4 px-4 py-2 bg-[#F0F2F8]">
            {['Name', 'City', 'Package', 'Date'].map((h) => (
              <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">
                {h}
              </p>
            ))}
          </div>

          {/* Rows */}
          {recentResellers.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              No resellers yet
            </div>
          ) : (
            recentResellers.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-4 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors"
              >
                <div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{r.full_name}</p>
                  <p className="text-xs text-gray-400">@{r.username}</p>
                </div>
                <p className="text-xs text-gray-400 self-center">
                  {r.address || '—'}
                </p>
                <span className="self-center">
                  <span className="text-xs bg-[#fef6e4] text-[#9a6f1e] px-2 py-0.5 rounded-full">
                    {r.reseller_profile?.package?.name || '—'}
                  </span>
                </span>
                <p className="text-xs text-gray-400 self-center">
                  {new Date(r.created_at).toLocaleDateString('en-PH')}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-4">

          {/* Quick Actions */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
            <h2 className="text-sm font-semibold text-[#0D1B3E] mb-3">
              Quick actions
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Generate PIN', href: '/dashboard/admin/pins', icon: '🔑', gold: true },
                { label: 'Approve payout', href: '/dashboard/admin/payouts', icon: '💸', gold: false },
                { label: 'Add product', href: '/dashboard/admin/products/new', icon: '🧴', gold: false },
                { label: 'Set tier value', href: '/dashboard/admin/tiers', icon: '⚙️', gold: true },
              ].map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className="flex flex-col gap-1.5 bg-[#F0F2F8] hover:bg-[#e4e7f0] rounded-lg p-3 transition-colors"
                >
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center text-xs"
                    style={{ background: action.gold ? '#C9A84C' : '#0D1B3E' }}
                  >
                    {action.icon}
                  </div>
                  <p className="text-xs font-medium text-[#0D1B3E] leading-tight">
                    {action.label}
                  </p>
                </Link>
              ))}
            </div>
          </div>

          {/* Recent Payouts */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden flex-1">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/8">
              <h2 className="text-sm font-semibold text-[#0D1B3E]">
                Pending payouts
              </h2>
              <Link
                href="/dashboard/admin/payouts"
                className="text-xs text-[#C9A84C] hover:underline font-medium"
              >
                View all
              </Link>
            </div>
            {recentPayouts.length === 0 ? (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">
                No pending payouts
              </div>
            ) : (
              recentPayouts.map((payout) => (
                <div
                  key={payout.id}
                  className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50"
                >
                  <div>
                    <p className="text-xs font-medium text-[#0D1B3E]">
                      {payout.user.full_name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(payout.requested_at).toLocaleDateString('en-PH')}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#C9A84C]">
                    ₱{Number(payout.amount).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>

        </div>
      </div>

      {/* ── Bottom Stats Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Products summary */}
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
          <h2 className="text-sm font-semibold text-[#0D1B3E] mb-3">
            Catalog summary
          </h2>
          <div className="flex flex-col gap-2">
            {[
              { label: 'Total products', value: stats?.totalProducts || 0 },
              { label: 'Active PINs', value: stats?.activePins || 0 },
              { label: 'Total distributors', value: stats?.totalDistributors || 0 },
            ].map((item) => (
              <div key={item.label} className="flex justify-between items-center py-1.5 border-b border-[#0D1B3E]/5">
                <span className="text-xs text-gray-400">{item.label}</span>
                <span className="text-xs font-semibold text-[#0D1B3E]">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Hiroma node info */}
        <div className="bg-[#0D1B3E] rounded-xl p-4 md:col-span-2">
          <h2 className="text-sm font-semibold text-white mb-1">
            Hiroma network overview
          </h2>
          <p className="text-white/50 text-xs mb-4">
            Top-level binary tree node — collects daily cap overflow
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total resellers', value: stats?.totalResellers?.toLocaleString() || '0' },
              { label: 'Daily referral cap', value: '10 / reseller' },
              { label: 'Daily pairs cap', value: '12 / reseller' },
            ].map((item) => (
              <div key={item.label} className="bg-white/5 rounded-lg p-3 border border-white/10">
                <p className="text-white/40 text-xs mb-1">{item.label}</p>
                <p className="text-[#C9A84C] text-sm font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}