'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stats {
  user:    { full_name: string; username: string }
  package: { name: string; price: number; direct_referral_bonus: number; pairing_bonus_value: number; point_php_value: number } | null
  city_dist: { full_name: string; username: string } | null
  wallet:  { balance: number; total_earned: number; total_withdrawn: number }
  tree:    { left_count: number; right_count: number; position: string | null; sponsor: { full_name: string; username: string } | null }
  rank: {
    current:       string
    total_pu:      number
    ranks:         { id: string; name: string; sequence: number; required_pu: number; pair_income: number }[]
    active_period: { start_date: string; end_date: string } | null
  }
  points:  { total: number; reset_at: string | null; php_value: number }
  referrals: { today: number; remaining: number; cap: number }
  commission_summary: {
    direct_referral: { amount: number; count: number }
    binary_pairing:  { amount: number; count: number }
    multilevel:      { amount: number; count: number }
    sponsor_point:   { amount: number; count: number }
  }
  recent_commissions: {
    type: string; amount: number; points: number | null
    created_at: string
    source_user: { full_name: string; username: string } | null
  }[]
}

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
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function StatCard({ label, value, sub, accent, href }: {
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

// ── Rank Card ──

const RANK_PALETTE = [
  { bg: '#fef6e4', text: '#9a6f1e', bar: '#C9A84C' },
  { bg: '#f0f2f5', text: '#6b7280', bar: '#9ca3af' },
  { bg: '#fef9ee', text: '#b7860b', bar: '#eab308' },
  { bg: '#f0f7ff', text: '#2563eb', bar: '#2563eb' },
  { bg: '#e8f7ef', text: '#1a7a4a', bar: '#1a7a4a' },
]
const BASE_COLORS = { bg: '#eef0f8', text: '#0D1B3E', bar: '#0D1B3E' }

function RankCard({ rankData, packagePointValue }: {
  rankData: {
    current: string; total_pu: number
    ranks: { id: string; name: string; sequence: number; required_pu: number; pair_income: number }[]
    active_period: { start_date: string; end_date: string } | null
  }
  packagePointValue: number
}) {
  const [showPopover, setShowPopover] = useState(false)
  const ranks          = [...rankData.ranks].sort((a, b) => a.sequence - b.sequence)
  const currentRankObj = ranks.find(r => r.name === rankData.current) || null
  const effectivePoints = currentRankObj ? Number(currentRankObj.pair_income) : packagePointValue
  const currentIdx     = currentRankObj ? ranks.indexOf(currentRankObj) : -1
  const nextRank       = currentIdx >= 0 ? (ranks[currentIdx + 1] || null) : (ranks[0] || null)
  const colors         = currentRankObj
    ? (RANK_PALETTE[(currentRankObj.sequence - 1) % RANK_PALETTE.length] || RANK_PALETTE[0])
    : BASE_COLORS
  const totalPU        = rankData.total_pu
  const progressPct    = !rankData.active_period
    ? 0
    : !nextRank
    ? 100
    : currentRankObj
    ? Math.min(100, Math.round(((totalPU - currentRankObj.required_pu) / (nextRank.required_pu - currentRankObj.required_pu)) * 100))
    : Math.min(100, Math.round((totalPU / (nextRank.required_pu || 1)) * 100))
  const puToNext = nextRank ? Math.max(0, nextRank.required_pu - totalPU) : 0

  return (
    <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
      style={{ borderTop: `2px solid ${colors.bar}` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🏅</span>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Your Rank</p>
            <p className="text-base font-bold" style={{ color: colors.text }}>
              {currentRankObj ? currentRankObj.name : 'Base'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">Pair Income</p>
          <p className="text-lg font-bold" style={{ color: colors.text }}>
            {effectivePoints} pts
            <span className="text-xs font-normal text-gray-400"> = ₱{(effectivePoints * 0.50).toFixed(2)}/pair</span>
          </p>
        </div>
      </div>

      {rankData.active_period ? (
        <p className="text-[10px] text-gray-400 mb-2">
          Period: {new Date(rankData.active_period.start_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
          {' – '}
          {new Date(rankData.active_period.end_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      ) : (
        <p className="text-[10px] text-[#a03030] mb-2">No active rank period — using base package points</p>
      )}

      <div className="mb-2">
        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
          <span className="font-medium" style={{ color: colors.text }}>{totalPU} PU earned</span>
          {nextRank
            ? <span>{puToNext} PU to <span className="font-medium">{nextRank.name}</span></span>
            : <span className="text-[#C9A84C] font-medium">Max Rank! 🎉</span>
          }
        </div>
        <div className="w-full h-3 rounded-full overflow-hidden" style={{ backgroundColor: colors.bg }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${progressPct}%`, backgroundColor: colors.bar }} />
        </div>
        {nextRank && (
          <div className="flex justify-between text-[9px] text-gray-300 mt-0.5">
            <span>{currentRankObj?.name || 'Base'}</span>
            <span>{nextRank.name} ({nextRank.required_pu} PU)</span>
          </div>
        )}
      </div>

      <button onClick={() => setShowPopover(!showPopover)}
        className="text-[10px] text-gray-400 hover:text-[#0D1B3E] transition-colors mt-1">
        {showPopover ? '▲ Hide ranks' : '▼ View all ranks'}
      </button>

      {showPopover && (
        <div className="mt-3 border-t border-[#0D1B3E]/8 pt-3 space-y-2">
          {!rankData.active_period && (
            <p className="text-[10px] text-[#a03030] text-center mb-2">Rank period inactive — using base points</p>
          )}
          {ranks.map((rank) => {
            const isCurrentRank = rank.name === rankData.current && !!rankData.active_period
            const isAchieved    = totalPU >= rank.required_pu && !!rankData.active_period
            const rc            = RANK_PALETTE[(rank.sequence - 1) % RANK_PALETTE.length] || RANK_PALETTE[0]
            return (
              <div key={rank.id || rank.name}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 ${isCurrentRank ? 'border-2' : 'border border-transparent'}`}
                style={{
                  backgroundColor: isCurrentRank ? rc.bg : isAchieved ? rc.bg + '80' : '#f9fafb',
                  borderColor:     isCurrentRank ? rc.bar : 'transparent',
                }}>
                <span className="text-lg">{isAchieved ? '⭐' : '🔒'}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-xs font-semibold ${isAchieved ? '' : 'text-gray-300'}`}
                      style={isAchieved ? { color: rc.text } : {}}>
                      {rank.name}
                    </p>
                    {isCurrentRank && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium text-white"
                        style={{ backgroundColor: rc.bar }}>Current</span>
                    )}
                  </div>
                  <p className={`text-[10px] ${isAchieved ? 'text-gray-400' : 'text-gray-300'}`}>
                    {rank.required_pu} PU required
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${isAchieved ? '' : 'text-gray-300'}`}
                    style={isAchieved ? { color: rc.text } : {}}>
                    {rank.pair_income} pts
                  </p>
                  <p className={`text-[9px] ${isAchieved ? 'text-gray-400' : 'text-gray-300'}`}>
                    ₱{(rank.pair_income * 0.50).toFixed(2)}/pair
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Page ──

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
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!stats || !stats.user) return <p className="text-center text-gray-400 text-sm py-20">Failed to load dashboard.</p>

  const totalPoints  = stats.points?.total    || 0
  const phpValue     = stats.points?.php_value || 0
  const pointsValue  = totalPoints * phpValue
  const walletBal    = stats.wallet?.balance        || 0
  const walletEarned = stats.wallet?.total_earned   || 0
  const leftCount    = stats.tree?.left_count        || 0
  const rightCount   = stats.tree?.right_count       || 0
  const refToday     = stats.referrals?.today        || 0
  const refCap       = stats.referrals?.cap          || 10
  const refRemaining = stats.referrals?.remaining    || 0

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

      {/* Rank Card */}
      {stats.rank && (
        <RankCard rankData={stats.rank} packagePointValue={stats.package?.point_php_value || 5} />
      )}

      {/* Wallet + Points + Tree */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Wallet Balance" value={fmt(walletBal)}    sub={`Earned: ${fmt(walletEarned)}`} accent="#C9A84C" href="/dashboard/reseller/wallet" />
        <StatCard label="Points"         value={totalPoints.toLocaleString()} sub={`≈ ${fmt(pointsValue)}`} accent="#1a7a4a" href="/dashboard/reseller/points" />
        <StatCard label="Left Leg"       value={leftCount.toLocaleString()}   sub="Downline count" accent="#2563eb" href="/dashboard/reseller/tree" />
        <StatCard label="Right Leg"      value={rightCount.toLocaleString()}  sub="Downline count" accent="#9a6f1e" href="/dashboard/reseller/tree" />
      </div>

      {/* Commission Summary + Referral */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white rounded-xl border border-[#0D1B3E]/8 p-5">
          <p className="text-sm font-semibold text-[#0D1B3E] mb-4">Commission Summary</p>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(stats.commission_summary || {}).map(([type, data]) => (
              <div key={type} className="rounded-xl p-3 border border-[#0D1B3E]/8">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-2 h-2 rounded-full" style={{ background: COMMISSION_COLORS[type] }} />
                  <p className="text-[10px] text-gray-400">{COMMISSION_LABELS[type]}</p>
                </div>
                <p className="text-base font-semibold text-[#0D1B3E]">{fmt(Number(data.amount || 0))}</p>
                <p className="text-[10px] text-gray-400">{data.count} transactions</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
            <p className="text-xs font-semibold text-[#0D1B3E] mb-3">Daily Referral Cap</p>
            <div className="flex items-end justify-between mb-2">
              <p className="text-2xl font-semibold text-[#0D1B3E]">{refToday}</p>
              <p className="text-xs text-gray-400">/ {refCap} today</p>
            </div>
            <div className="w-full bg-[#F0F2F8] rounded-full h-2">
              <div className="h-2 rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (refToday / refCap) * 100)}%`,
                  background: refRemaining === 0 ? '#e05252' : '#C9A84C',
                }} />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              {refRemaining === 0 ? 'Daily cap reached. Resets tomorrow.' : `${refRemaining} referrals remaining today`}
            </p>
          </div>

          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
            <p className="text-xs font-semibold text-[#0D1B3E] mb-3">Tree Info</p>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Position</span>
                <span className="font-medium text-[#0D1B3E] capitalize">{stats.tree?.position || '—'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Sponsor</span>
                <span className="font-medium text-[#0D1B3E]">{stats.tree?.sponsor?.full_name || '—'}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Total Downline</span>
                <span className="font-medium text-[#0D1B3E]">{(leftCount + rightCount).toLocaleString()}</span>
              </div>
            </div>
            <Link href="/dashboard/reseller/tree" className="block text-center text-xs text-[#C9A84C] mt-3 hover:underline">
              View Tree →
            </Link>
          </div>
        </div>
      </div>

      {/* Recent Commissions */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-center justify-between">
          <p className="text-sm font-semibold text-[#0D1B3E]">Recent Commissions</p>
          <Link href="/dashboard/reseller/commissions" className="text-xs text-[#C9A84C] hover:underline">View all →</Link>
        </div>
        {(stats.recent_commissions || []).length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">No commissions yet.</p>
        ) : (
          (stats.recent_commissions || []).map((c, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3 border-b border-[#0D1B3E]/5 last:border-0">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: COMMISSION_COLORS[c.type] + '20' }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: COMMISSION_COLORS[c.type] }} />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{COMMISSION_LABELS[c.type]}</p>
                  {c.source_user && <p className="text-[10px] text-gray-400">from @{c.source_user.username}</p>}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-[#0D1B3E]">{fmt(Number(c.amount))}</p>
                {c.points && <p className="text-[10px] text-gray-400">+{c.points} pts</p>}
                <p className="text-[10px] text-gray-400">{new Date(c.created_at).toLocaleDateString('en-PH')}</p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'View Tree',      href: '/dashboard/reseller/tree',      icon: '🌳' },
          { label: 'Genealogy',      href: '/dashboard/reseller/genealogy', icon: '👥' },
          { label: 'Request Payout', href: '/dashboard/reseller/wallet',    icon: '💸' },
          { label: 'Order History',  href: '/dashboard/reseller/orders',    icon: '🛒' },
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