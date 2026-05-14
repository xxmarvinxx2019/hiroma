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
  totalPinRevenue: number
  totalPinsSold: number
  totalUnitsSold: number
  totalRevenue: number
  totalCost: number
  grossProfit: number
  topProducts: {
    product_id: string
    name: string
    units_sold: number
    revenue: number
    cost: number
    profit: number
  }[]
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

interface PinSale {
  id: string
  total_amount: number
  created_at: string
  notes: string | null
  buyer: { full_name: string; username: string }
}

interface DistributorSales {
  city_dist_id: string
  _count: { id: number }
  _sum: { price: number }
  city_distributor: { full_name: string; username: string }
}

interface PackageSales {
  package_id: string
  _count: { id: number }
  package: { name: string; price: number }
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
      style={{ borderTop: `2px solid ${accent === 'gold' ? '#C9A84C' : '#0D1B3E'}` }}
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
  const [pinSales, setPinSales] = useState<PinSale[]>([])
  const [distSales, setDistSales] = useState<DistributorSales[]>([])
  const [packageSales, setPackageSales] = useState<PackageSales[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'pin-sales' | 'products'>('overview')

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/stats').then((r) => r.json()),
      fetch('/api/admin/resellers/recent').then((r) => r.json()),
      fetch('/api/admin/payouts/recent').then((r) => r.json()),
      fetch('/api/admin/pins/sales').then((r) => r.json()),
    ])
      .then(([statsData, resellersData, payoutsData, salesData]) => {
        setStats(statsData.stats)
        setRecentResellers(resellersData.resellers || [])
        setRecentPayouts(payoutsData.payouts || [])
        setPinSales(salesData.recentSales || [])
        setDistSales(salesData.byDistributor || [])
        setPackageSales(salesData.byPackage || [])
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
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Dashboard overview</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {new Date().toLocaleDateString('en-PH', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
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
            href="/dashboard/admin/distributors"
            className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors"
          >
            + Add distributor
          </Link>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 mb-6 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit">
        {[
          { key: 'overview',  label: 'Overview' },
          { key: 'pin-sales',  label: '💰 PIN Sales' },
          { key: 'products',   label: '📦 Product Sales' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`text-xs px-4 py-2 rounded-lg font-medium transition-all duration-150 ${
              activeTab === tab.key
                ? 'bg-[#0D1B3E] text-white'
                : 'text-gray-400 hover:text-[#0D1B3E]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ══ OVERVIEW TAB ══ */}
      {activeTab === 'overview' && (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Total resellers"
              value={stats?.totalResellers?.toLocaleString() || '0'}
              sub={`+${stats?.newResellersToday || 0} today`}
              accent="navy"
            />
            <StatCard
              label="PIN revenue today"
              value={`₱${(stats?.totalPinRevenue || 0).toLocaleString()}`}
              sub={`${stats?.pinsSoldToday || 0} PINs sold`}
              accent="gold"
            />
            <StatCard
              label="Pending payouts"
              value={`₱${(stats?.pendingPayoutsAmount || 0).toLocaleString()}`}
              sub={`${stats?.pendingPayouts || 0} requests`}
              accent="navy"
            />
            <StatCard
              label="Active distributors"
              value={stats?.totalDistributors || 0}
              sub="Across 3 levels"
              accent="gold"
            />
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

            {/* Recent Resellers */}
            <div className="md:col-span-2 bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/8">
                <h2 className="text-sm font-semibold text-[#0D1B3E]">Recent registrations</h2>
                <Link href="/dashboard/admin/resellers" className="text-xs text-[#C9A84C] hover:underline font-medium">View all</Link>
              </div>
              <div className="grid grid-cols-4 px-4 py-2 bg-[#F0F2F8]">
                {['Name', 'City', 'Package', 'Date'].map((h) => (
                  <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
                ))}
              </div>
              {recentResellers.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-400 text-sm">No resellers yet</div>
              ) : (
                recentResellers.map((r) => (
                  <div key={r.id} className="grid grid-cols-4 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors">
                    <div>
                      <p className="text-xs font-medium text-[#0D1B3E]">{r.full_name}</p>
                      <p className="text-xs text-gray-400">@{r.username}</p>
                    </div>
                    <p className="text-xs text-gray-400 self-center">{r.address || '—'}</p>
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
                <h2 className="text-sm font-semibold text-[#0D1B3E] mb-3">Quick actions</h2>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Generate PIN', href: '/dashboard/admin/pins', icon: '🔑', gold: true },
                    { label: 'Approve payout', href: '/dashboard/admin/payouts', icon: '💸', gold: false },
                    { label: 'Add product', href: '/dashboard/admin/products', icon: '🧴', gold: false },
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
                      <p className="text-xs font-medium text-[#0D1B3E] leading-tight">{action.label}</p>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Pending Payouts */}
              <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden flex-1">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/8">
                  <h2 className="text-sm font-semibold text-[#0D1B3E]">Pending payouts</h2>
                  <Link href="/dashboard/admin/payouts" className="text-xs text-[#C9A84C] hover:underline font-medium">View all</Link>
                </div>
                {recentPayouts.length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-400 text-sm">No pending payouts</div>
                ) : (
                  recentPayouts.map((payout) => (
                    <div key={payout.id} className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50">
                      <div>
                        <p className="text-xs font-medium text-[#0D1B3E]">{payout.user.full_name}</p>
                        <p className="text-xs text-gray-400">{new Date(payout.requested_at).toLocaleDateString('en-PH')}</p>
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
        </>
      )}

      {/* ══ PIN SALES TAB ══ */}
      {activeTab === 'pin-sales' && (
        <>
          {/* PIN Revenue Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              label="Total PIN revenue"
              value={`₱${(stats?.totalPinRevenue || 0).toLocaleString()}`}
              sub="All time"
              accent="gold"
            />
            <StatCard
              label="Total PINs sold"
              value={stats?.totalPinsSold || 0}
              sub="All time"
              accent="navy"
            />
            <StatCard
              label="PINs sold today"
              value={stats?.pinsSoldToday || 0}
              accent="gold"
            />
            <StatCard
              label="Unused PINs"
              value={stats?.activePins || 0}
              sub="Ready to use"
              accent="navy"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

            {/* Recent PIN Sales */}
            <div className="md:col-span-2 bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="px-4 py-3 border-b border-[#0D1B3E]/8">
                <h2 className="text-sm font-semibold text-[#0D1B3E]">Recent PIN sales</h2>
                <p className="text-xs text-gray-400 mt-0.5">Every PIN assignment to a city distributor is a sale</p>
              </div>
              <div className="grid grid-cols-4 px-4 py-2 bg-[#F0F2F8]">
                {['City distributor', 'Details', 'Amount', 'Date'].map((h) => (
                  <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
                ))}
              </div>
              {pinSales.length === 0 ? (
                <div className="px-4 py-8 text-center text-gray-400 text-sm">No PIN sales yet</div>
              ) : (
                pinSales.map((sale) => (
                  <div key={sale.id} className="grid grid-cols-4 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center">
                    <div>
                      <p className="text-xs font-medium text-[#0D1B3E]">{sale.buyer.full_name}</p>
                      <p className="text-xs text-gray-400">@{sale.buyer.username}</p>
                    </div>
                    <p className="text-xs text-gray-400 truncate">{sale.notes || '—'}</p>
                    <p className="text-xs font-semibold text-[#C9A84C]">
                      ₱{Number(sale.total_amount).toLocaleString()}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(sale.created_at).toLocaleDateString('en-PH')}
                    </p>
                  </div>
                ))
              )}
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-4">

              {/* Top distributors by sales */}
              <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
                <div className="px-4 py-3 border-b border-[#0D1B3E]/8">
                  <h2 className="text-sm font-semibold text-[#0D1B3E]">Top city distributors</h2>
                  <p className="text-xs text-gray-400 mt-0.5">By PIN purchases</p>
                </div>
                {distSales.length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-400 text-sm">No data yet</div>
                ) : (
                  distSales.slice(0, 5).map((d, index) => (
                    <div key={d.city_dist_id} className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/5">
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{
                          background: index === 0 ? '#C9A84C' : '#F0F2F8',
                          color: index === 0 ? '#0D1B3E' : '#8892a4',
                        }}
                      >
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#0D1B3E] truncate">
                          {d.city_distributor?.full_name || '—'}
                        </p>
                        <p className="text-xs text-gray-400">{d._count.id} PINs bought</p>
                      </div>
                      <p className="text-xs font-semibold text-[#C9A84C]">
                        ₱{Number(d._sum.price || 0).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>

              {/* Top packages by sales */}
              <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
                <div className="px-4 py-3 border-b border-[#0D1B3E]/8">
                  <h2 className="text-sm font-semibold text-[#0D1B3E]">Top packages</h2>
                  <p className="text-xs text-gray-400 mt-0.5">By PINs sold</p>
                </div>
                {packageSales.length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-400 text-sm">No data yet</div>
                ) : (
                  packageSales.map((p, index) => (
                    <div key={p.package_id} className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/5">
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                        style={{
                          background: index === 0 ? '#C9A84C' : '#F0F2F8',
                          color: index === 0 ? '#0D1B3E' : '#8892a4',
                        }}
                      >
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#0D1B3E]">
                          {p.package?.name || '—'}
                        </p>
                        <p className="text-xs text-gray-400">{p._count.id} PINs sold</p>
                      </div>
                      <p className="text-xs font-semibold text-[#C9A84C]">
                        ₱{Number(p.package?.price || 0).toLocaleString()} each
                      </p>
                    </div>
                  ))
                )}
              </div>

            </div>
          </div>
        </>
      )}

      {/* PRODUCT SALES TAB */}
      {activeTab === 'products' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Units Sold', value: (stats?.totalUnitsSold || 0).toLocaleString(),      accent: '#0D1B3E' },
              { label: 'Total Revenue',    value: `₱${(stats?.totalRevenue || 0).toLocaleString()}`,  accent: '#2563eb' },
              { label: 'Total Cost',       value: `₱${(stats?.totalCost    || 0).toLocaleString()}`,  accent: '#e05252' },
              { label: 'Gross Profit',     value: `₱${(stats?.grossProfit  || 0).toLocaleString()}`,  accent: '#1a7a4a' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
                style={{ borderTop: `2px solid ${s.accent}` }}>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
                <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
              </div>
            ))}
          </div>

          {(stats?.totalRevenue || 0) > 0 && (
            <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-5 mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-[#0D1B3E]">Gross Profit Margin</p>
                <p className="text-sm font-semibold text-[#1a7a4a]">
                  {(((stats?.grossProfit || 0) / (stats?.totalRevenue || 1)) * 100).toFixed(1)}%
                </p>
              </div>
              <div className="w-full bg-[#F0F2F8] rounded-full h-3">
                <div className="h-3 rounded-full bg-[#1a7a4a]"
                  style={{ width: `${Math.min(100, ((stats?.grossProfit || 0) / (stats?.totalRevenue || 1)) * 100)}%` }} />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1.5">
                <span>Cost: ₱{(stats?.totalCost || 0).toLocaleString()}</span>
                <span>Revenue: ₱{(stats?.totalRevenue || 0).toLocaleString()}</span>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-semibold text-[#0D1B3E]">Top Selling Products</p>
              <p className="text-xs text-gray-400 mt-0.5">Based on delivered orders</p>
            </div>
            <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
              {['Product', 'Units Sold', 'Revenue', 'Cost', 'Profit'].map((h) => (
                <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
              ))}
            </div>
            {(stats?.topProducts || []).length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">No delivered orders yet.</p>
            ) : (
              (stats?.topProducts || []).map((p, i) => (
                <div key={p.product_id}
                  className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 items-center">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: i === 0 ? '#C9A84C' : '#F0F2F8', color: i === 0 ? '#0D1B3E' : '#8892a4' }}>
                      {i + 1}
                    </span>
                    <p className="text-xs font-medium text-[#0D1B3E] truncate">{p.name}</p>
                  </div>
                  <p className="text-xs font-semibold text-[#0D1B3E]">{p.units_sold.toLocaleString()}</p>
                  <p className="text-xs font-semibold text-[#2563eb]">₱{p.revenue.toLocaleString()}</p>
                  <p className="text-xs text-[#e05252]">₱{p.cost.toLocaleString()}</p>
                  <p className="text-xs font-semibold text-[#1a7a4a]">₱{p.profit.toLocaleString()}</p>
                </div>
              ))
            )}
          </div>
        </>
      )}

    </div>
  )
}