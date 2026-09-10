'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stats {
  totalRevenueToday: number
  totalRevenueYesterday: number
  netProfitToday: number
  pinRevenueToday: number
  pinRevenueYesterday: number
  digitalCommissionExpenseToday: number
  digitalCommissionExpenseYesterday: number
  digitalNetToday: number
  distributionGrossProfitToday: number
  orderRevenueToday: number
  totalUnitsSoldToday: number
  newResellersToday: number
  newResellersYesterday: number
  newResellersThisMonth: number
  totalResellers: number
  totalDistributors: number
  pendingPayouts: number
  pendingPayoutsAmount: number
  totalProducts: number
  activePins: number
  totalPinsSold: number
  pinsSoldToday: number
  pinRevenue: number
  digitalCommissionExpense: number
  digitalNet: number
  retainedOverflow: number
  retainedOverflowEvents: number
  orderRevenue: number
  orderCost: number
  orderProfit: number
  distributionGrossProfit: number
  chainRevenue: number
  totalRevenue: number
  overallNetProfit: number
  totalUnitsSold: number
  revenueBreakdown: {
    pinRevenue: { package_name: string; channel: string; registrations: number; amount: number }[]
    commissionExpense: { commission_type: string; entries: number; amount: number }[]
    distributionProfit: { product_name: string; units: number; revenue: number; cost: number; profit: number }[]
  }
  monthlyRevenue: { month: string; revenue: number }[]
  lastMonthRevenue: number
  thisMonthRevenue: number
  growthPct: number | null
  monthlyGrowthPct: number
  totalStock: number
  criticalStock: number
  topProducts:         { name: string; total_sold: number; revenue: number }[]
  topCityDistsOverall: TopCityDist[]
  recentOrders: {
    id: string; order_number: string | null; status: string
    total_amount: number; created_at: string
    buyer: {
      full_name: string
      role: string
      distributor_profile?: { dist_level: string } | null
    }
  }[]
  ordersByStatus: { status: string; _count: { status: number } }[]
  regionalSales:  { region_name: string; total: number; count: number }[]
  provinceSales:  { province_name: string; total: number; count: number }[]
  citySales:      { city_muni_name: string; total: number; count: number }[]
  resellerSales:  { full_name: string; total: number; count: number }[]
}

interface RecentReseller {
  id: string; full_name: string; username: string
  address: string | null; created_at: string
  reseller_profile: { package: { name: string } } | null
}

interface RecentPayout {
  id: string; amount: number; requested_at: string
  user: { full_name: string; username: string }
}

interface PinSale {
  id: string; total_amount: number; created_at: string; notes: string | null
  buyer: { full_name: string; username: string }
}

interface TopCityDist {
  id: string; full_name: string; username: string
  revenue: number; pin_orders: number; prod_orders: number
}

interface DistributorSales {
  city_dist_id: string; _count: { id: number }; _sum: { price: number }
  city_distributor: { full_name: string; username: string }
}

interface PackageSales {
  package_id: string; _count: { id: number }
  package: { name: string; price: number }
}

const fmt  = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtS = (n: number) => {
  if (n >= 1000000) return `₱${(n / 1000000).toFixed(2)}M`
  if (n >= 1000)    return `₱${(n / 1000).toFixed(1)}K`
  return fmt(n)
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', processing: '#3b82f6', delivered: '#1a7a4a', cancelled: '#e05252',
}
const STATUS_ICONS: Record<string, string> = {
  pending: '🕐', processing: '📦', delivered: '✅', cancelled: '❌',
}

