'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stats {
  salesRevenueToday: number
  salesRevenueYesterday: number
  unitsSoldToday: number
  provincialCount: number
  cityCount: number
  totalResellers: number
  newProvincialThisMonth: number
  totalOrders: number
  pendingOrders: number
  deliveredOrders: number
  lowStockItems: number
  outOfStockItems: number
  totalInventoryItems: number
  totalStock: number
  totalRevenue: number
  totalCost: number
  totalProfit: number
  totalUnitsSold: number
  topProducts:    { name: string; qty: number; revenue: number }[]
  topProvincials: { id: string; full_name: string; username: string; province: string; revenue: number; cities: number; orders: number }[]
  topCityDists:   { id: string; full_name: string; username: string; city: string; revenue: number; resellers: number; orders: number }[]
  topResellers:   { id: string; full_name: string; username: string; total_earned: number; package_name: string }[]
  monthlyRevenue: { month: string; revenue: number; orders: number }[]
  recentOrders: {
    id: string; order_number: string | null; status: string
    total_amount: number; created_at: string
    buyer: { full_name: string; username: string }
    seller: { full_name: string }
  }[]
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

function RankedCard({ title, items, valueKey, nameKey, subKey, subKey2, href }: {
  title: string
  items: any[]
  valueKey: string
  nameKey: string
  subKey?: string
  subKey2?: string
  href?: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8">
        <p className="text-sm font-bold text-[#0D1B3E]">{title}</p>
        {href && <Link href={href} className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>}
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-8 text-center text-gray-400 text-sm">No data yet</div>
      ) : items.map((item, i) => (
        <div key={item.id || i} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: i === 0 ? '#C9A84C' : i === 1 ? '#9ca3af' : i === 2 ? '#cd7f32' : '#f1f5f9', color: i < 3 ? 'white' : '#9ca3af' }}>
            {i + 1}
          </div>
          <div className="w-8 h-8 rounded-full bg-[#0D1B3E] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {item[nameKey].charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#0D1B3E] truncate">{item[nameKey]}</p>
            <p className="text-[10px] text-gray-400 truncate">
              {subKey && item[subKey]}
              {subKey && subKey2 && ' · '}
              {subKey2 && item[subKey2]}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs font-bold text-[#1a7a4a]">{fmt(item[valueKey])}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

type Tab = 'overview' | 'network' | 'sales' | 'products' | 'inventory'

export default function RegionalDashboardPage() {
  const [stats, setStats]       = useState<Stats | null>(null)
  const [supplier, setSupplier] = useState<{ full_name: string; username: string; level: string } | null>(null)
  const [coverage, setCoverage] = useState('')
  const [region, setRegion]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<Tab>('overview')

  useEffect(() => {
    fetch('/api/regional/stats')
      .then(r => r.json())
      .then(d => { setStats(d.stats); setSupplier(d.supplier); setCoverage(d.coverage_area); setRegion(d.region_name) })
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
          <h1 className="text-xl font-bold text-[#0D1B3E]">Regional Dashboard</h1>
          <p className="text-xs text-gray-400 mt-0.5">{today} {region && `· ${region}`}</p>
        </div>
        <div className="flex gap-2">
          {supplier && (
            <div className="bg-white border border-[#0D1B3E]/8 rounded-xl px-3 py-2 text-right">
              <p className="text-[10px] text-gray-400">Supplier</p>
              <p className="text-xs font-semibold text-[#0D1B3E]">{supplier.full_name}</p>
            </div>
          )}
          <Link href="/dashboard/regional/orders"
            className="bg-[#0D1B3E] text-white text-xs font-medium rounded-xl px-4 py-2 hover:bg-[#1A2F5E] transition-colors flex items-center justify-center">
            Place Order
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit overflow-x-auto">
        {[
          { key: 'overview',  label: '📊 Overview'  },
          { key: 'network',   label: '🌐 Network'   },
          { key: 'sales',     label: '💰 Sales'     },
          { key: 'products',  label: '📦 Products'  },
          { key: 'inventory', label: '🏭 Inventory' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as Tab)}
            className={`text-xs px-3 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${tab === t.key ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ OVERVIEW ══ */}
      {tab === 'overview' && (
        <>
          {/* Today's KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Today's Sales"     value={fmt(stats.salesRevenueToday)}   color="#1a7a4a" icon="💰" sub={`vs Yesterday: ${fmt(stats.salesRevenueYesterday)}`} />
            <StatCard label="Units Sold Today"  value={stats.unitsSoldToday}             color="#2563eb" icon="📦" sub="To provincials" />
            <StatCard label="Provincial Dists"  value={stats.provincialCount}            color="#C9A84C" icon="🏛️" sub={`+${stats.newProvincialThisMonth} this month`} />
            <StatCard label="City Dists"        value={stats.cityCount}                  color="#8b5cf6" icon="🏢" sub="Across all provincials" />
            <StatCard label="Pending Orders"    value={stats.pendingOrders}              color="#f59e0b" icon="🕐" sub={`${stats.totalOrders} total`} badge={stats.pendingOrders > 0 ? 'Action needed' : undefined} />
          </div>

          {/* Network summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Resellers" value={stats.totalResellers.toLocaleString()} color="#0D1B3E" icon="👥" sub="In this region" />
            <StatCard label="Total Revenue"   value={fmt(stats.totalRevenue)}               color="#1a7a4a" icon="📈" sub="All-time" />
            <StatCard label="Total Profit"    value={fmt(stats.totalProfit)}                color="#2563eb" icon="💎" sub="Revenue minus cost" />
            <StatCard label="Low/Out Stock"   value={stats.lowStockItems + stats.outOfStockItems} color="#e05252" icon="⚠️" sub="Items needing attention" badge={stats.lowStockItems + stats.outOfStockItems > 0 ? 'Restock!' : undefined} />
          </div>

          {/* Top performers + Chart */}
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
            {/* Monthly Chart */}
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
              <p className="text-sm font-bold text-[#0D1B3E] mb-4">Monthly Sales</p>
              <div className="flex items-end gap-2 h-28">
                {stats.monthlyRevenue.map((m, i) => {
                  const max = Math.max(...stats.monthlyRevenue.map(x => x.revenue), 1)
                  const h   = Math.max(4, Math.round((m.revenue / max) * 104))
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                      <div className="w-full rounded-t-md" style={{ height: h, background: i === stats.monthlyRevenue.length - 1 ? '#0D1B3E' : '#bfdbfe' }} />
                      <p className="text-[9px] text-gray-400">{m.month}</p>
                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#0D1B3E] text-white text-[8px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 z-10">
                        {fmt(m.revenue)}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="border-t border-[#0D1B3E]/5 mt-3 pt-3 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-gray-400">YTD Revenue</span><span className="font-bold text-[#0D1B3E]">{fmt(stats.totalRevenue)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">YTD Profit</span><span className="font-bold text-[#1a7a4a]">{fmt(stats.totalProfit)}</span></div>
              </div>
            </div>

            {/* Top Provincial */}
            <RankedCard title="Top Provincial Dists" items={stats.topProvincials} valueKey="revenue" nameKey="full_name" subKey="province" subKey2="cities" href="/dashboard/regional/distributors" />

            {/* Top City */}
            <RankedCard title="Top City Dists" items={stats.topCityDists} valueKey="revenue" nameKey="full_name" subKey="city" subKey2="resellers" href="/dashboard/regional/distributors" />

            {/* Top Resellers */}
            <RankedCard title="Top Resellers" items={stats.topResellers} valueKey="total_earned" nameKey="full_name" subKey="package_name" href="/dashboard/regional/distributors" />
          </div>

          {/* Recent orders + Inventory */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8">
                <p className="text-sm font-bold text-[#0D1B3E]">Recent Orders</p>
                <Link href="/dashboard/regional/orders" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
              </div>
              {stats.recentOrders.length === 0 ? (
                <div className="px-5 py-8 text-center text-gray-400 text-sm">No orders yet</div>
              ) : stats.recentOrders.map(o => (
                <div key={o.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc]">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[o.status] + '15' }}>
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

            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
              <p className="text-sm font-bold text-[#0D1B3E] mb-4">Inventory Summary</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {[
                  { label: 'Total Stock',  value: stats.totalStock.toLocaleString() + ' units', color: '#2563eb' },
                  { label: 'Products',     value: String(stats.totalInventoryItems),              color: '#0D1B3E' },
                  { label: 'Low Stock',    value: String(stats.lowStockItems),                    color: '#f59e0b' },
                  { label: 'Out of Stock', value: String(stats.outOfStockItems),                  color: '#e05252' },
                ].map(s => (
                  <div key={s.label} className="bg-[#f8f9fc] rounded-xl p-3">
                    <p className="text-[10px] text-gray-400">{s.label}</p>
                    <p className="text-lg font-bold mt-0.5" style={{ color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>
              {(stats.lowStockItems > 0 || stats.outOfStockItems > 0) && (
                <Link href="/dashboard/regional/inventory"
                  className="w-full block text-center text-xs bg-[#fdecea] text-[#a03030] py-2 rounded-xl font-medium hover:bg-[#fcd9d9] transition-colors">
                  ⚠️ {stats.lowStockItems + stats.outOfStockItems} item{stats.lowStockItems + stats.outOfStockItems !== 1 ? 's' : ''} need attention
                </Link>
              )}
            </div>
          </div>
        </>
      )}

      {/* ══ NETWORK ══ */}
      {tab === 'network' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Provincial Dists" value={stats.provincialCount}                    color="#C9A84C" icon="🏛️" sub={`+${stats.newProvincialThisMonth} this month`} />
            <StatCard label="City Dists"        value={stats.cityCount}                          color="#2563eb" icon="🏢" sub="Under all provincials" />
            <StatCard label="Total Resellers"   value={stats.totalResellers.toLocaleString()}    color="#1a7a4a" icon="👥" sub="In this region" />
            <StatCard label="Avg Resellers"     value={stats.cityCount > 0 ? Math.round(stats.totalResellers / stats.cityCount) : 0} color="#8b5cf6" icon="📊" sub="Per city dist" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Top Provincials full table */}
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
                <p className="text-sm font-bold text-[#0D1B3E]">Provincial Distributors</p>
              </div>
              <div className="grid grid-cols-4 px-5 py-2.5 bg-[#f8f9fc]">
                {['Name','Province','Cities','Revenue'].map(h => <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{h}</p>)}
              </div>
              {stats.topProvincials.map((p, i) => (
                <div key={p.id} className="grid grid-cols-4 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: i === 0 ? '#C9A84C' : '#f1f5f9', color: i === 0 ? 'white' : '#9ca3af' }}>{i+1}</span>
                    <p className="text-xs font-semibold text-[#0D1B3E] truncate">{p.full_name}</p>
                  </div>
                  <p className="text-[10px] text-gray-400 truncate">{p.province}</p>
                  <p className="text-xs font-semibold text-[#2563eb]">{p.cities}</p>
                  <p className="text-xs font-bold text-[#1a7a4a]">{fmt(p.revenue)}</p>
                </div>
              ))}
            </div>

            {/* Top City Dists */}
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
                <p className="text-sm font-bold text-[#0D1B3E]">Top City Distributors</p>
              </div>
              <div className="grid grid-cols-4 px-5 py-2.5 bg-[#f8f9fc]">
                {['Name','City','Resellers','Revenue'].map(h => <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{h}</p>)}
              </div>
              {stats.topCityDists.map((c, i) => (
                <div key={c.id} className="grid grid-cols-4 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                  <div className="flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: i === 0 ? '#C9A84C' : '#f1f5f9', color: i === 0 ? 'white' : '#9ca3af' }}>{i+1}</span>
                    <p className="text-xs font-semibold text-[#0D1B3E] truncate">{c.full_name}</p>
                  </div>
                  <p className="text-[10px] text-gray-400 truncate">{c.city}</p>
                  <p className="text-xs font-semibold text-[#C9A84C]">{c.resellers}</p>
                  <p className="text-xs font-bold text-[#1a7a4a]">{fmt(c.revenue)}</p>
                </div>
              ))}
            </div>

            {/* Top Resellers */}
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
                <p className="text-sm font-bold text-[#0D1B3E]">Top Resellers</p>
              </div>
              {stats.topResellers.map((r, i) => (
                <div key={r.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc]">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{ background: i === 0 ? '#C9A84C' : i === 1 ? '#9ca3af' : i === 2 ? '#cd7f32' : '#f1f5f9', color: i < 3 ? 'white' : '#9ca3af' }}>{i+1}</div>
                  <div className="w-7 h-7 rounded-full bg-[#0D1B3E] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                    {r.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#0D1B3E] truncate">{r.full_name}</p>
                    <p className="text-[10px] text-gray-400">{r.package_name}</p>
                  </div>
                  <p className="text-xs font-bold text-[#1a7a4a]">{fmt(r.total_earned)}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ══ SALES ══ */}
      {tab === 'sales' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Revenue"  value={fmt(stats.totalRevenue)}              color="#1a7a4a" icon="💰" />
            <StatCard label="Total Cost"     value={fmt(stats.totalCost)}                 color="#e05252" icon="🏷️" />
            <StatCard label="Total Profit"   value={fmt(stats.totalProfit)}               color="#2563eb" icon="📈" sub={`${stats.totalRevenue > 0 ? Math.round((stats.totalProfit/stats.totalRevenue)*100) : 0}% margin`} />
            <StatCard label="Units Sold"     value={stats.totalUnitsSold.toLocaleString()} color="#C9A84C" icon="📦" />
          </div>
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Monthly Sales Overview</p>
            </div>
            <div className="grid grid-cols-3 px-5 py-2.5 bg-[#f8f9fc]">
              {['Month','Revenue','Orders'].map(h => <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>)}
            </div>
            {stats.monthlyRevenue.map((m, i) => (
              <div key={i} className="grid grid-cols-3 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                <p className="text-xs font-semibold text-[#0D1B3E]">{m.month}</p>
                <p className="text-xs font-bold text-[#1a7a4a]">{fmt(m.revenue)}</p>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-[#2563eb]">{m.orders}</p>
                  <div className="flex-1 h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#2563eb]"
                      style={{ width: `${Math.min(100, (m.orders / (Math.max(...stats.monthlyRevenue.map(x => x.orders)) || 1)) * 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ══ PRODUCTS ══ */}
      {tab === 'products' && (
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
            <p className="text-sm font-bold text-[#0D1B3E]">Product Movement</p>
            <p className="text-xs text-gray-400 mt-0.5">Based on delivered orders to provincial distributors</p>
          </div>
          <div className="grid grid-cols-4 px-5 py-2.5 bg-[#f8f9fc]">
            {['Product','Units Sold','Revenue','Share'].map(h => <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>)}
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
                <p className="text-xs font-bold text-[#2563eb]">{fmt(p.revenue)}</p>
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
      )}

      {/* ══ INVENTORY ══ */}
      {tab === 'inventory' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Products"  value={stats.totalInventoryItems}                           color="#0D1B3E" icon="📦" />
            <StatCard label="Total Stock"     value={stats.totalStock.toLocaleString() + ' units'}        color="#2563eb" icon="🏭" />
            <StatCard label="Low Stock"       value={stats.lowStockItems}                                  color="#f59e0b" icon="⚠️" badge={stats.lowStockItems > 0 ? 'Restock!' : undefined} />
            <StatCard label="Out of Stock"    value={stats.outOfStockItems}                               color="#e05252" icon="❌" badge={stats.outOfStockItems > 0 ? 'Urgent!' : undefined} />
          </div>
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Inventory Details</p>
            </div>
            <div className="grid grid-cols-4 px-5 py-2.5 bg-[#f8f9fc]">
              {['Product','Stock','Threshold','Status'].map(h => <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>)}
            </div>
            {stats.inventoryItems.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">No inventory yet</p>
            ) : stats.inventoryItems.map((item, i) => {
              const isLow = item.quantity <= item.low && item.quantity > 0
              const isOut = item.quantity === 0
              const pct   = Math.min(100, Math.round((item.quantity / (item.low * 3 || 1)) * 100))
              return (
                <div key={i} className="grid grid-cols-4 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                  <p className="text-xs font-semibold text-[#0D1B3E] truncate">{item.name}</p>
                  <p className="text-xs font-bold" style={{ color: isOut ? '#e05252' : isLow ? '#f59e0b' : '#1a7a4a' }}>{item.quantity.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">{item.low.toLocaleString()}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: isOut ? '#e05252' : isLow ? '#f59e0b' : '#1a7a4a' }} />
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isOut ? 'bg-[#fdecea] text-[#e05252]' : isLow ? 'bg-[#fffbeb] text-[#f59e0b]' : 'bg-[#e8f7ef] text-[#1a7a4a]'}`}>
                      {isOut ? 'Out' : isLow ? 'Low' : 'OK'}
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