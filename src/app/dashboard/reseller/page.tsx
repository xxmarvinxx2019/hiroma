'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stats {
  user:      { full_name: string; username: string }
  package:   { name: string; price: number; direct_referral_bonus: number; pairing_bonus_value: number; point_php_value: number } | null
  city_dist: { full_name: string; username: string } | null
  wallet:    { balance: number; total_earned: number; total_withdrawn: number }
  tree:      { left_count: number; right_count: number; position: string | null; sponsor: { full_name: string; username: string } | null }
  rank: {
    current: string; total_pu: number
    ranks: { id: string; name: string; sequence: number; required_pu: number; pair_income: number }[]
    active_period: { start_date: string; end_date: string } | null
  }
  points:    { total: number; reset_at: string | null; php_value: number }
  referrals: { today: number; remaining: number; cap: number }
  commission_summary: {
    direct_referral: { amount: number; count: number }
    binary_pairing:  { amount: number; count: number }
    sponsor_point:   { amount: number; count: number }
  }
  recent_commissions: {
    type: string; amount: number; points: number | null
    created_at: string
    source_user: { full_name: string; username: string } | null
  }[]
}

const fmt = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtShort = (n: number) => {
  if (n >= 1000000) return `₱${(n/1000000).toFixed(1)}M`
  if (n >= 1000)    return `₱${(n/1000).toFixed(1)}K`
  return fmt(n)
}

const COMM_LABELS: Record<string, string> = {
  direct_referral: 'Direct Referral',
  binary_pairing:  'Binary Pairing',
  sponsor_point:   'Product Binary',
}
const COMM_COLORS: Record<string, string> = {
  direct_referral: '#3b82f6',
  binary_pairing:  '#8b5cf6',
  sponsor_point:   '#f59e0b',
}
const COMM_ICONS: Record<string, string> = {
  direct_referral: '👥',
  binary_pairing:  '🔗',
  sponsor_point:   '⭐',
}

const RANK_PALETTE = [
  { bg: '#fef6e4', text: '#9a6f1e', bar: '#C9A84C', light: '#fef6e4' },
  { bg: '#f0f2f5', text: '#6b7280', bar: '#9ca3af', light: '#f0f2f5' },
  { bg: '#fef9ee', text: '#b7860b', bar: '#eab308', light: '#fef9ee' },
  { bg: '#f0f7ff', text: '#2563eb', bar: '#2563eb', light: '#f0f7ff' },
  { bg: '#e8f7ef', text: '#1a7a4a', bar: '#1a7a4a', light: '#e8f7ef' },
]
const BASE_COLORS = { bg: '#eef0f8', text: '#0D1B3E', bar: '#0D1B3E', light: '#eef0f8' }

// ── Donut Chart ──
function DonutChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return (
    <div className="w-32 h-32 rounded-full border-8 border-gray-100 flex items-center justify-center">
      <p className="text-xs text-gray-300">No data</p>
    </div>
  )

  let cumulative = 0
  const radius = 54; const cx = 64; const cy = 64
  const circumference = 2 * Math.PI * radius

  const slices = data.map((d) => {
    const pct   = d.value / total
    const offset = circumference * (1 - cumulative - pct)
    const dash   = circumference * pct
    cumulative  += pct
    return { ...d, pct, dash, offset }
  })

  return (
    <div className="relative">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#f1f5f9" strokeWidth="16" />
        {slices.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={radius} fill="none"
            stroke={s.color} strokeWidth="16"
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={s.offset}
            strokeLinecap="butt"
            style={{ transform: 'rotate(-90deg)', transformOrigin: '64px 64px', transition: 'stroke-dasharray 0.5s' }}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-lg font-bold text-[#0D1B3E]">{fmtShort(total)}</p>
        <p className="text-[10px] text-gray-400">Total</p>
      </div>
    </div>
  )
}

// ── Circular Progress ──
function CircularProgress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = Math.min(1, value / max)
  const r   = 36; const cx = 44; const cy = 44
  const circ = 2 * Math.PI * r
  const dash  = circ * pct
  const color = pct >= 1 ? '#e05252' : '#C9A84C'

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width="88" height="88" viewBox="0 0 88 88">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke={color} strokeWidth="8"
            strokeDasharray={`${dash} ${circ - dash}`}
            strokeDashoffset={circ / 4}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.5s', transform: 'rotate(-90deg)', transformOrigin: '44px 44px' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-xl font-bold text-[#0D1B3E]">{value}</p>
          <p className="text-[9px] text-gray-400">/ {max}</p>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
    </div>
  )
}