function StatCard({ label, value, sub, color, icon, badge, href }: {
  label: string; value: string | number; sub?: string
  color?: string; icon?: string; badge?: string; href?: string
}) {
  const accent = color || '#0D1B3E'
  const visibleAccent = accent.toLowerCase() === '#0d1b3e' ? '#C9A84C' : accent
  const inner = (
    <div
      className="group relative h-full overflow-hidden rounded-2xl border border-white/10 border-t-[3px] p-5 text-white transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_14px_28px_rgba(13,27,62,0.18)]"
      style={{
        backgroundColor: '#0D1B3E',
        borderTopColor: visibleAccent,
        boxShadow: '0 7px 16px rgba(13,27,62,0.10)',
      }}
    >
      <div className="relative flex min-h-8 items-start justify-between mb-3">
        {icon && (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg border text-base"
            style={{ backgroundColor: `${visibleAccent}26`, borderColor: `${visibleAccent}73` }}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}
        {badge && (
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: `${visibleAccent}26`, borderColor: `${visibleAccent}73`, color: '#FFFFFF' }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className="relative">
        <p
          className="mb-1 text-xs font-bold uppercase tracking-wide"
          style={{ color: 'rgba(255,255,255,.82)' }}
        >
          {label}
        </p>
        <p className="text-xl font-extrabold tracking-tight text-white">
          {value}
        </p>
        {sub && (
          <p
            className="mt-1 text-[10px] font-medium leading-4"
            style={{ color: 'rgba(255,255,255,.74)' }}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  )
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner
}

interface PeriodMeta {
  key: string
  label: string
  comparisonLabel: string
  from: string
  to: string
}

const parsePinSaleNote = (notes: string | null) => {
  const match = notes?.match(/PIN sale:\s*(\d+)\s*[×x]\s*(.+?)\s+package\s+@\s*₱?([\d,.]+)\s+each/i)
  if (!match) return null

  return {
    quantity: Number(match[1]),
    packageName: match[2].trim(),
    unitPrice: Number(match[3].replace(/,/g, '')),
  }
}

export default function AdminDashboardPage() {
  const [stats, setStats]                     = useState<Stats | null>(null)
  const [selectedRevenueCard, setSelectedRevenueCard] = useState<'pin' | 'commission' | 'digital' | 'distribution' | null>(null)
  const [recentResellers, setRecentResellers] = useState<RecentReseller[]>([])
  const [recentPayouts, setRecentPayouts]     = useState<RecentPayout[]>([])
  const [pinSales, setPinSales]               = useState<PinSale[]>([])
  const [distSales, setDistSales]             = useState<DistributorSales[]>([])
  const [packageSales, setPackageSales]       = useState<PackageSales[]>([])
  const [period, setPeriod]                   = useState<PeriodMeta | null>(null)
  const [periodKey, setPeriodKey]             = useState('today')
  const [customFrom, setCustomFrom]           = useState('')
  const [customTo, setCustomTo]               = useState('')
  const [appliedQuery, setAppliedQuery]       = useState('period=today')
  const [loadError, setLoadError]             = useState('')
  const [loading, setLoading]                 = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    const query = appliedQuery ? `?${appliedQuery}` : ''
    const readJson = async (url: string) => {
      const response = await fetch(url, { signal: controller.signal })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to load dashboard data.')
      return body
    }

    setLoading(true)
    setLoadError('')
    Promise.all([
      readJson(`/api/admin/stats${query}`),
      readJson(`/api/admin/resellers/recent${query}`),
      readJson('/api/admin/payouts/recent'),
      readJson(`/api/admin/pins/sales${query}`),
    ]).then(([s, r, p, ps]) => {
      setStats(s.stats)
      setPeriod(s.period)
      setRecentResellers(r.resellers || [])
      setRecentPayouts(p.payouts || [])
      setPinSales(ps.recentSales || [])
      setDistSales(ps.byDistributor || [])
      setPackageSales(ps.byPackage || [])
    }).catch(error => {
      if (error instanceof Error && error.name !== 'AbortError') {
        setLoadError(error.message)
      }
    }).finally(() => setLoading(false))

    return () => controller.abort()
  }, [appliedQuery])

  useEffect(() => {
    if (!selectedRevenueCard) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedRevenueCard(null)
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [selectedRevenueCard])

  const applyPeriod = () => {
    const params = new URLSearchParams({ period: periodKey })
    if (periodKey === 'custom') {
      if (!customFrom || !customTo) {
        setLoadError('Select both start and end dates for a custom range.')
        return
      }
      params.set('from', customFrom)
      params.set('to', customTo)
    }
    setAppliedQuery(params.toString())
  }

  if (loading && !stats) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">Loading dashboard...</p>
      </div>
    </div>
  )

  const orderStatusMap: Record<string, number> = {}
  stats?.ordersByStatus?.forEach(o => { orderStatusMap[o.status] = o._count.status })

  const today = new Date().toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const hasGrowthBaseline = stats?.growthPct !== null && stats?.growthPct !== undefined
  const isPositiveGrowth = hasGrowthBaseline && (stats?.growthPct || 0) >= 0

  return (
    <div className="w-full space-y-5">

      {/* Header */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B3E]">Executive Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">{today}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-xl border border-[#0D1B3E]/10 bg-white px-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Period</span>
                <select
                  value={periodKey}
                  onChange={event => {
                    setPeriodKey(event.target.value)
                    setLoadError('')
                  }}
                  className="h-7 min-w-28 border-0 bg-transparent px-1 text-xs font-semibold text-[#0D1B3E] outline-none"
                >
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 days</option>
                  <option value="thisMonth">This month</option>
                  <option value="lastMonth">Last month</option>
                  <option value="thisYear">This year</option>
                  <option value="custom">Custom range</option>
                </select>
              </label>
              {periodKey === 'custom' && (
                <>
                  <label className="flex h-9 items-center gap-2 rounded-xl border border-[#0D1B3E]/10 bg-white px-2.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">From</span>
                    <input type="date" value={customFrom} onChange={event => { setCustomFrom(event.target.value); setLoadError('') }} className="h-7 border-0 bg-transparent text-xs text-[#0D1B3E] outline-none" />
                  </label>
                  <label className="flex h-9 items-center gap-2 rounded-xl border border-[#0D1B3E]/10 bg-white px-2.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">To</span>
                    <input type="date" value={customTo} onChange={event => { setCustomTo(event.target.value); setLoadError('') }} className="h-7 border-0 bg-transparent text-xs text-[#0D1B3E] outline-none" />
                  </label>
                </>
              )}
              <button type="button" onClick={applyPeriod} className="h-9 rounded-xl bg-[#0D1B3E] px-4 text-xs font-bold text-white transition-colors hover:bg-[#1A2F5E]">
                Apply
              </button>
          </div>
          <Link href="/dashboard/admin/pins"
            className="flex h-9 items-center bg-[#010521] text-white text-xs font-medium rounded-xl px-4 hover:bg-[#1A2F5E] transition-colors">
            🔑 Generate PIN
          </Link>
          <Link href="/dashboard/admin/distributors"
            className="flex h-9 items-center bg-[#C9A84C] text-[#0D1B3E] text-xs font-bold rounded-xl px-4 hover:bg-[#E8C96A] transition-colors">
            + Add Distributor
          </Link>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="rounded-xl border border-[#D82332]/25 bg-[#D82332]/5 px-4 py-3 text-sm text-[#B4232F]">
          {loadError}
        </div>
      )}

      {/* Row 1 — Selected-period KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label={`Revenue — ${period?.label || 'Today'}`} value={fmt(stats?.totalRevenueToday || 0)} color="#07966F" icon="💰" sub={`Distribution + activated PIN · ${period?.comparisonLabel || 'vs yesterday'}: ${fmt(stats?.totalRevenueYesterday || 0)}`} />
        <StatCard label={`PIN Revenue — ${period?.label || 'Today'}`} value={fmt(stats?.pinRevenueToday || 0)} color="#B17912" icon="🔑" sub={`Recognized on activation · ${period?.comparisonLabel || 'vs yesterday'}: ${fmt(stats?.pinRevenueYesterday || 0)}`} href="/dashboard/admin/pins" />
        <StatCard label={`Product Sales — ${period?.label || 'Today'}`} value={fmt(stats?.orderRevenueToday || 0)} color="#2F6FED" icon="🧴" sub={`${stats?.totalUnitsSoldToday || 0} delivered units`} href="/dashboard/admin/orders" />
        <StatCard label={`Contribution — ${period?.label || 'Today'}`} value={fmt(stats?.netProfitToday || 0)} color="#078DC6" icon="📈" sub="Distribution gross profit + digital net" />
        <StatCard label="Active Products" value={stats?.totalProducts || 0} color="#842FE0" icon="📦" sub="Current active catalog" href="/dashboard/admin/products" badge="As of now" />
      </div>

      {/* Row 2 — Sales breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label={`Registrations — ${period?.label || 'Today'}`} value={stats?.newResellersToday || 0} color="#842FE0" icon="👥" sub={`${period?.comparisonLabel || 'vs yesterday'}: ${stats?.newResellersYesterday || 0}`} href="/dashboard/admin/resellers" badge="Selected period" />
        <StatCard label="Pending Payouts" value={stats?.pendingPayouts || 0} color="#D82332" icon="💸" sub={fmt(stats?.pendingPayoutsAmount || 0)} href="/dashboard/admin/payouts" badge={stats?.pendingPayouts ? 'Action needed' : 'As of now'} />
        <StatCard label="Total Resellers" value={(stats?.totalResellers || 0).toLocaleString()} color="#1759CE" icon="👤" sub={`+${stats?.newResellersThisMonth || 0} this calendar month`} href="/dashboard/admin/resellers" badge="As of now" />
        <StatCard label="Active Distributors" value={stats?.totalDistributors || 0} color="#E84D0E" icon="🗺️" sub="Current active distributor profiles" href="/dashboard/admin/distributors" badge="As of now" />
        <StatCard label="Retained Overflow" value={fmt(stats?.retainedOverflow || 0)} color="#0D1B3E" icon="↩️" sub={`${stats?.retainedOverflowEvents || 0} all-time audited events · View report`} href="/dashboard/admin/commission-testing/flushout-report" badge="Company retained" />
      </div>


      {/* Row 2.5 — Warehouse + Growth + Monthly Chart */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Warehouse Stock */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold text-[#0D1B3E]">Warehouse Stock</p>
            <span className="text-[10px] text-[#8A6A16] bg-[#C9A84C]/10 px-2 py-1 rounded-full">
              As of now · {stats?.totalProducts || 0} products
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-[#0D1B3E]/5 border border-[#0D1B3E]/8 flex items-center justify-center text-2xl flex-shrink-0">📦</div>
            <div className="flex-1">
              <p className="text-3xl font-bold tracking-tight text-[#0D1B3E]">
                {(stats?.totalStock || 0).toLocaleString()} <span className="text-sm font-normal text-gray-400">units</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">Total units currently recorded in inventory</p>
            </div>
          </div>
          <div className="border-t border-[#0D1B3E]/5 mt-4 pt-3 flex items-center justify-between gap-3">
            <p className="text-[10px] uppercase tracking-wide text-gray-400">Stock attention</p>
            <p className={`text-xs font-semibold ${(stats?.criticalStock || 0) > 0 ? 'text-[#D82332]' : 'text-[#1A7A4A]'}`}>
              {(stats?.criticalStock || 0) > 0
                ? `${stats?.criticalStock} critical product${(stats?.criticalStock || 0) !== 1 ? 's' : ''}`
                : 'All products healthy'}
            </p>
          </div>
        </div>

        {/* Growth vs Last Month */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold text-[#0D1B3E]">Growth vs Previous Period</p>
            <span className="text-[10px] text-gray-400 bg-[#f8f9fc] px-2 py-1 rounded-full">{period?.label || 'Today'}</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${!hasGrowthBaseline ? 'bg-[#f1f5f9]' : isPositiveGrowth ? 'bg-[#e8f7ef]' : 'bg-[#fdecea]'}`}>
              {!hasGrowthBaseline ? '➖' : isPositiveGrowth ? '📈' : '📉'}
            </div>
            <div>
              <p className={`font-bold ${!hasGrowthBaseline ? 'text-xl text-[#475569]' : `text-3xl ${isPositiveGrowth ? 'text-[#1a7a4a]' : 'text-[#e05252]'}`}`}>
                {hasGrowthBaseline ? `${isPositiveGrowth ? '+' : ''}${stats?.growthPct}%` : 'No previous revenue'}
              </p>
              <p className="text-xs text-gray-400">{hasGrowthBaseline ? (period?.comparisonLabel || 'vs yesterday') : `Growth cannot be calculated · ${period?.comparisonLabel || 'vs yesterday'}: ${fmt(stats?.totalRevenueYesterday || 0)}`}</p>
            </div>
          </div>
          {/* Mini sparkline */}
          <div className="flex items-end gap-0.5 h-10">
            {(stats?.monthlyRevenue || []).slice(-8).map((m, i, arr) => {
              const max = Math.max(...arr.map(a => a.revenue), 1)
              const h   = Math.max(4, Math.round((m.revenue / max) * 36))
              const isPositive = isPositiveGrowth
              return (
                <div key={i} className="flex-1 rounded-sm"
                  style={{
                    height: h,
                    background: i === arr.length - 1
                      ? (!hasGrowthBaseline ? '#64748B' : isPositive ? '#1A7A4A' : '#D82332')
                      : (!hasGrowthBaseline ? '#E2E8F0' : isPositive ? '#BBF7D0' : '#FECACA'),
                  }} />
              )
            })}
          </div>
        </div>

        {/* Monthly Revenue Chart */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold text-[#0D1B3E]">Monthly Revenue Overview</p>
            <span className="text-[10px] text-gray-400 bg-[#f8f9fc] px-2 py-1 rounded-full">This Year</span>
          </div>
          {/* Bar chart */}
          <div className="flex items-end gap-1 h-24">
            {(stats?.monthlyRevenue || []).map((m, i, arr) => {
              const max = Math.max(...arr.map(a => a.revenue), 1)
              const h   = Math.max(4, Math.round((m.revenue / max) * 88))
              const isLast = i === arr.length - 1
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                  <div className="w-full rounded-t-sm transition-all"
                    style={{ height: h, background: isLast ? '#0D1B3E' : '#bfdbfe' }} />
                  <p className="text-[7px] text-gray-400">{m.month}</p>
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#010521] text-white text-[8px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    {fmt(m.revenue)}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="border-t border-[#0D1B3E]/5 mt-2 pt-2 flex justify-between">
            <div>
              <p className="text-[10px] text-gray-400">Total Revenue (YTD)</p>
              <p className="text-sm font-bold text-[#0D1B3E]">{fmt((stats?.monthlyRevenue || []).reduce((s, m) => s + m.revenue, 0))}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-gray-400">vs Last Month</p>
              <p className={`text-sm font-bold ${(stats?.monthlyGrowthPct || 0) >= 0 ? 'text-[#1a7a4a]' : 'text-[#e05252]'}`}>
                {(stats?.monthlyGrowthPct || 0) >= 0 ? '+' : ''}{stats?.monthlyGrowthPct || 0}% {(stats?.monthlyGrowthPct || 0) >= 0 ? '↑' : '↓'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3 — Orders + Recent Orders + Top Products */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Orders by status */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold text-[#0D1B3E]">Orders — {period?.label || 'Today'}</p>
            <Link href="/dashboard/admin/orders" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['pending','processing','delivered','cancelled'] as const).map(s => {
              const statusColor = STATUS_COLORS[s]
              return (
                <div
                  key={s}
                  className="group relative overflow-hidden rounded-xl border p-3 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
                  style={{
                    backgroundColor: `${statusColor}0F`,
                    borderColor: `${statusColor}2E`,
                  }}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-5 -top-7 h-20 w-20 rounded-full opacity-10 blur-xl transition-transform group-hover:scale-125"
                    style={{ backgroundColor: statusColor }}
                  />
                  <div className="relative mb-2 flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-lg border text-sm"
                      style={{ backgroundColor: `${statusColor}1A`, borderColor: `${statusColor}4D` }}
                    >
                      {STATUS_ICONS[s]}
                    </span>
                    <p
                      className="text-xs font-bold capitalize tracking-wide"
                      style={{ color: statusColor }}
                    >
                      {s}
                    </p>
                  </div>
                  <p
                    className="relative text-2xl font-extrabold tracking-tight"
                    style={{ color: '#0D1B3E' }}
                  >
                    {(orderStatusMap[s] || 0).toLocaleString()}
                  </p>
                </div>
              )
            })}
          </div>
          <div className="mt-4 pt-4 border-t border-[#0D1B3E]/5 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Active Distributors</span>
              <span className="font-semibold text-[#0D1B3E]">{stats?.totalDistributors || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Pending Payout Amount</span>
              <span className="font-semibold text-[#e05252]">{fmt(stats?.pendingPayoutsAmount || 0)}</span>
            </div>
          </div>
        </div>

        {/* Recent Orders */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold text-[#0D1B3E]">Recent Orders</p>
            <Link href="/dashboard/admin/orders" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
          </div>
          <div className="space-y-3">
            {(stats?.recentOrders || []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No orders yet</p>
            ) : (stats?.recentOrders || []).map(order => (
              <div key={order.id} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0"
                  style={{ backgroundColor: STATUS_COLORS[order.status] + '15' }}>
                  {STATUS_ICONS[order.status]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#0D1B3E] truncate">{order.buyer.full_name}</p>
                  <p className="text-[10px] text-gray-400">
                    {order.order_number || order.id.slice(0, 8)} ·{' '}
                    <span className="capitalize">
                      {order.buyer.distributor_profile?.dist_level === 'branch' ? 'Branch' : order.buyer.role}
                    </span>
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-bold text-[#0D1B3E]">{fmt(Number(order.total_amount))}</p>
                  <p className="text-[9px] text-gray-400">
                    {new Date(order.created_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Products */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-bold text-[#0D1B3E]">Top Products</p>
            <Link href="/dashboard/admin/products" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
          </div>
          <div className="space-y-3">
            {(stats?.topProducts || []).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No sales yet</p>
            ) : (stats?.topProducts || []).slice(0, 5).map((p, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: i === 0 ? '#C9A84C' : i === 1 ? '#9ca3af' : i === 2 ? '#cd7f32' : '#f1f5f9', color: i < 3 ? 'white' : '#9ca3af' }}>
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#0D1B3E] truncate">{p.name}</p>
                  <div className="w-full h-1.5 bg-[#f1f5f9] rounded-full mt-1 overflow-hidden">
                    <div className="h-full rounded-full bg-[#C9A84C]"
                      style={{ width: `${Math.min(100, (p.total_sold / ((stats?.topProducts?.[0]?.total_sold || 1))) * 100)}%` }} />
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-bold text-[#0D1B3E]">{p.total_sold} units</p>
                  <p className="text-[10px] text-gray-400">{fmt(p.revenue)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 4 — Revenue breakdown + Recent registrations + Payouts/Actions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Revenue Breakdown */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <p className="text-sm font-bold text-[#0D1B3E] mb-4">Today&apos;s Revenue Breakdown</p>
          <div className="space-y-3">
            {[
              { id: 'pin' as const, label: 'PIN Revenue', value: stats?.pinRevenueToday || 0, color: '#9a6f1e', icon: '🔑' },
              { id: 'commission' as const, label: 'MLM Commission Expense', value: stats?.digitalCommissionExpenseToday || 0, color: '#e05252', icon: '💸' },
              { id: 'digital' as const, label: 'Digital Net', value: stats?.digitalNetToday || 0, color: '#1a7a4a', icon: '📈' },
              { id: 'distribution' as const, label: 'Distribution Gross Profit', value: stats?.distributionGrossProfitToday || 0, color: '#2563eb', icon: '🧴' },
            ].map(s => {
              const total = stats?.totalRevenueToday || 0
              const pct   = total > 0 ? Math.round((s.value / total) * 100) : 0
              return (
                <button
                  type="button"
                  key={s.label}
                  onClick={() => setSelectedRevenueCard(s.id)}
                  className="group relative w-full overflow-hidden rounded-xl border border-white/10 border-l-[3px] bg-[#0D1B3E] p-3 text-left text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#C9A84C] focus:ring-offset-2"
                  style={{
                    borderLeftColor: s.color,
                  }}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-5 -top-7 h-20 w-20 rounded-full opacity-15 blur-xl transition-transform group-hover:scale-125"
                    style={{ backgroundColor: s.color }}
                  />
                  <div className="relative mb-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border text-sm"
                        style={{ backgroundColor: `${s.color}26`, borderColor: `${s.color}73` }}
                      >
                        {s.icon}
                      </span>
                      <p className="truncate text-xs font-bold text-white/85">{s.label}</p>
                    </div>
                    <p className="flex-shrink-0 text-sm font-extrabold text-white">{fmt(s.value)}</p>
                  </div>
                  <div className="relative flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: s.color }}
                      />
                    </div>
                    <span className="w-7 text-right text-[10px] font-bold text-white/85">{pct}%</span>
                  </div>
                  <span className="relative mt-2 block text-[9px] font-semibold text-white/55">View explanation and audit breakdown →</span>
                </button>
              )
            })}

            <div className="border-t border-[#0D1B3E]/5 pt-3 space-y-2">
              {[
                { label: 'All-time PIN Revenue',   value: stats?.pinRevenue || 0,   color: '#C9A84C' },
                { label: 'All-time Order Revenue', value: stats?.orderRevenue || 0, color: '#2563eb' },
                { label: 'Chain Revenue',          value: stats?.chainRevenue || 0, color: '#9a6f1e' },
              ].map(s => (
                <div key={s.label} className="flex justify-between text-xs">
                  <span className="text-gray-400">{s.label}</span>
                  <span className="font-semibold" style={{ color: s.color }}>{fmt(s.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Registrations */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8">
            <p className="text-sm font-bold text-[#0D1B3E]">Recent Registrations</p>
            <Link href="/dashboard/admin/resellers" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
          </div>
          {recentResellers.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">No resellers yet</div>
          ) : recentResellers.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors">
              <div className="w-8 h-8 rounded-full bg-[#010521] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {r.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-[#0D1B3E] truncate">{r.full_name}</p>
                <p className="text-[10px] text-gray-400">@{r.username} · {r.reseller_profile?.package?.name || '—'}</p>
              </div>
              <p className="text-[10px] text-gray-400 flex-shrink-0">
                {new Date(r.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
              </p>
            </div>
          ))}
        </div>

        {/* Pending Payouts + Quick Actions */}
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Pending Payouts</p>
              <Link href="/dashboard/admin/payouts" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
            </div>
            {recentPayouts.length === 0 ? (
              <div className="px-5 py-6 text-center text-gray-400 text-sm">No pending payouts</div>
            ) : recentPayouts.map(p => (
              <div key={p.id} className="flex items-center justify-between px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc]">
                <div>
                  <p className="text-xs font-semibold text-[#0D1B3E]">{p.user.full_name}</p>
                  <p className="text-[10px] text-gray-400">{new Date(p.requested_at).toLocaleDateString('en-PH')}</p>
                </div>
                <span className="text-xs font-bold text-[#C9A84C]">{fmt(Number(p.amount))}</span>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-4">
            <p className="text-sm font-bold text-[#0D1B3E] mb-3">Quick Actions</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Generate PIN',   href: '/dashboard/admin/pins',         icon: '🔑', color: '#C9A84C' },
                { label: 'Approve Payout', href: '/dashboard/admin/payouts',       icon: '💸', color: '#e05252' },
                { label: 'Add Product',    href: '/dashboard/admin/products',      icon: '🧴', color: '#8b5cf6' },
                { label: 'Distributors',   href: '/dashboard/admin/distributors',  icon: '🗺️', color: '#1a7a4a' },
                { label: 'Resellers',      href: '/dashboard/admin/resellers',     icon: '👥', color: '#2563eb' },
                { label: 'Ranks',          href: '/dashboard/admin/ranks',         icon: '⭐', color: '#9a6f1e' },
              ].map(q => (
                <Link key={q.href} href={q.href}
                  className="flex items-center gap-2 p-2.5 rounded-xl hover:bg-[#f8f9fc] transition-colors border border-transparent hover:border-[#0D1B3E]/8">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                    style={{ backgroundColor: q.color + '15' }}>
                    {q.icon}
                  </div>
                  <p className="text-xs text-gray-500 hover:text-[#0D1B3E] leading-tight">{q.label}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Row 5 — PIN Sales breakdown */}
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8">
            <div>
              <p className="text-sm font-bold text-[#0D1B3E]">Recent PIN Sales</p>
              <p className="text-xs text-gray-400 mt-0.5">Most recent recorded PIN sale orders</p>
            </div>
            <Link href="/dashboard/admin/pins" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
          </div>
          <div className="hidden md:grid md:grid-cols-[1.1fr_1.5fr_0.8fr_0.7fr] px-5 py-2 bg-[#f8f9fc]">
            {['Account / Recipient', 'PIN Details', 'Amount', 'Date'].map(h => (
              <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
            ))}
          </div>
          {pinSales.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">No PIN sales yet</div>
          ) : (
            <>
              {pinSales.slice(0, 3).map(sale => {
                const details = parsePinSaleNote(sale.notes)
                return (
                  <div key={sale.id} className="grid grid-cols-1 gap-3 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center md:grid-cols-[1.1fr_1.5fr_0.8fr_0.7fr] md:gap-0">
                    <div>
                      <p className="text-xs font-semibold text-[#0D1B3E]">{sale.buyer.full_name}</p>
                      <p className="text-[10px] text-gray-400">@{sale.buyer.username}</p>
                    </div>
                    <div className="min-w-0">
                      {details ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[#C9A84C]/10 px-2 py-1 text-[10px] font-semibold text-[#8A6A16]">{details.packageName}</span>
                          <span className="text-xs text-gray-500">{details.quantity} PIN{details.quantity !== 1 ? 's' : ''} × {fmt(details.unitPrice)}</span>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 truncate">{sale.notes || '—'}</p>
                      )}
                    </div>
                    <div>
                      <p className="md:hidden text-[10px] uppercase tracking-wide text-gray-400">Amount</p>
                      <p className="text-xs font-bold text-[#0D1B3E]">{fmt(Number(sale.total_amount))}</p>
                    </div>
                    <div>
                      <p className="md:hidden text-[10px] uppercase tracking-wide text-gray-400">Date</p>
                      <p className="text-xs text-gray-400">{new Date(sale.created_at).toLocaleDateString('en-PH')}</p>
                    </div>
                  </div>
                )
              })}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#0D1B3E]/[0.025] px-5 py-3">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Showing {Math.min(pinSales.length, 3)} recent sales</p>
                <p className="text-xs text-gray-500">
                  Displayed total <span className="font-bold text-[#0D1B3E]">{fmt(pinSales.slice(0, 3).reduce((sum, sale) => sum + Number(sale.total_amount), 0))}</span>
                </p>
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#0D1B3E]">Top City Distributors</p>
                <p className="text-xs text-gray-400 mt-0.5">By completed sales made (PIN + Products)</p>
              </div>
              <Link href="/dashboard/admin/top-performers?type=city" className="text-[11px] text-[#C9A84C] hover:underline whitespace-nowrap">View All →</Link>
            </div>
            {(stats?.topCityDistsOverall || []).length === 0 ? (
              <div className="px-5 py-6 text-center text-gray-400 text-sm">No data yet</div>
            ) : (stats?.topCityDistsOverall || []).map((d, i, distributors) => {
              const maxRevenue = Math.max(...distributors.map(item => item.revenue), 1)
              const width = Math.max(4, Math.round((d.revenue / maxRevenue) * 100))
              return (
              <div key={d.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: i === 0 ? '#C9A84C' : '#f1f5f9', color: i === 0 ? '#0D1B3E' : '#9ca3af' }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#0D1B3E] truncate">{d.full_name}</p>
                  <p className="text-[10px] text-gray-400">{d.pin_orders} PIN · {d.prod_orders} product orders</p>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#0D1B3E]/5">
                    <div className="h-full rounded-full bg-[#C9A84C]" style={{ width: `${width}%` }} />
                  </div>
                </div>
                <p className="text-xs font-bold text-[#C9A84C]">{fmt(d.revenue)}</p>
              </div>
              )
            })}
          </div>

          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Top Packages</p>
              <p className="text-xs text-gray-400 mt-0.5">By PINs sold</p>
            </div>
            {packageSales.length === 0 ? (
              <div className="px-5 py-6 text-center text-gray-400 text-sm">No data yet</div>
            ) : packageSales.map((p, i, packages) => {
              const maxPins = Math.max(...packages.map(item => item._count.id), 1)
              const width = Math.max(4, Math.round((p._count.id / maxPins) * 100))
              return (
              <div key={p.package_id} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: i === 0 ? '#C9A84C' : '#f1f5f9', color: i === 0 ? '#0D1B3E' : '#9ca3af' }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#0D1B3E]">{p.package?.name || '—'}</p>
                  <p className="text-[10px] text-gray-400">{p._count.id} PINs sold</p>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#0D1B3E]/5">
                    <div className="h-full rounded-full bg-[#C9A84C]" style={{ width: `${width}%` }} />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-gray-400">Current unit value</p>
                  <p className="text-xs font-bold text-[#C9A84C]">{fmt(Number(p.package?.price || 0))}</p>
                </div>
              </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Row 6 — Geographic */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { title: 'Sales by Region',   items: stats?.regionalSales || [],  nameKey: 'region_name',   type: 'regional',   countLabel: 'dist.' },
          { title: 'Sales by Province', items: stats?.provinceSales || [],  nameKey: 'province_name', type: 'provincial', countLabel: 'dist.' },
          { title: 'Sales by City',     items: stats?.citySales || [],      nameKey: 'city_muni_name', type: 'city',       countLabel: 'dist.' },
          { title: 'Reseller Income',   items: stats?.resellerSales || [],  nameKey: 'full_name',      type: 'reseller',   countLabel: 'commissions' },
        ].map(({ title, items, nameKey, type, countLabel }) => (
          <div key={title} className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-[#0D1B3E]">{title}</p>
              <Link href={`/dashboard/admin/top-performers?type=${type}`} className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No data yet</p>
            ) : (
              <div className="space-y-3">
                {items.slice(0, 6).map((r, i: number) => {
                  const maxVal = items[0]?.total || 1
                  const pct    = Math.round((r.total / maxVal) * 100)
                  const barColors = ['#0D1B3E', '#2563eb', '#C9A84C', '#1a7a4a', '#8b5cf6', '#9ca3af']
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-300 w-4">{i + 1}</span>
                          <p className="text-xs font-semibold text-[#0D1B3E] truncate max-w-[120px]">{r[nameKey]}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-[#0D1B3E]">{fmt(r.total)}</p>
                          <p className="text-[9px] text-gray-400">{r.count} {countLabel}</p>
                        </div>
                      </div>
                      <div className="w-full h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColors[i] || '#9ca3af' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {selectedRevenueCard && stats && (
        <RevenueBreakdownModal
          selected={selectedRevenueCard}
          stats={stats}
          periodLabel={period?.label || 'Selected period'}
          onClose={() => setSelectedRevenueCard(null)}
        />
      )}

    </div>
  )
}

function RevenueBreakdownModal({ selected, stats, periodLabel, onClose }: {
  selected: 'pin' | 'commission' | 'digital' | 'distribution'
  stats: Stats
  periodLabel: string
  onClose: () => void
}) {
  const pinRows = stats.revenueBreakdown?.pinRevenue || []
  const commissionRows = stats.revenueBreakdown?.commissionExpense || []
  const distributionRows = stats.revenueBreakdown?.distributionProfit || []
  const definitions = {
    pin: { title: 'PIN Revenue', amount: stats.pinRevenueToday, formula: 'Sum of immutable PIN allocations from completed new-reseller registrations.', note: 'This is the digital allocation assigned to Hiroma when a registration PIN is consumed. It is not the full package payment and it does not include product-order revenue.' },
    commission: { title: 'MLM Commission Expense', amount: stats.digitalCommissionExpenseToday, formula: 'Direct Referral + payable Binary Pairing + Multilevel commissions.', note: 'These are member commission obligations created during the selected period. Binary flashout retained by Hiroma is excluded.' },
    digital: { title: 'Digital Net', amount: stats.digitalNetToday, formula: `${fmt(stats.pinRevenueToday)} PIN Revenue − ${fmt(stats.digitalCommissionExpenseToday)} MLM Commission Expense = ${fmt(stats.digitalNetToday)}`, note: 'Digital Net is not another PIN charge. It is the remainder after deducting MLM commission expense from PIN Revenue.' },
    distribution: { title: 'Distribution Gross Profit', amount: stats.distributionGrossProfitToday, formula: `Delivered product revenue ${fmt(stats.orderRevenueToday)} − product acquisition cost ${fmt(stats.orderRevenueToday-stats.distributionGrossProfitToday)} = ${fmt(stats.distributionGrossProfitToday)}`, note: 'This covers delivered product orders sold directly by Admin. It is gross profit before operating expenses, taxes, and other adjustments.' },
  } as const
  const selectedDefinition = definitions[selected]
  const commissionLabels: Record<string,string> = { direct_referral: 'Direct Referral', binary_pairing: 'Binary Pairing', multilevel: 'Multilevel' }
  return <div role="dialog" aria-modal="true" aria-labelledby="revenue-breakdown-title" className="fixed inset-0 z-50 flex items-center justify-center bg-[#06102A]/65 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between border-b bg-white px-5 py-4"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-[#C9A84C]">{periodLabel} audit explanation</p><h2 id="revenue-breakdown-title" className="mt-1 text-lg font-bold text-[#0D1B3E]">{selectedDefinition.title}: {fmt(selectedDefinition.amount)}</h2></div><button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm">Close</button></header>
      <div className="space-y-4 p-5"><section className="rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="text-sm font-semibold text-[#0D1B3E]">What this means</p><p className="mt-2 text-sm text-gray-600">{selectedDefinition.note}</p><p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm font-bold text-[#0D1B3E]">{selectedDefinition.formula}</p></section>
      {selected === 'pin' && <AuditTable headings={['Package','Channel','Registrations','PIN allocation']} rows={pinRows.map(row => [row.package_name,row.channel,row.registrations,fmt(row.amount)])} empty="No completed registration PIN allocations in this period." />}
      {selected === 'commission' && <AuditTable headings={['Commission type','Entries','Expense']} rows={commissionRows.map(row => [commissionLabels[row.commission_type] || row.commission_type,row.entries,fmt(row.amount)])} empty="No payable MLM commissions created in this period." />}
      {selected === 'digital' && <AuditTable headings={['Component','Treatment','Amount']} rows={[["PIN Revenue","Add",fmt(stats.pinRevenueToday)],["MLM Commission Expense","Subtract",fmt(stats.digitalCommissionExpenseToday)],["Digital Net","Result",fmt(stats.digitalNetToday)]]} empty="No digital activity in this period." />}
      {selected === 'distribution' && <AuditTable headings={['Product','Units','Revenue','Cost','Gross profit']} rows={distributionRows.map(row => [row.product_name,row.units,fmt(row.revenue),fmt(row.cost),fmt(row.profit)])} empty="No delivered Admin product orders in this period." />}
      <p className="text-xs text-gray-400">This modal is read-only and uses the same server totals and selected reporting period as the dashboard card.</p></div>
    </section>
  </div>
}

function AuditTable({ headings, rows, empty }: { headings: string[]; rows: Array<Array<string | number>>; empty: string }) {
  return <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-slate-50 text-gray-500"><tr>{headings.map(heading => <th key={heading} className="px-3 py-2">{heading}</th>)}</tr></thead><tbody className="divide-y">{rows.map((row,index) => <tr key={index}>{row.map((value,column) => <td key={column} className={`px-3 py-2 ${column === row.length-1 ? 'font-bold text-[#0D1B3E]' : ''}`}>{value}</td>)}</tr>)}{rows.length === 0 && <tr><td colSpan={headings.length} className="px-3 py-8 text-center text-gray-400">{empty}</td></tr>}</tbody></table></div>
}
