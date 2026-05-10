'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ============================================================
// TYPES
// ============================================================

interface Stats {
  user:    { full_name: string; username: string }
  package: { name: string; price: number; direct_referral_bonus: number; pairing_bonus_value: number; point_php_value: number } | null
  city_dist: { full_name: string; username: string } | null
  wallet:  { balance: number; total_earned: number; total_withdrawn: number }
  tree:    { left_count: number; right_count: number; position: string | null; sponsor: { full_name: string; username: string } | null }
  points:  { total: number; reset_at: string | null; php_value: number }
  referrals: { today: number; remaining: number; cap: number }
  commission_summary: {
    direct_referral: { amount: number; count: number }
    binary_pairing:  { amount: number; count: number }
    multilevel:      { amount: number; count: number }
    sponsor_point:   { amount: number; count: number }
  }
  recent_commissions: {
    type: string
    amount: number
    points: number | null
    created_at: string
    source_user: { full_name: string; username: string } | null
  }[]
}

// ============================================================
// HELPERS
// ============================================================

const COMMISSION_LABELS: Record<string, string> = {
  direct_referral: 'Direct Referral',
  binary_pairing:  'Binary Pairing',
  multilevel:      'Multi-level',
  sponsor_point:   'Sponsor Point',
}

const COMMISSION_COLORS: Record<string, string> = {
  direct_referral: '#C9A84C',
  binary_pairing:  '#0D1B3E',
  multilevel:      '#2563eb',
  sponsor_point:   '#1a7a4a',
}