export default function ResellerDashboardPage() {
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/reseller/stats')
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-7 h-7 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!stats || !stats.user) return (
    <p className="text-center text-gray-400 text-sm py-20">Failed to load dashboard.</p>
  )

  const walletBal     = stats.wallet?.balance        || 0
  const walletEarned  = stats.wallet?.total_earned   || 0
  const totalPoints   = stats.points?.total          || 0
  const phpValue      = stats.points?.php_value      || 0
  const pointsValue   = totalPoints * phpValue * 0.5
  const leftCount     = stats.tree?.left_count       || 0
  const rightCount    = stats.tree?.right_count      || 0
  const refToday      = stats.referrals?.today       || 0
  const refCap        = stats.referrals?.cap         || 10
  const refRemaining  = stats.referrals?.remaining   || 0
  const totalEarned   = (stats.commission_summary?.direct_referral?.amount || 0)
    + (stats.commission_summary?.binary_pairing?.amount  || 0)
    + (stats.commission_summary?.sponsor_point?.amount   || 0)


  // Rank
  const ranks          = [...(stats.rank?.ranks || [])].sort((a, b) => a.sequence - b.sequence)
  const totalPU        = stats.rank?.total_pu || 0
  const currentRankObj = ranks.find(r => r.name === stats.rank?.current) || null
  const nextRank       = currentRankObj ? ranks[ranks.indexOf(currentRankObj) + 1] || null : ranks[0] || null
  const effectivePts   = currentRankObj ? Number(currentRankObj.pair_income) : (stats.package?.point_php_value || 5)
  const rankColors     = currentRankObj ? (RANK_PALETTE[(currentRankObj.sequence - 1) % RANK_PALETTE.length] || RANK_PALETTE[0]) : BASE_COLORS
  const progressPct    = !stats.rank?.active_period ? 0 : !nextRank ? 100
    : currentRankObj
    ? Math.min(100, Math.round(((totalPU - currentRankObj.required_pu) / (nextRank.required_pu - currentRankObj.required_pu)) * 100))
    : Math.min(100, Math.round((totalPU / (nextRank.required_pu || 1)) * 100))
  const puToNext = nextRank ? Math.max(0, nextRank.required_pu - totalPU) : 0

  // Donut data
  const donutData = [
    { label: 'Direct Referral', value: stats.commission_summary?.direct_referral?.amount || 0, color: COMM_COLORS.direct_referral },
    { label: 'Binary Pairing',  value: stats.commission_summary?.binary_pairing?.amount  || 0, color: COMM_COLORS.binary_pairing  },
    { label: 'Product Binary',   value: stats.commission_summary?.sponsor_point?.amount   || 0, color: COMM_COLORS.sponsor_point   },
  ].filter(d => d.value > 0)

  const firstName = stats.user.full_name.split(' ')[0]

  return (
    <div className="w-full space-y-5">

      {/* ── Welcome Banner ── */}
      <div className="bg-gradient-to-br from-[#0D1B3E] via-[#1a2f5e] to-[#0D1B3E] rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#C9A84C]/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-32 w-32 h-32 bg-white/3 rounded-full translate-y-1/2" />
        <div className="relative z-10">
          <p className="text-[#C9A84C] text-xs uppercase tracking-widest mb-1">Welcome back</p>
          <h1 className="text-white text-2xl xl:text-3xl font-bold">{firstName} 👋</h1>
          <p className="text-white/50 text-sm mt-1">@{stats.user.username}</p>
          {stats.package && (
            <span className="inline-block mt-2 bg-[#C9A84C]/20 text-[#C9A84C] text-xs px-3 py-1 rounded-full font-medium border border-[#C9A84C]/30">
              {stats.package.name}
            </span>
          )}
        </div>
        <div className="relative z-10 bg-white/8 backdrop-blur rounded-2xl px-6 py-4 border border-white/10 text-right">
          <p className="text-white/50 text-xs mb-1">Total Wallet Balance</p>
          <p className="text-3xl xl:text-4xl font-bold text-white">{fmt(walletBal)}</p>
          <Link href="/dashboard/reseller/wallet"
            className="inline-block mt-2 bg-[#C9A84C] text-[#0D1B3E] text-xs px-4 py-1.5 rounded-full font-bold hover:bg-[#b8953f] transition-colors">
            Withdraw →
          </Link>
        </div>
      </div>

      {/* ── Top Stat Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Earned',   value: fmtShort(walletEarned),              sub: 'Lifetime earnings',    color: '#1a7a4a', icon: '💰', href: '/dashboard/reseller/wallet' },
          { label: 'Total Points',   value: totalPoints.toLocaleString(),        sub: `≈ ${fmt(pointsValue)}`, color: '#C9A84C', icon: '⭐', href: '/dashboard/reseller/points' },
          { label: 'Left Leg',       value: leftCount.toLocaleString(),          sub: 'Downline members',     color: '#2563eb', icon: '👥', href: '/dashboard/reseller/tree' },
          { label: 'Right Leg',      value: rightCount.toLocaleString(),         sub: 'Downline members',     color: '#9a6f1e', icon: '👥', href: '/dashboard/reseller/tree' },
        ].map((s) => (
          <Link key={s.label} href={s.href}
            className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:border-[#C9A84C]/40 hover:shadow-sm transition-all group">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">{s.label}</p>
              <span className="text-lg">{s.icon}</span>
            </div>
            <p className="text-xl xl:text-2xl font-bold group-hover:text-[#0D1B3E]" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-1">{s.sub}</p>
          </Link>
        ))}
      </div>

      {/* ── Middle Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-3 gap-4">

        {/* Rank Progress */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-[#0D1B3E]">Rank Progress</p>
            {stats.rank?.active_period && (
              <span className="text-[10px] text-[#1a7a4a] bg-[#e8f7ef] px-2 py-0.5 rounded-full">Active</span>
            )}
          </div>

          {/* Current rank display */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
              style={{ backgroundColor: rankColors.light }}>
              🏅
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide">Current Rank</p>
              <p className="text-xl font-bold" style={{ color: rankColors.text }}>
                {currentRankObj ? currentRankObj.name : (stats.package?.name || 'Base')}
              </p>
              {nextRank && (
                <p className="text-[10px] text-gray-400">
                  Next: <span className="font-medium text-[#0D1B3E]">{nextRank.name}</span>
                </p>
              )}
            </div>
            {nextRank && (
              <div className="text-right">
                <p className="text-2xl font-bold text-[#0D1B3E]">{progressPct}%</p>
                <p className="text-[10px] text-gray-400">Progress</p>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="w-full h-3 rounded-full bg-[#f1f5f9] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${progressPct}%`, backgroundColor: rankColors.bar }} />
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-gray-400">
              <span>{totalPU} PU earned</span>
              {nextRank
                ? <span>{puToNext} PU to {nextRank.name}</span>
                : <span className="text-[#C9A84C]">Max Rank! 🎉</span>
              }
            </div>
          </div>

          {/* Pair income */}
          <div className="bg-[#f8f9fc] rounded-xl p-3 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-gray-400">Pair Income Rate</p>
              <p className="text-base font-bold text-[#0D1B3E]">{effectivePts} pts<span className="text-xs font-normal text-gray-400"> = ₱{(effectivePts * 0.5).toFixed(2)}/pair</span></p>
            </div>
            {!stats.rank?.active_period && (
              <span className="text-[10px] text-[#a03030] bg-[#fdecea] px-2 py-1 rounded-lg">No active period</span>
            )}
          </div>
        </div>

        {/* Team Overview */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-[#0D1B3E]">Team Overview</p>
            <Link href="/dashboard/reseller/tree" className="text-[10px] text-[#C9A84C] hover:underline">View Tree →</Link>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-[#f0f7ff] rounded-xl p-4 text-center">
              <p className="text-3xl xl:text-4xl font-bold text-[#2563eb]">{leftCount}</p>
              <p className="text-xs text-gray-400 mt-1">Left Team</p>
              <p className="text-[10px] text-[#2563eb] mt-0.5">Members</p>
            </div>
            <div className="bg-[#fef9ee] rounded-xl p-4 text-center">
              <p className="text-3xl xl:text-4xl font-bold text-[#9a6f1e]">{rightCount}</p>
              <p className="text-xs text-gray-400 mt-1">Right Team</p>
              <p className="text-[10px] text-[#9a6f1e] mt-0.5">Members</p>
            </div>
          </div>

          <div className="border-t border-[#0D1B3E]/5 pt-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total Downline</span>
              <span className="font-semibold text-[#0D1B3E]">{(leftCount + rightCount).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Position</span>
              <span className="font-semibold text-[#0D1B3E] capitalize">{stats.tree?.position || '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Sponsor</span>
              <span className="font-semibold text-[#0D1B3E] truncate max-w-[120px]">{stats.tree?.sponsor?.full_name || '—'}</span>
            </div>
          </div>

          <Link href="/dashboard/reseller/tree"
            className="mt-4 w-full flex items-center justify-center gap-2 bg-[#0D1B3E] text-white text-xs font-medium py-2 rounded-xl hover:bg-[#162850] transition-colors">
            <span>🌳</span> View Binary Tree
          </Link>
        </div>

        {/* Daily Referral Cap + Quick Actions */}
        <div className="space-y-4">
          {/* Referral cap */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
            <p className="text-sm font-semibold text-[#0D1B3E] mb-3">Daily Referral Cap</p>
            <div className="flex items-center gap-4">
              <CircularProgress value={refToday} max={refCap} label="Per Day" />
              <div className="flex-1">
                <p className="text-2xl font-bold text-[#0D1B3E]">{refRemaining}</p>
                <p className="text-xs text-gray-400">referrals remaining</p>
                <p className="text-[10px] text-gray-300 mt-1">
                  {refRemaining === 0 ? 'Cap reached. Resets tomorrow.' : `${refToday} used today`}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-4">
            <p className="text-sm font-semibold text-[#0D1B3E] mb-3">Quick Actions</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Wallet',    href: '/dashboard/reseller/wallet',    icon: '💸', color: '#C9A84C' },
                { label: 'Orders',    href: '/dashboard/reseller/orders',    icon: '🛒', color: '#2563eb' },
                { label: 'Tree',      href: '/dashboard/reseller/tree',      icon: '🌳', color: '#1a7a4a' },
                { label: 'Points',    href: '/dashboard/reseller/points',    icon: '⭐', color: '#9a6f1e' },
                { label: 'Commissions', href: '/dashboard/reseller/commissions', icon: '📊', color: '#8b5cf6' },
                { label: 'Profile',   href: '/dashboard/reseller/profile',   icon: '👤', color: '#6b7280' },
              ].map((q) => (
                <Link key={q.href} href={q.href}
                  className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-[#f8f9fc] transition-colors group">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                    style={{ backgroundColor: q.color + '15' }}>
                    {q.icon}
                  </div>
                  <p className="text-[10px] text-gray-400 group-hover:text-[#0D1B3E] text-center leading-tight">{q.label}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Earnings Breakdown */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-[#0D1B3E]">Earnings Breakdown</p>
            <Link href="/dashboard/reseller/commissions" className="text-[10px] text-[#C9A84C] hover:underline">View All →</Link>
          </div>
          <div className="flex items-center gap-6">
            <DonutChart data={donutData} />
            <div className="flex-1 space-y-2">
              {Object.entries(stats.commission_summary || {}).filter(([type, data]) => type !== 'multilevel' && data.amount > 0).map(([type, data]) => {
                const pct = totalEarned > 0 ? Math.round((data.amount / totalEarned) * 100) : 0
                return (
                  <div key={type}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: COMM_COLORS[type] }} />
                        <span className="text-gray-500">{COMM_LABELS[type]}</span>
                      </div>
                      <span className="font-semibold text-[#0D1B3E]">{pct}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, backgroundColor: COMM_COLORS[type] }} />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5 text-right">{fmt(data.amount)}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Recent Commissions */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-[#0D1B3E]">Recent Commissions</p>
            <Link href="/dashboard/reseller/commissions" className="text-[10px] text-[#C9A84C] hover:underline">View All →</Link>
          </div>

          {(stats.recent_commissions || []).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="text-4xl mb-2">📭</span>
              <p className="text-sm text-gray-400">No commissions yet</p>
              <p className="text-xs text-gray-300 mt-1">Start referring to earn!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(stats.recent_commissions || []).map((c, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                    style={{ backgroundColor: (COMM_COLORS[c.type] || '#9ca3af') + '15' }}>
                    {COMM_ICONS[c.type] || '💼'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#0D1B3E]">{COMM_LABELS[c.type] || c.type}</p>
                    {c.source_user && <p className="text-[10px] text-gray-400 truncate">from @{c.source_user.username}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold" style={{ color: COMM_COLORS[c.type] || '#0D1B3E' }}>+{fmt(Number(c.amount))}</p>
                    {c.points && <p className="text-[10px] text-gray-400">+{c.points} pts</p>}
                    <p className="text-[9px] text-gray-300">{new Date(c.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}