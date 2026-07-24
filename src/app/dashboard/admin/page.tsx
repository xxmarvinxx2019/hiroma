'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stats {
  totalRevenueToday: number
  totalRevenueYesterday: number
  netProfitToday: number
  pinRevenueToday: number
  pinRevenueYesterday: number
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
  orderRevenue: number
  orderCost: number
  orderProfit: number
  chainRevenue: number
  totalRevenue: number
  overallNetProfit: number
  totalUnitsSold: number
  monthlyRevenue: { month: string; revenue: number }[]
  lastMonthRevenue: number
  thisMonthRevenue: number
  growthPct: number
  totalStock: number
  criticalStock: number
  topProducts:         { name: string; total_sold: number; revenue: number }[]
  topCityDistsOverall: TopCityDist[]
  recentOrders: {
    id: string; order_number: string | null; status: string
    total_amount: number; created_at: string
    buyer: { full_name: string; role: string }
  }[]
  ordersByStatus: { status: string; _count: { status: number } }[]
  regionalSales:  { region_name: string; total: number; count: number }[]
  provinceSales:  { province_name: string; total: number; count: number }[]
  citySales:      { city_muni_name: string; total: number; count: number }[]
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
  const inner = (
    <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:shadow-sm hover:border-[#0D1B3E]/15 transition-all h-full"
      style={{ borderTop: `2px solid ${color || '#0D1B3E'}` }}>
      <div className="flex items-start justify-between mb-3">
        {icon && (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg"
            style={{ backgroundColor: (color || '#0D1B3E') + '15' }}>
            {icon}
          </div>
        )}
        {badge && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: (color || '#0D1B3E') + '15', color: color || '#0D1B3E' }}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color: color || '#0D1B3E' }}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
    </div>
  )
  return href ? <Link href={href} className="block">{inner}</Link> : inner
}