function fmt(n: number) {
  return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ============================================================
// STAT CARD
// ============================================================

function StatCard({
  label, value, sub, accent, href,
}: {
  label: string; value: string; sub?: string; accent: string; href?: string
}) {
  const inner = (
    <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 h-full"
      style={{ borderTop: `2px solid ${accent}` }}>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-xl font-semibold text-[#0D1B3E] truncate">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
  if (href) return <Link href={href} className="block hover:scale-[1.01] transition-transform">{inner}</Link>
  return inner
}

// ============================================================
// PAGE
// ============================================================

export default function ResellerDashboardPage() {
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/reseller/stats')
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!stats) {
    return <p className="text-center text-gray-400 text-sm py-20">Failed to load dashboard.</p>
  }

  const pointsValue = stats.points.total * stats.points.php_value

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Welcome */}
      <div className="bg-[#0D1B3E] rounded-2xl p-5 flex items-center justify-between">
        <div>
          <p className="text-[#C9A84C] text-xs uppercase tracking-widest mb-1">Welcome back</p>
          <h1 className="text-white text-xl font-semibold">{stats.user.full_name}</h1>
          <p className="text-white/40 text-xs mt-0.5">@{stats.user.username}</p>
          {stats.package && (
            <span className="inline-block mt-2 bg-[#C9A84C]/20 text-[#C9A84C] text-xs px-3 py-1 rounded-full">
              {stats.package.name}
            </span>
          )}
        </div>
        <div className="text-right hidden sm:block">
          <p className="text-white/40 text-xs">Registered under</p>
          <p className="text-white text-sm font-medium">{stats.city_dist?.full_name || '—'}</p>
          <p className="text-white/40 text-xs">@{stats.city_dist?.username || '—'}</p>
        </div>
      </div>

      {/* Wallet + Points + Tree */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Wallet Balance"
          value={fmt(stats.wallet.balance)}
          sub={`Earned: ${fmt(stats.wallet.total_earned)}`}
          accent="#C9A84C"
          href="/dashboard/reseller/wallet"
        />
        <StatCard
          label="Points"
          value={stats.points.total.toLocaleString()}
          sub={`≈ ${fmt(pointsValue)}`}
          accent="#1a7a4a"
          href="/dashboard/reseller/points"
        />
        <StatCard
          label="Left Leg"
          value={stats.tree.left_count.toLocaleString()}
          sub="Downline count"
          accent="#2563eb"
          href="/dashboard/reseller/tree"
        />
        <StatCard
          label="Right Leg"
          value={stats.tree.right_count.toLocaleString()}
          sub="Downline count"
          accent="#9a6f1e"
          href="/dashboard/reseller/tree"
        />
      </div>

      {/* Commission Summary + Referral cap */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Commission breakdown */}
        <div className="md:col-span-2 bg-white rounded-xl border border-[#0D1B3E]/8 p-5">
          <p className="text-sm font-semibold text-[#0D1B3E] mb-4">Commission Summary</p>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(stats.commission_summary).map(([type, data]) => (
              <div key={type} className="rounded-xl p-3 border border-[#0D1B3E]/8">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: COMMISSION_COLORS[type] }} />
                  <p className="text-[10px] text-gray-400">{COMMISSION_LABELS[type]}</p>
                </div>
                <p className="text-base font-semibold text-[#0D1B3E]">{fmt(data.amount)}</p>
                <p className="text-[10px] text-gray-400">{data.count} transactions</p>
              </div>
            ))}
          </div>
        </div>

        {/* Referral cap + tree info */}
        <div className="space-y-4">

          {/* Daily referral cap */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
            <p className="text-xs font-semibold text-[#0D1B3E] mb-3">Daily Referral Cap</p>
            <div className="flex items-end justify-between mb-2">
              <p className="text-2xl font-semibold text-[#0D1B3E]">{stats.referrals.today}</p>
              <p className="text-xs text-gray-400">/ {stats.referrals.cap} today</p>
            </div>
            <div className="w-full bg-[#F0F2F8] rounded-full h-2">
              <div
                className="h-2 rounded-full transition-all"
                style={{
                  width: `${(stats.referrals.today / stats.referrals.cap) * 100}%`,
                  background: stats.referrals.remaining === 0 ? '#e05252' : '#C9A84C',
                }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {stats.referrals.remaining === 0
                ? 'Daily cap reached. Resets tomorrow.'
                : `${stats.referrals.remaining} referrals remaining today`}
            </p>
          </div>

          {/* Tree position */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
            <p className="text-xs font-semibold text-[#0D1B3E] mb-3">Tree Info</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Position</span>
                <span className="font-medium text-[#0D1B3E] capitalize">{stats.tree.position || '—'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Sponsor</span>
                <span className="font-medium text-[#0D1B3E]">{stats.tree.sponsor?.full_name || '—'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Total Downline</span>
                <span className="font-medium text-[#0D1B3E]">{(stats.tree.left_count + stats.tree.right_count).toLocaleString()}</span>
              </div>
            </div>
            <Link href="/dashboard/reseller/tree"
              className="block text-center text-xs text-[#C9A84C] mt-3 hover:underline">
              View Tree →
            </Link>
          </div>
        </div>
      </div>

      {/* Recent Commissions */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between">
          <p className="text-sm font-semibold text-[#0D1B3E]">Recent Commissions</p>
          <Link href="/dashboard/reseller/commissions"
            className="text-xs text-[#C9A84C] hover:underline">View all →</Link>
        </div>

        {stats.recent_commissions.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">No commissions yet.</p>
        ) : (
          stats.recent_commissions.map((c, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3 border-b border-[#0D1B3E]/5 last:border-0">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: COMMISSION_COLORS[c.type] + '20' }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: COMMISSION_COLORS[c.type] }} />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{COMMISSION_LABELS[c.type]}</p>
                  {c.source_user && (
                    <p className="text-[10px] text-gray-400">from @{c.source_user.username}</p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-[#0D1B3E]">{fmt(Number(c.amount))}</p>
                {c.points && <p className="text-[10px] text-gray-400">+{c.points} pts</p>}
                <p className="text-[10px] text-gray-400">
                  {new Date(c.created_at).toLocaleDateString('en-PH')}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'View Tree',      href: '/dashboard/reseller/tree',       icon: '🌳' },
          { label: 'Referral Link',  href: '/dashboard/reseller/referral',   icon: '🔗' },
          { label: 'Request Payout', href: '/dashboard/reseller/wallet',     icon: '💸' },
          { label: 'Order History',  href: '/dashboard/reseller/orders',     icon: '🛒' },
        ].map((q) => (
          <Link key={q.href} href={q.href}
            className="bg-white rounded-xl border border-[#0D1B3E]/8 px-4 py-3 flex items-center gap-3 hover:border-[#C9A84C] hover:bg-[#fef9ee] transition-colors group">
            <span className="text-lg">{q.icon}</span>
            <span className="text-xs font-medium text-[#0D1B3E] group-hover:text-[#9a6f1e]">{q.label}</span>
          </Link>
        ))}
      </div>

    </div>
  )
}