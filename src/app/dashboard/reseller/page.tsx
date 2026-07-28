'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import styles from './reseller-theme.module.css'

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
  referrals: { today: number; remaining: number; cap: number; cap_enabled: boolean }
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
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [dataSearchResults, setDataSearchResults] = useState<GlobalSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return DASHBOARD_SEARCH_ITEMS.slice(0, 5)
    const navigationResults = DASHBOARD_SEARCH_ITEMS.filter((item) =>
      `${item.title} ${item.description} ${item.keywords}`.toLowerCase().includes(query)
    )
    return [...dataSearchResults, ...navigationResults].slice(0, 12)
  }, [dataSearchResults, searchQuery])

  useEffect(() => {
    fetch('/api/reseller/stats')
      .then((r) => r.json())
      .then(setStats)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const query = searchQuery.trim()
    if (query.length < 2) {
      setDataSearchResults([])
      setSearchLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setSearchLoading(true)
      try {
        const response = await fetch(`/api/reseller/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
        const data = await response.json()
        if (response.ok) setDataSearchResults(data.results || [])
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setDataSearchResults([])
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false)
      }
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [searchQuery])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        setSearchOpen(true)
      }
      if (event.key === 'Escape') {
        setSearchOpen(false)
        searchInputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
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
  const refCapEnabled = stats.referrals?.cap_enabled !== false
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

  const firstName        = stats.user.full_name.split(' ')[0]
  const directBonus      = stats.package?.direct_referral_bonus || 0
  const potentialEarnings = refRemaining * directBonus

  return (
    <>
      <div className={styles.premiumDashboard}>
        <section className={styles.premiumHero}>
          <div className={styles.heroTechnology} aria-hidden="true">
            <i /><i /><i /><i /><i /><i /><i />
            <b /><b /><b /><b /><b />
          </div>
          <div className={styles.heroSearch}>
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
                setSearchOpen(true)
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
              placeholder="Search your dashboard..."
              aria-label="Search your dashboard"
              aria-expanded={searchOpen}
              aria-controls="dashboard-search-results"
            />
            {searchQuery ? (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setSearchQuery('')
                  searchInputRef.current?.focus()
                }}
                aria-label="Clear search"
              >
                ×
              </button>
            ) : <kbd>Ctrl K</kbd>}
            {searchOpen && (
              <div id="dashboard-search-results" className={styles.heroSearchResults}>
                <small>{searchQuery ? 'Search results' : 'Quick access'}</small>
                {searchLoading && <div className={styles.heroSearchLoading}>Searching your account…</div>}
                {searchResults.length ? searchResults.map((item) => (
                  <Link key={item.id} href={item.href}>
                    <em>{item.category}</em>
                    <span>{item.title}</span>
                    <small>{item.description}</small>
                    <b aria-hidden="true">→</b>
                  </Link>
                )) : (
                  <p>No dashboard result found for “{searchQuery}”.</p>
                )}
              </div>
            )}
          </div>
          <div className={styles.heroWelcome}>
            <span className={styles.heroEyebrow}>HIROMA DIGITAL NETWORK</span>
            <h1>Good afternoon, {firstName}! 👋</h1>
            <p>Stay focused and keep growing your network. You&apos;re doing great!</p>
            <div className={styles.heroPulse}><i /> Network is active</div>
          </div>
          <div className={styles.premiumHeroCards}>
            <article className={styles.potentialCard}>
              <span>🎁 Today&apos;s Potential Earnings</span>
              <strong>{fmt(potentialEarnings)}</strong>
              <small><b>{refRemaining} referrals</b> to earn {fmt(directBonus)} more!</small>
              <div className={styles.miniChart} aria-hidden="true">
                <i /><i /><i /><i /><i /><i /><i />
              </div>
              <div className={styles.earningProgress}><i style={{ width: `${Math.min(100, (refToday / Math.max(1, refCap)) * 100)}%` }} /></div>
            </article>
            <article className={styles.balanceCard}>
              <span>▣ Total Wallet Balance</span>
              <strong>{fmt(walletBal)}</strong>
              <Link href="/dashboard/reseller/wallet">Withdraw</Link>
              <div className={styles.walletSignal} aria-hidden="true"><i /><i /><i /></div>
            </article>
          </div>
        </section>

        <section className={styles.statusRibbon}>
          <article><i>🏅</i><span>Active Rank</span><strong>{currentRankObj?.name || stats.package?.name || 'Starter'}</strong><small>Next Rank: {nextRank?.name || 'Maximum'}</small></article>
          <article><i>◔</i><span>Rank Progress</span><strong>{progressPct}%</strong><small>{puToNext ? `${puToNext} PU remaining` : 'Goal completed'}</small><em><b style={{ width: `${progressPct}%` }} /></em></article>
          <article><i>↗</i><span>Network Strength</span><strong className={styles.green}>High</strong><small>Keep up the momentum!</small></article>
          <article><i>⚖</i><span>Binary Status</span><strong className={styles.cyan}>Balanced</strong><small>Well done!</small></article>
          <article><i>✓</i><span>Account Status</span><strong className={styles.green}>Verified</strong><small>All systems operational</small></article>
        </section>

        <div className={styles.premiumMainGrid}>
          <div className={styles.premiumLeft}>
            <section className={`${styles.premiumPanel} ${styles.walletVisual}`}>
              <div>
                <h2>Wallet Overview</h2>
                <span>Total Balance</span>
                <strong>{fmt(walletBal)}</strong>
                <small>▲ +{fmt(stats.wallet?.total_earned || 0)} lifetime</small>
                <Link href="/dashboard/reseller/wallet">▣ View Wallet</Link>
              </div>
              <div className={styles.walletOrb}>💳</div>
            </section>

            <section className={`${styles.premiumPanel} ${styles.referralCompact}`}>
              <h2>Daily Referral Cap</h2>
              <CircularProgress value={refCapEnabled ? refToday : 0} max={refCap} label={refCapEnabled ? 'Per Day' : 'No Cap'} />
              <div>
                <strong>{refCapEnabled ? refRemaining : '∞'}</strong>
                <span>{refCapEnabled ? 'referrals remaining' : 'unlimited referrals'}</span>
                <small>{refToday} credited today</small>
              </div>
            </section>

            <section className={`${styles.premiumPanel} ${styles.premiumEarnings}`}>
              <h2>Earnings Breakdown</h2>
              <div className={styles.earningsContent}>
                <DonutChart data={donutData} />
                <div>
                  {donutData.map((item) => {
                    const percent = totalEarned ? Math.round((item.value / totalEarned) * 100) : 0
                    return <div className={styles.earningLine} key={item.label}>
                      <span><i style={{ background: item.color }} />{item.label}<b>{percent}%</b></span>
                      <em><i style={{ width: `${percent}%`, background: item.color }} /></em>
                      <small>{fmt(item.value)}</small>
                    </div>
                  })}
                </div>
              </div>
            </section>
          </div>

          <div className={styles.premiumCenter}>
            <section className={`${styles.premiumPanel} ${styles.premiumTeam}`}>
              <header><h2>Team Overview</h2><Link href="/dashboard/reseller/tree">View Tree →</Link></header>
              <div className={styles.premiumLegs}>
                <article><i>👤</i><strong>{leftCount}</strong><span>Left Team</span><small>Members</small></article>
                <article><i>👤</i><strong>{rightCount}</strong><span>Right Team</span><small>Members</small></article>
              </div>
              <dl>
                <div><dt>Total Affiliates</dt><dd>{leftCount + rightCount}</dd></div>
                <div><dt>Position</dt><dd>{stats.tree?.position || '—'}</dd></div>
                <div><dt>Sponsor</dt><dd>{stats.tree?.sponsor?.full_name || 'Hiroma'}</dd></div>
              </dl>
              <Link className={styles.treeButton} href="/dashboard/reseller/tree">🌳 View Binary Tree</Link>
            </section>

            <section className={`${styles.premiumPanel} ${styles.premiumCommissions}`}>
              <header><h2>Recent Commissions</h2><Link href="/dashboard/reseller/commissions">View All →</Link></header>
              {(stats.recent_commissions || []).slice(0, 4).map((item, index) => (
                <article key={`${item.created_at}-${index}`}>
                  <i>{COMM_ICONS[item.type] || '💼'}</i>
                  <div><strong>{COMM_LABELS[item.type] || item.type}</strong><span>from @{item.source_user?.username || 'Hiroma'}</span></div>
                  <b>+{fmt(Number(item.amount))}<small>{new Date(item.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</small></b>
                </article>
              ))}
            </section>
          </div>

          <div className={styles.premiumRight}>
            <section className={`${styles.premiumPanel} ${styles.liveActivity}`}>
              <header><h2><i /> Live Activity</h2><Link href="/dashboard/reseller/notifications">View All →</Link></header>
              {[
                ['👤', `${stats.user.full_name} viewed the dashboard`, 'Just now'],
                ['🔥', `${firstName} earned ${fmt(stats.commission_summary?.direct_referral?.amount || 0)}`, 'Recent'],
                ['🟣', `Your affiliate network reached ${leftCount + rightCount}`, 'Today'],
                ['🔗', `${stats.commission_summary?.binary_pairing?.count || 0} binary pairs matched`, 'Today'],
                ['💵', `Wallet balance updated to ${fmt(walletBal)}`, 'Current'],
              ].map(([icon, text, time]) => <article key={text}><i>{icon}</i><span>{text}</span><small>{time}</small></article>)}
            </section>

            <section className={`${styles.premiumPanel} ${styles.aiPanel}`}>
              <div className={styles.aiNetwork} aria-hidden="true">
                <i /><i /><i /><i /><i /><i />
              </div>
              <div className={styles.aiCube} aria-hidden="true"><span>AI</span></div>
              <div className={styles.aiCopy}>
                <h2>Hiroma AI Insights <b>NEW</b></h2>
                <strong>Your network is growing.</strong>
                <p>Invite {Math.max(1, refRemaining)} more people to maximize your binary earnings.</p>
                <Link href="/dashboard/reseller/tree" aria-label="View AI network insight">⌁</Link>
              </div>
              <div className={styles.aiBrain} aria-hidden="true">
                <span>AI</span>
                <i /><i /><i /><i />
              </div>
            </section>

            <section className={styles.growthCard}>
              <h2>Keep Growing,<br />Keep Earning!</h2>
              <p>Your success is our mission.<br />Let&apos;s build your legacy together.</p>
              <div className={styles.growthChart} aria-hidden="true">
                <span className={styles.growthStars}>· ✦ ·</span>
                <span className={styles.growthBar} />
                <span className={styles.growthBar} />
                <span className={styles.growthBar} />
                <span className={styles.growthBar} />
                <span className={styles.growthBar} />
                <i className={styles.growthLine} />
                <b className={styles.growthArrow}>➤</b>
              </div>
            </section>
          </div>
        </div>

        <section className={`${styles.premiumPanel} ${styles.achievements}`}>
          <header><h2>Achievements</h2><Link href="/dashboard/reseller/points">View All →</Link></header>
          <div>
            {[
              ['✓', 'First Sale', 'Completed', true],
              ['●', 'First Referral', 'Completed', true],
              ['★', 'Bronze Qualified', currentRankObj ? 'Completed' : 'In progress', Boolean(currentRankObj)],
              ['★', 'Silver Qualified', 'Locked', false],
              ['★', 'Gold Qualified', 'Locked', false],
              ['◇', 'Diamond Qualified', 'Locked', false],
            ].map(([icon, title, status, complete]) => (
              <article className={complete ? styles.achievementDone : ''} key={title as string}>
                <i><b>{icon}</b></i><strong>{title}</strong><span>{status}</span>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className={`w-full space-y-5 ${styles.dashboard} ${styles.classicDashboard}`}>

      {/* ── Welcome Banner ── */}
      <div className={`bg-gradient-to-br from-[#0D1B3E] via-[#1a2f5e] to-[#0D1B3E] rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 overflow-hidden relative ${styles.welcome}`}>
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
        <div className="relative z-10 flex items-center gap-3">
          {/* Potential Earnings */}
          <div className="bg-white/8 backdrop-blur rounded-2xl px-5 py-4 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">🎁</span>
              <p className="text-white/50 text-xs">Today's Potential Earnings</p>
            </div>
            <p className="text-2xl font-bold text-white">{fmt(potentialEarnings)}</p>
            {refRemaining > 0 ? (
              <p className="text-white/40 text-[11px] mt-1">
                <span className="text-[#C9A84C] font-semibold">{refRemaining} referral{refRemaining !== 1 ? 's' : ''}</span> to earn <span className="text-[#C9A84C] font-semibold">{fmt(directBonus)}</span> more!
              </p>
            ) : (
              <p className="text-white/40 text-[11px] mt-1">Cap reached. Resets tomorrow 🎉</p>
            )}
          </div>

          {/* Wallet */}
          <div className="bg-white/8 backdrop-blur rounded-2xl px-5 py-4 border border-white/10 text-right">
            <p className="text-white/50 text-xs mb-1">Total Wallet Balance</p>
            <p className="text-2xl font-bold text-white">{fmt(walletBal)}</p>
            <Link href="/dashboard/reseller/wallet"
              className="inline-block mt-2 bg-[#C9A84C] text-[#0D1B3E] text-xs px-4 py-1.5 rounded-full font-bold hover:bg-[#b8953f] transition-colors">
              Withdraw →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Top Stat Cards ── */}
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${styles.statGrid}`}>
        {[
          { label: 'Total Earned',   value: fmt(walletEarned),              sub: 'Lifetime earnings',    color: '#1a7a4a', icon: '💰', href: '/dashboard/reseller/wallet' },
          { label: 'Total Points',   value: totalPoints.toLocaleString(),        sub: `≈ ${fmt(pointsValue)}`, color: '#C9A84C', icon: '⭐', href: '/dashboard/reseller/points' },
          { label: 'Left Affiliates',  value: leftCount.toLocaleString(),          sub: 'Affiliate members',    color: '#2563eb', icon: '👥', href: '/dashboard/reseller/tree' },
          { label: 'Right Affiliates', value: rightCount.toLocaleString(),         sub: 'Affiliate members',    color: '#9a6f1e', icon: '👥', href: '/dashboard/reseller/tree' },
        ].map((s) => (
          <Link key={s.label} href={s.href}
            className={`bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:border-[#C9A84C]/40 hover:shadow-sm transition-all group ${styles.statCard}`}>
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
      <div className={`grid grid-cols-1 md:grid-cols-3 xl:grid-cols-3 gap-4 ${styles.middleGrid}`}>

        {/* Rank Progress */}
        <div className={`bg-white rounded-2xl border border-[#0D1B3E]/8 p-5 ${styles.panel} ${styles.rankPanel}`}>
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
        <div className={`bg-white rounded-2xl border border-[#0D1B3E]/8 p-5 ${styles.panel} ${styles.teamPanel}`}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-[#0D1B3E]">Team Overview</p>
            <Link href="/dashboard/reseller/tree" className="text-[10px] text-[#C9A84C] hover:underline">View Tree →</Link>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className={`bg-[#f0f7ff] rounded-xl p-4 text-center ${styles.teamTile} ${styles.teamTileLeft}`}>
              <p className="text-3xl xl:text-4xl font-bold text-[#2563eb]">{leftCount}</p>
              <p className="text-xs text-gray-400 mt-1">Left Team</p>
              <p className="text-[10px] text-[#2563eb] mt-0.5">Members</p>
            </div>
            <div className={`bg-[#fef9ee] rounded-xl p-4 text-center ${styles.teamTile} ${styles.teamTileRight}`}>
              <p className="text-3xl xl:text-4xl font-bold text-[#9a6f1e]">{rightCount}</p>
              <p className="text-xs text-gray-400 mt-1">Right Team</p>
              <p className="text-[10px] text-[#9a6f1e] mt-0.5">Members</p>
            </div>
          </div>

          <div className="border-t border-[#0D1B3E]/5 pt-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total Affiliates</span>
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
        <div className={`space-y-4 ${styles.sideStack}`}>
          {/* Referral cap */}
          <div className={`bg-white rounded-2xl border border-[#0D1B3E]/8 p-5 ${styles.panel} ${styles.referralPanel}`}>
            <p className="text-sm font-semibold text-[#0D1B3E] mb-3">Daily Referral Cap</p>
            <div className="flex items-center gap-4">
              <CircularProgress value={refCapEnabled ? refToday : 0} max={refCap} label={refCapEnabled ? 'Per Day' : 'No Cap'} />
              <div className="flex-1">
                <p className="text-2xl font-bold text-[#0D1B3E]">{refCapEnabled ? refRemaining : '∞'}</p>
                <p className="text-xs text-gray-400">{refCapEnabled ? 'referrals remaining' : 'unlimited referrals'}</p>
                <p className="text-[10px] text-gray-300 mt-1">
                  {refCapEnabled && refRemaining === 0 ? 'Cap reached. Resets tomorrow.' : `${refToday} credited today`}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className={`bg-white rounded-2xl border border-[#0D1B3E]/8 p-4 ${styles.panel} ${styles.quickPanel}`}>
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
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${styles.bottomGrid}`}>

        {/* Earnings Breakdown */}
        <div className={`bg-white rounded-2xl border border-[#0D1B3E]/8 p-5 ${styles.panel} ${styles.earningsPanel}`}>
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
        <div className={`bg-white rounded-2xl border border-[#0D1B3E]/8 p-5 ${styles.panel} ${styles.commissionsPanel}`}>
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
    </>
  )
}

const DASHBOARD_SEARCH_ITEMS = [
  { id: 'nav-dashboard', title: 'Dashboard overview', description: 'Account summary and performance', href: '/dashboard/reseller', keywords: 'home overview account performance', category: 'Page' },
  { id: 'nav-tree', title: 'Binary Tree', description: 'View your left and right affiliate network', href: '/dashboard/reseller/tree', keywords: 'genealogy left right network team downline', category: 'Page' },
  { id: 'nav-affiliates', title: 'Affiliates', description: 'View your registered affiliates', href: '/dashboard/reseller/genealogy', keywords: 'referrals members genealogy downline', category: 'Page' },
  { id: 'nav-rank', title: 'Rank Advancement', description: 'Review PU and rank progress', href: '/dashboard/reseller/points', keywords: 'rank points pu bronze silver gold progress', category: 'Page' },
  { id: 'nav-wallet', title: 'Wallet & Earnings', description: 'Balances and commission history', href: '/dashboard/reseller/wallet', keywords: 'wallet balance income earnings commission direct referral binary product binary', category: 'Page' },
  { id: 'nav-payouts', title: 'Payouts', description: 'Track withdrawal and payout status', href: '/dashboard/reseller/payouts', keywords: 'withdraw withdrawal released pending approved rejected cash', category: 'Page' },
  { id: 'nav-payment', title: 'Payment Method', description: 'Manage your approved payout account', href: '/dashboard/reseller/payment-methods', keywords: 'gcash bank account payment payout method', category: 'Page' },
  { id: 'nav-orders', title: 'My Orders', description: 'Place and monitor product orders', href: '/dashboard/reseller/orders', keywords: 'orders history products pending processing delivered cancelled supplier', category: 'Page' },
  { id: 'nav-notifications', title: 'Notifications', description: 'See commissions and account updates', href: '/dashboard/reseller/notifications', keywords: 'alerts updates bell unread activity', category: 'Page' },
] as const

type GlobalSearchResult = {
  id: string
  title: string
  description: string
  href: string
  category: string
}
