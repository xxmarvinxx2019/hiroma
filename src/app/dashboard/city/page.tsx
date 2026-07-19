'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stats {
  salesRevenueToday: number
  salesRevenueYesterday: number
  unitsSoldToday: number
  newResellersToday: number
  newResellersYesterday: number
  newResellersThisMonth: number
  pinsUsedToday: number
  totalResellers: number
  activeResellers: number
  unusedPins: number
  usedPins: number
  totalPinsRequested: number
  totalOrders: number
  pendingOrders: number
  lowStockItems: number
  totalInventoryItems: number
  totalStock: number
  totalRevenue: number
  totalCost: number
  totalProfit: number
  totalUnitsSold: number
  orderRevenue: number
  orderCost: number
  orderUnitsSold: number
  packageRevenue: number
  packageCost: number
  packageUnitsSold: number
  topProducts: { name: string; qty: number; revenue: number }[]
  packageBreakdown: { name: string; count: number; revenue: number }[]
  monthlyRevenue: { month: string; revenue: number; resellers: number }[]
  recentResellers: {
    id: string; full_name: string; username: string; created_at: string
    reseller_profile: { package: { name: string } } | null
  }[]
  recentOrders: {
    id: string; order_number: string | null; status: string
    total_amount: number; created_at: string
    buyer: { full_name: string; username: string }
  }[]
  topEarners: { id: string; full_name: string; username: string; total_earned: number; balance: number; package_name: string }[]
  inventoryItems: { name: string; quantity: number; low: number }[]
}

const fmt  = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtS = (n: number) => {
  if (n >= 1000000) return `₱${(n/1000000).toFixed(2)}M`
  if (n >= 1000)    return `₱${(n/1000).toFixed(1)}K`
  return fmt(n)
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', processing: '#3b82f6', delivered: '#1a7a4a', cancelled: '#e05252',
}
const STATUS_ICONS: Record<string, string> = {
  pending: '🕐', processing: '📦', delivered: '✅', cancelled: '❌',
}

function StatCard({ label, value, sub, color, icon, badge }: {
  label: string; value: string | number; sub?: string
  color?: string; icon?: string; badge?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:shadow-sm transition-all"
      style={{ borderTop: `2px solid ${color || '#0D1B3E'}` }}>
      <div className="flex items-start justify-between mb-3">
        {icon && <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: (color || '#0D1B3E') + '15' }}>{icon}</div>}
        {badge && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: (color || '#0D1B3E') + '15', color: color || '#0D1B3E' }}>{badge}</span>}
      </div>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color: color || '#0D1B3E' }}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

type ReportTab = 'overview' | 'sales' | 'products' | 'packages' | 'pins' | 'inventory'