export default function AdminDashboardPage() {
  const [stats, setStats]                     = useState<Stats | null>(null)
  const [recentResellers, setRecentResellers] = useState<RecentReseller[]>([])
  const [recentPayouts, setRecentPayouts]     = useState<RecentPayout[]>([])
  const [pinSales, setPinSales]               = useState<PinSale[]>([])
  const [distSales, setDistSales]             = useState<DistributorSales[]>([])
  const [packageSales, setPackageSales]       = useState<PackageSales[]>([])
  const [loading, setLoading]                 = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/stats').then(r => r.json()),
      fetch('/api/admin/resellers/recent').then(r => r.json()),
      fetch('/api/admin/payouts/recent').then(r => r.json()),
      fetch('/api/admin/pins/sales?limit=3').then(r => r.json()),
    ]).then(([s, r, p, ps]) => {
      setStats(s.stats)
      setRecentResellers(r.resellers || [])
      setRecentPayouts(p.payouts || [])
      setPinSales(ps.recentSales || [])
      setDistSales(ps.byDistributor || [])
      setPackageSales(ps.byPackage || [])
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return (
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
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="w-full space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B3E]">Executive Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">{today}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/admin/pins"
            className="bg-[#0D1B3E] text-white text-xs font-medium rounded-xl px-4 py-2 hover:bg-[#1A2F5E] transition-colors">
            🔑 Generate PIN
          </Link>
          <Link href="/dashboard/admin/distributors"
            className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-bold rounded-xl px-4 py-2 hover:bg-[#E8C96A] transition-colors">
            + Add Distributor
          </Link>
        </div>
      </div>

      {/* Row 1 — Today's KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Today's Sales"      value={fmt(stats?.totalRevenueToday || 0)}    color="#1a7a4a" icon="💰" sub={`PIN + Product · vs Yesterday: ${fmt(stats?.totalRevenueYesterday || 0)}`} />
        <StatCard label="Today's PIN Sales"  value={fmt(stats?.pinRevenueToday || 0)}      color="#C9A84C" icon="🔑" sub={`vs Yesterday: ${fmt(stats?.pinRevenueYesterday || 0)}`} href="/dashboard/admin/pins" />
        <StatCard label="Today's Product Sales" value={fmt(stats?.orderRevenueToday || 0)} color="#2563eb" icon="🧴" sub={`${stats?.totalUnitsSoldToday || 0} units sold`} href="/dashboard/admin/orders" />
        <StatCard label="Today's Net Profit" value={fmt(stats?.netProfitToday || 0)}       color="#1a7a4a" icon="📈" sub="Revenue minus cost" />
        <StatCard label="Active Products"    value={stats?.totalProducts || 0}              color="#8b5cf6" icon="📦" sub={`${stats?.totalUnitsSoldToday || 0} units today`} href="/dashboard/admin/products" />
      </div>

      {/* Row 2 — Sales breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="New Members Today"  value={stats?.newResellersToday || 0}                 color="#C9A84C" icon="👥" sub={`vs Yesterday: ${stats?.newResellersYesterday || 0}`} href="/dashboard/admin/resellers" badge={stats?.newResellersToday ? 'New!' : undefined} />
        <StatCard label="Pending Payouts"    value={stats?.pendingPayouts || 0}                    color="#e05252" icon="💸" sub={fmt(stats?.pendingPayoutsAmount || 0)} href="/dashboard/admin/payouts" badge={stats?.pendingPayouts ? 'Action needed' : undefined} />
        <StatCard label="Total Resellers"    value={(stats?.totalResellers || 0).toLocaleString()} color="#2563eb" icon="👤" sub={`+${stats?.newResellersThisMonth || 0} this month`} href="/dashboard/admin/resellers" />
        <StatCard label="New This Month"     value={stats?.newResellersThisMonth || 0}             color="#9a6f1e" icon="🆕" sub={`+${stats?.newResellersToday || 0} today`} href="/dashboard/admin/resellers" />
      </div>


      {/* Row 2.5 — Warehouse + Growth + Monthly Chart */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Warehouse Stock */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#eff6ff] flex items-center justify-center text-3xl flex-shrink-0">📦</div>
          <div className="flex-1">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Warehouse Stock</p>
            <p className="text-2xl font-bold text-[#0D1B3E]">{(stats?.totalStock || 0).toLocaleString()} <span className="text-sm font-normal text-gray-400">units</span></p>
            <p className="text-xs text-gray-400 mt-1">{stats?.totalProducts || 0} Products</p>
            {(stats?.criticalStock || 0) > 0 && (
              <p className="text-xs text-[#e05252] font-semibold mt-1">⚠️ Critical Stock: {stats?.criticalStock} product{(stats?.criticalStock || 0) !== 1 ? 's' : ''}</p>
            )}
          </div>
        </div>

        {/* Growth vs Last Month */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Growth vs Last Month</p>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${(stats?.growthPct || 0) >= 0 ? 'bg-[#e8f7ef]' : 'bg-[#fdecea]'}`}>
              {(stats?.growthPct || 0) >= 0 ? '📈' : '📉'}
            </div>
            <div>
              <p className={`text-3xl font-bold ${(stats?.growthPct || 0) >= 0 ? 'text-[#1a7a4a]' : 'text-[#e05252]'}`}>
                {(stats?.growthPct || 0) >= 0 ? '+' : ''}{stats?.growthPct || 0}%
              </p>
              <p className="text-xs text-gray-400">Overall Growth</p>
            </div>
          </div>
          {/* Mini sparkline */}
          <div className="flex items-end gap-0.5 h-10">
            {(stats?.monthlyRevenue || []).slice(-8).map((m, i, arr) => {
              const max = Math.max(...arr.map(a => a.revenue), 1)
              const h   = Math.max(4, Math.round((m.revenue / max) * 36))
              return (
                <div key={i} className="flex-1 rounded-sm"
                  style={{ height: h, background: i === arr.length - 1 ? '#1a7a4a' : '#bbf7d0' }} />
              )
            })}
          </div>
        </div>

        {/* Monthly Revenue Chart */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-[#0D1B3E]">Monthly Revenue Overview</p>
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
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#0D1B3E] text-white text-[8px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
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
              <p className={`text-sm font-bold ${(stats?.growthPct || 0) >= 0 ? 'text-[#1a7a4a]' : 'text-[#e05252]'}`}>
                {(stats?.growthPct || 0) >= 0 ? '+' : ''}{stats?.growthPct || 0}% {(stats?.growthPct || 0) >= 0 ? '↑' : '↓'}
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
            <p className="text-sm font-bold text-[#0D1B3E]">Orders Overview</p>
            <Link href="/dashboard/admin/orders" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['pending','processing','delivered','cancelled'] as const).map(s => (
              <div key={s} className="rounded-xl p-3 border border-[#0D1B3E]/8"
                style={{ borderLeft: `3px solid ${STATUS_COLORS[s]}` }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-sm">{STATUS_ICONS[s]}</span>
                  <p className="text-xs text-gray-400 capitalize">{s}</p>
                </div>
                <p className="text-2xl font-bold" style={{ color: STATUS_COLORS[s] }}>
                  {(orderStatusMap[s] || 0).toLocaleString()}
                </p>
              </div>
            ))}
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
                    {order.order_number || order.id.slice(0, 8)} · <span className="capitalize">{order.buyer.role}</span>
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
          <p className="text-sm font-bold text-[#0D1B3E] mb-4">Today's Revenue Breakdown</p>
          <div className="space-y-3">
            {[
              { label: 'PIN Sales',     value: stats?.pinRevenueToday || 0,   color: '#C9A84C', icon: '🔑' },
              { label: 'Product Sales', value: stats?.orderRevenueToday || 0, color: '#2563eb', icon: '🧴' },
              { label: 'Net Profit',    value: stats?.netProfitToday || 0,    color: '#1a7a4a', icon: '📈' },
            ].map(s => {
              const total = stats?.totalRevenueToday || 0
              const pct   = total > 0 ? Math.round((s.value / total) * 100) : 0
              return (
                <div key={s.label} className="rounded-xl p-3 border border-[#0D1B3E]/8"
                  style={{ borderTop: `2px solid ${s.color}` }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span>{s.icon}</span>
                      <p className="text-xs text-gray-400">{s.label}</p>
                    </div>
                    <p className="text-sm font-bold" style={{ color: s.color }}>{fmt(s.value)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.color }} />
                    </div>
                    <span className="text-[10px] font-semibold w-6" style={{ color: s.color }}>{pct}%</span>
                  </div>
                </div>
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
              <div className="w-8 h-8 rounded-full bg-[#0D1B3E] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
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
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8">
            <div>
              <p className="text-sm font-bold text-[#0D1B3E]">Recent PIN Sales</p>
              <p className="text-xs text-gray-400 mt-0.5">Every PIN assignment to a city distributor is a sale</p>
            </div>
            <Link href="/dashboard/admin/pins" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
          </div>
          <div className="grid grid-cols-4 px-5 py-2 bg-[#f8f9fc]">
            {['City Distributor', 'Notes', 'Amount', 'Date'].map(h => (
              <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
            ))}
          </div>
          {pinSales.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400 text-sm">No PIN sales yet</div>
          ) : pinSales.slice(0, 3).map(sale => (
            <div key={sale.id} className="grid grid-cols-4 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
              <div>
                <p className="text-xs font-semibold text-[#0D1B3E]">{sale.buyer.full_name}</p>
                <p className="text-[10px] text-gray-400">@{sale.buyer.username}</p>
              </div>
              <p className="text-xs text-gray-400 truncate">{sale.notes || '—'}</p>
              <p className="text-xs font-bold text-[#C9A84C]">{fmt(Number(sale.total_amount))}</p>
              <p className="text-xs text-gray-400">{new Date(sale.created_at).toLocaleDateString('en-PH')}</p>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Top City Distributors</p>
              <p className="text-xs text-gray-400 mt-0.5">By total sales (PIN + Products)</p>
            </div>
            {(stats?.topCityDistsOverall || []).length === 0 ? (
              <div className="px-5 py-6 text-center text-gray-400 text-sm">No data yet</div>
            ) : (stats?.topCityDistsOverall || []).map((d, i) => (
              <div key={d.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: i === 0 ? '#C9A84C' : '#f1f5f9', color: i === 0 ? '#0D1B3E' : '#9ca3af' }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#0D1B3E] truncate">{d.full_name}</p>
                  <p className="text-[10px] text-gray-400">{d.pin_orders} PIN · {d.prod_orders} product orders</p>
                </div>
                <p className="text-xs font-bold text-[#C9A84C]">{fmt(d.revenue)}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Top Packages</p>
              <p className="text-xs text-gray-400 mt-0.5">By PINs sold</p>
            </div>
            {packageSales.length === 0 ? (
              <div className="px-5 py-6 text-center text-gray-400 text-sm">No data yet</div>
            ) : packageSales.map((p, i) => (
              <div key={p.package_id} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: i === 0 ? '#C9A84C' : '#f1f5f9', color: i === 0 ? '#0D1B3E' : '#9ca3af' }}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#0D1B3E]">{p.package?.name || '—'}</p>
                  <p className="text-[10px] text-gray-400">{p._count.id} PINs sold</p>
                </div>
                <p className="text-xs font-bold text-[#C9A84C]">{fmt(Number(p.package?.price || 0))} each</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 6 — Geographic */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { title: 'Sales by Region',   items: stats?.regionalSales || [],  nameKey: 'region_name',   },
          { title: 'Sales by Province', items: stats?.provinceSales || [],  nameKey: 'province_name', },
          { title: 'Sales by City',     items: stats?.citySales || [],      nameKey: 'city_muni_name' },
        ].map(({ title, items, nameKey }) => (
          <div key={title} className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-[#0D1B3E]">{title}</p>
              <Link href="/dashboard/admin/distributors" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No data yet</p>
            ) : (
              <div className="space-y-3">
                {items.slice(0, 6).map((r: any, i: number) => {
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
                          <p className="text-[9px] text-gray-400">{r.count} dist.</p>
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

    </div>
  )
}