export default function CityDashboardPage() {
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<ReportTab>('overview')

  useEffect(() => {
    fetch('/api/city/stats')
      .then(r => r.json())
      .then(d => setStats(d.stats))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-sm">Loading dashboard...</p>
      </div>
    </div>
  )

  if (!stats) return <p className="text-center text-gray-400 py-20">Failed to load dashboard.</p>

  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="w-full space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B3E]">City Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">{today}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/city/resellers/new"
            className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-bold rounded-xl px-4 py-2 hover:bg-[#E8C96A] transition-colors">
            + Register Reseller
          </Link>
          <Link href="/dashboard/city/orders"
            className="bg-[#0D1B3E] text-white text-xs font-medium rounded-xl px-4 py-2 hover:bg-[#1A2F5E] transition-colors">
            🛒 Walk-in Sale
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit overflow-x-auto">
        {[
          { key: 'overview',  label: '📊 Overview'    },
          { key: 'sales',     label: '💰 Sales'       },
          { key: 'products',  label: '📦 Products'    },
          { key: 'packages',  label: '🎁 Packages'    },
          { key: 'pins',      label: '🔑 PINs'        },
          { key: 'inventory', label: '🏭 Inventory'   },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as ReportTab)}
            className={`text-xs px-3 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${tab === t.key ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ OVERVIEW ══ */}
      {tab === 'overview' && (
        <>
          {/* Today's KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Today's Sales"       value={fmtS(stats.salesRevenueToday)}  color="#1a7a4a" icon="💰" sub={`vs Yesterday: ${fmtS(stats.salesRevenueYesterday)}`} />
            <StatCard label="Units Sold Today"    value={stats.unitsSoldToday}            color="#2563eb" icon="📦" sub="Walk-in orders" />
            <StatCard label="New Resellers Today" value={stats.newResellersToday}         color="#C9A84C" icon="👥" sub={`vs Yesterday: ${stats.newResellersYesterday}`} badge={stats.newResellersToday > 0 ? 'New!' : undefined} />
            <StatCard label="PINs Used Today"     value={stats.pinsUsedToday}             color="#8b5cf6" icon="🔑" sub="Registrations today" />
          </div>

          {/* Running totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Resellers"    value={stats.totalResellers.toLocaleString()} color="#0D1B3E" icon="👤" sub={`+${stats.newResellersThisMonth} this month`} />
            <StatCard label="Available PINs"     value={stats.unusedPins}                       color="#1a7a4a" icon="🔓" sub={`${stats.usedPins} used · ${stats.totalPinsRequested} total`} />
            <StatCard label="Pending Orders"     value={stats.pendingOrders}                    color="#f59e0b" icon="🕐" sub={`${stats.totalOrders} total orders`} badge={stats.pendingOrders > 0 ? 'Action needed' : undefined} />
            <StatCard label="Low Stock Items"    value={stats.lowStockItems}                    color="#e05252" icon="⚠️" sub={`${stats.totalStock} units in stock`} badge={stats.lowStockItems > 0 ? 'Restock!' : undefined} />
          </div>

          {/* Monthly chart + Recent resellers + Recent orders */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">

            {/* Monthly Revenue Chart */}
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
              <p className="text-sm font-bold text-[#0D1B3E] mb-4">Monthly Sales (Last 6 Months)</p>
              <div className="flex items-end gap-2 h-28">
                {stats.monthlyRevenue.map((m, i) => {
                  const max = Math.max(...stats.monthlyRevenue.map(x => x.revenue), 1)
                  const h   = Math.max(4, Math.round((m.revenue / max) * 104))
                  const isLast = i === stats.monthlyRevenue.length - 1
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div className="w-full rounded-t-md transition-all"
                        style={{ height: h, background: isLast ? '#0D1B3E' : '#bfdbfe' }} />
                      <p className="text-[9px] text-gray-400">{m.month}</p>
                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#0D1B3E] text-white text-[8px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        {fmtS(m.revenue)}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="border-t border-[#0D1B3E]/5 mt-3 pt-3 flex justify-between text-xs">
                <span className="text-gray-400">Total Revenue</span>
                <span className="font-bold text-[#0D1B3E]">{fmtS(stats.totalRevenue)}</span>
              </div>
            </div>

            {/* Recent Resellers */}
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8">
                <p className="text-sm font-bold text-[#0D1B3E]">Recent Registrations</p>
                <Link href="/dashboard/city/resellers" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
              </div>
              {stats.recentResellers.length === 0 ? (
                <div className="px-5 py-8 text-center text-gray-400 text-sm">No resellers yet</div>
              ) : stats.recentResellers.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc]">
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

            {/* Top Earners */}
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8">
                <p className="text-sm font-bold text-[#0D1B3E]">Top Earners</p>
                <Link href="/dashboard/city/resellers" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
              </div>
              {stats.topEarners.length === 0 ? (
                <div className="px-5 py-8 text-center text-gray-400 text-sm">No resellers yet</div>
              ) : stats.topEarners.map((r, i) => (
                <div key={r.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors">
                  {/* Rank badge */}
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: i === 0 ? '#C9A84C' : i === 1 ? '#9ca3af' : i === 2 ? '#cd7f32' : '#f1f5f9', color: i < 3 ? 'white' : '#9ca3af' }}>
                    {i + 1}
                  </div>
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-[#0D1B3E] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {r.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#0D1B3E] truncate">{r.full_name}</p>
                    <p className="text-[10px] text-gray-400">@{r.username} · {r.package_name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold text-[#1a7a4a]">{fmtS(r.total_earned)}</p>
                    <p className="text-[9px] text-gray-400">total earned</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Recent Orders */}
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8">
                <p className="text-sm font-bold text-[#0D1B3E]">Recent Walk-in Orders</p>
                <Link href="/dashboard/city/orders" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
              </div>
              {stats.recentOrders.length === 0 ? (
                <div className="px-5 py-8 text-center text-gray-400 text-sm">No orders yet</div>
              ) : stats.recentOrders.map(o => (
                <div key={o.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc]">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0"
                    style={{ backgroundColor: STATUS_COLORS[o.status] + '15' }}>
                    {STATUS_ICONS[o.status]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#0D1B3E] truncate">{o.buyer.full_name}</p>
                    <p className="text-[10px] text-gray-400">{o.order_number || o.id.slice(0,8)}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold text-[#0D1B3E]">{fmt(Number(o.total_amount))}</p>
                    <p className="text-[9px] text-gray-400 capitalize">{o.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Revenue breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: 'Walk-in Sales Revenue', value: stats.orderRevenue,   cost: stats.orderCost,   units: stats.orderUnitsSold,   icon: '🛒', color: '#2563eb' },
              { label: 'Package Sales Revenue', value: stats.packageRevenue, cost: stats.packageCost, units: stats.packageUnitsSold, icon: '🎁', color: '#C9A84C' },
              { label: 'Total Profit',          value: stats.totalProfit,    cost: stats.totalCost,   units: stats.totalUnitsSold,   icon: '📈', color: '#1a7a4a' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5" style={{ borderTop: `2px solid ${s.color}` }}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">{s.icon}</span>
                  <p className="text-sm font-bold text-[#0D1B3E]">{s.label}</p>
                </div>
                <p className="text-2xl font-bold mb-3" style={{ color: s.color }}>{fmtS(s.value)}</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-gray-400">Cost</span><span className="text-[#e05252] font-medium">{fmtS(s.cost)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Units</span><span className="font-medium text-[#0D1B3E]">{s.units.toLocaleString()}</span></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ══ SALES REPORT ══ */}
      {tab === 'sales' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Revenue"    value={fmtS(stats.totalRevenue)}    color="#1a7a4a" icon="💰" sub="Walk-in + Package" />
            <StatCard label="Total Cost"       value={fmtS(stats.totalCost)}       color="#e05252" icon="🏷️" sub="Cost of goods" />
            <StatCard label="Total Profit"     value={fmtS(stats.totalProfit)}     color="#2563eb" icon="📈" sub="Revenue minus cost" />
            <StatCard label="Total Units Sold" value={stats.totalUnitsSold.toLocaleString()} color="#C9A84C" icon="📦" sub="All channels" />
          </div>

          {/* Monthly breakdown table */}
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Monthly Sales Overview</p>
            </div>
            <div className="grid grid-cols-3 px-5 py-2 bg-[#f8f9fc]">
              {['Month', 'Revenue', 'New Resellers'].map(h => <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>)}
            </div>
            {stats.monthlyRevenue.map((m, i) => (
              <div key={i} className="grid grid-cols-3 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                <p className="text-xs font-semibold text-[#0D1B3E]">{m.month}</p>
                <p className="text-xs font-bold text-[#1a7a4a]">{fmtS(m.revenue)}</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-[#C9A84C]">{m.resellers}</p>
                  <div className="flex-1 h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#C9A84C]"
                      style={{ width: `${Math.min(100, (m.resellers / (Math.max(...stats.monthlyRevenue.map(x => x.resellers)) || 1)) * 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ══ PRODUCT MOVEMENT ══ */}
      {tab === 'products' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Walk-in Revenue"  value={fmtS(stats.orderRevenue)}              color="#2563eb" icon="🛒" sub={`${stats.orderUnitsSold} units`} />
            <StatCard label="Walk-in Cost"     value={fmtS(stats.orderCost)}                 color="#e05252" icon="🏷️" sub="City price cost" />
            <StatCard label="Walk-in Profit"   value={fmtS(stats.orderRevenue - stats.orderCost)} color="#1a7a4a" icon="📈" sub="Revenue minus cost" />
          </div>
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Product Movement</p>
              <p className="text-xs text-gray-400 mt-0.5">Based on delivered walk-in orders</p>
            </div>
            <div className="grid grid-cols-4 px-5 py-2 bg-[#f8f9fc]">
              {['Product', 'Units Sold', 'Revenue', 'Share'].map(h => <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>)}
            </div>
            {stats.topProducts.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">No product sales yet</p>
            ) : stats.topProducts.map((p, i) => {
              const totalQty = stats.topProducts.reduce((s, x) => s + x.qty, 0) || 1
              const pct = Math.round((p.qty / totalQty) * 100)
              return (
                <div key={i} className="grid grid-cols-4 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: i === 0 ? '#C9A84C' : i === 1 ? '#9ca3af' : '#f1f5f9', color: i < 2 ? 'white' : '#9ca3af' }}>{i+1}</span>
                    <p className="text-xs font-semibold text-[#0D1B3E] truncate">{p.name}</p>
                  </div>
                  <p className="text-xs font-bold text-[#0D1B3E]">{p.qty.toLocaleString()}</p>
                  <p className="text-xs font-bold text-[#2563eb]">{fmtS(p.revenue)}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-[#C9A84C]" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 w-7">{pct}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ══ PACKAGE USED ══ */}
      {tab === 'packages' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Total PINs Used"    value={stats.usedPins}                    color="#1a7a4a" icon="✅" sub="Reseller registrations" />
            <StatCard label="Package Revenue"    value={fmtS(stats.packageRevenue)}        color="#C9A84C" icon="🎁" sub="From PIN packages (SRP)" />
            <StatCard label="Package Units Sold" value={stats.packageUnitsSold.toLocaleString()} color="#2563eb" icon="📦" sub="Products in packages" />
          </div>
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Package Breakdown</p>
              <p className="text-xs text-gray-400 mt-0.5">Packages used by resellers you registered</p>
            </div>
            <div className="grid grid-cols-4 px-5 py-2 bg-[#f8f9fc]">
              {['Package', 'PINs Used', 'Revenue', 'Share'].map(h => <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>)}
            </div>
            {stats.packageBreakdown.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">No packages used yet</p>
            ) : stats.packageBreakdown.map((p, i) => {
              const total = stats.packageBreakdown.reduce((s, x) => s + x.count, 0) || 1
              const pct = Math.round((p.count / total) * 100)
              return (
                <div key={i} className="grid grid-cols-4 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: i === 0 ? '#C9A84C' : '#f1f5f9', color: i === 0 ? 'white' : '#9ca3af' }}>{i+1}</span>
                    <p className="text-xs font-semibold text-[#0D1B3E]">{p.name}</p>
                  </div>
                  <p className="text-xs font-bold text-[#1a7a4a]">{p.count.toLocaleString()}</p>
                  <p className="text-xs font-bold text-[#C9A84C]">{fmtS(p.revenue)}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-[#C9A84C]" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 w-7">{pct}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ══ PIN REPORT ══ */}
      {tab === 'pins' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total PINs Requested" value={stats.totalPinsRequested} color="#0D1B3E" icon="📋" sub="All time" />
            <StatCard label="PINs Used"            value={stats.usedPins}           color="#1a7a4a" icon="✅" sub="Resellers registered" />
            <StatCard label="Available PINs"       value={stats.unusedPins}         color="#2563eb" icon="🔓" sub="Ready to use" />
            <StatCard label="Used Today"           value={stats.pinsUsedToday}      color="#C9A84C" icon="⚡" sub="Registrations today" />
          </div>

          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
            <p className="text-sm font-bold text-[#0D1B3E] mb-4">PIN Usage Overview</p>
            <div className="space-y-4">
              {[
                { label: 'Used',      value: stats.usedPins,   total: stats.totalPinsRequested, color: '#1a7a4a' },
                { label: 'Available', value: stats.unusedPins, total: stats.totalPinsRequested, color: '#2563eb' },
              ].map(s => {
                const pct = stats.totalPinsRequested > 0 ? Math.round((s.value / stats.totalPinsRequested) * 100) : 0
                return (
                  <div key={s.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-400">{s.label} PINs</span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold" style={{ color: s.color }}>{s.value.toLocaleString()}</span>
                        <span className="text-gray-300">({pct}%)</span>
                      </div>
                    </div>
                    <div className="w-full h-3 bg-[#f1f5f9] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-5 pt-4 border-t border-[#0D1B3E]/5 grid grid-cols-3 gap-4 text-center">
              {[
                { label: 'Conversion Rate', value: stats.totalPinsRequested > 0 ? `${Math.round((stats.usedPins / stats.totalPinsRequested) * 100)}%` : '0%', color: '#1a7a4a' },
                { label: 'Total Resellers', value: stats.totalResellers.toLocaleString(), color: '#0D1B3E' },
                { label: 'This Month',      value: `+${stats.newResellersThisMonth}`, color: '#C9A84C' },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ══ INVENTORY ══ */}
      {tab === 'inventory' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Total Products"  value={stats.totalInventoryItems}      color="#0D1B3E" icon="📦" sub="Product types" />
            <StatCard label="Total Stock"     value={stats.totalStock.toLocaleString()} color="#2563eb" icon="🏭" sub="Units in warehouse" />
            <StatCard label="Low Stock Alert" value={stats.lowStockItems}             color="#e05252" icon="⚠️" sub="Below threshold" badge={stats.lowStockItems > 0 ? 'Restock!' : undefined} />
          </div>
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Inventory Status</p>
            </div>
            <div className="grid grid-cols-4 px-5 py-2 bg-[#f8f9fc]">
              {['Product', 'Stock', 'Threshold', 'Status'].map(h => <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>)}
            </div>
            {stats.inventoryItems.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">No inventory yet</p>
            ) : stats.inventoryItems.map((item, i) => {
              const isLow = item.quantity <= item.low
              const pct   = Math.min(100, Math.round((item.quantity / (item.low * 3 || 1)) * 100))
              return (
                <div key={i} className="grid grid-cols-4 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                  <p className="text-xs font-semibold text-[#0D1B3E] truncate">{item.name}</p>
                  <p className="text-xs font-bold" style={{ color: isLow ? '#e05252' : '#1a7a4a' }}>{item.quantity.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">{item.low.toLocaleString()}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: isLow ? '#e05252' : '#1a7a4a' }} />
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isLow ? 'bg-[#fdecea] text-[#e05252]' : 'bg-[#e8f7ef] text-[#1a7a4a]'}`}>
                      {isLow ? 'Low' : 'OK'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

    </div>
  )
}