'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ============================================================
// TYPES
// ============================================================

interface CityStats {
  totalResellers: number
  activeResellers: number
  unusedPins: number
  usedPins: number
  totalOrders: number
  pendingOrders: number
  lowStockItems: number
  totalRevenue:    number
  totalCost:       number
  totalProfit:     number
  totalUnitsSold:  number
  totalInventoryItems: number
}

interface RecentReseller {
  id: string
  full_name: string
  username: string
  created_at: string
  reseller_profile: {
    package: { name: string } | null
  } | null
}

interface LowStockItem {
  id: string
  quantity: number
  low_stock_threshold: number
  product: { name: string; type: string }
}

// ============================================================
// STAT CARD
// ============================================================

function StatCard({
  label,
  value,
  sub,
  accent,
  href,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: 'gold' | 'navy' | 'green' | 'red'
  href?: string
}) {
  const colors = {
    gold: '#C9A84C',
    navy: '#0D1B3E',
    green: '#1D9E75',
    red: '#c0392b',
  }
  const color = colors[accent || 'navy']

  const content = (
    <div
      className="bg-white rounded-xl p-4 border border-[#0D1B3E]/8 hover:shadow-md transition-shadow"
      style={{ borderTop: `2px solid ${color}` }}
    >
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className="text-2xl font-semibold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )

  if (href) return <Link href={href}>{content}</Link>
  return content
}

// ============================================================
// PAGE
// ============================================================

export default function CityDashboardPage() {
  const [stats, setStats] = useState<CityStats | null>(null)
  const [recentResellers, setRecentResellers] = useState<RecentReseller[]>([])
  const [lowStock, setLowStock] = useState<LowStockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me').then((r) => r.json()),
      fetch('/api/city/stats').then((r) => r.json()),
      fetch('/api/city/resellers/recent').then((r) => r.json()),
      fetch('/api/city/inventory/low-stock').then((r) => r.json()),
    ])
      .then(([meData, statsData, resellersData, stockData]) => {
        setUser(meData.user)
        setStats(statsData.stats)
        setRecentResellers(resellersData.resellers || [])
        setLowStock(stockData.items || [])
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

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">
            Welcome, {user?.full_name?.split(' ')[0]}!
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            City distributor · {user?.distributor_profile?.coverage_area || 'Your city'}
          </p>
        </div>
        <Link
          href="/dashboard/city/resellers"
          className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors"
        >
          + Register reseller
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total resellers"
          value={stats?.totalResellers || 0}
          sub={`${stats?.activeResellers || 0} active`}
          accent="navy"
          href="/dashboard/city/resellers"
        />
        <StatCard
          label="Available PINs"
          value={stats?.unusedPins || 0}
          sub={`${stats?.usedPins || 0} used`}
          accent="gold"
          href="/dashboard/city/pins"
        />
        <StatCard
          label="Pending orders"
          value={stats?.pendingOrders || 0}
          sub={`${stats?.totalOrders || 0} total`}
          accent={stats?.pendingOrders ? 'red' : 'green'}
          href="/dashboard/city/orders"
        />
        <StatCard
          label="Low stock alerts"
          value={stats?.lowStockItems || 0}
          sub={`${stats?.totalInventoryItems || 0} total items`}
          accent={stats?.lowStockItems ? 'red' : 'green'}
          href="/dashboard/city/inventory"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Recent Resellers */}
        <div className="md:col-span-2 bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/8">
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Recently registered resellers</h2>
            <Link href="/dashboard/city/resellers" className="text-xs text-[#C9A84C] hover:underline font-medium">
              View all
            </Link>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-4 px-4 py-2 bg-[#F0F2F8]">
            {['Name', 'Username', 'Package', 'Date'].map((h) => (
              <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
            ))}
          </div>

          {recentResellers.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-gray-400 text-sm mb-2">No resellers registered yet</p>
              <Link href="/dashboard/city/resellers" className="text-xs text-[#C9A84C] hover:underline">
                Register your first reseller →
              </Link>
            </div>
          ) : (
            recentResellers.map((r) => (
              <div key={r.id} className="grid grid-cols-4 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center">
                <p className="text-xs font-medium text-[#0D1B3E]">{r.full_name}</p>
                <p className="text-xs text-gray-400">@{r.username}</p>
                <span>
                  <span className="text-xs bg-[#fef6e4] text-[#9a6f1e] px-2 py-0.5 rounded-full">
                    {r.reseller_profile?.package?.name || '—'}
                  </span>
                </span>
                <p className="text-xs text-gray-400">
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
            <div className="flex flex-col gap-2">
              {[
                { label: 'Register new reseller', href: '/dashboard/city/resellers', icon: '👥', gold: true },
                { label: 'View my PINs', href: '/dashboard/city/pins', icon: '🔑', gold: false },
                { label: 'Check inventory', href: '/dashboard/city/inventory', icon: '📦', gold: false },
                { label: 'Place order', href: '/dashboard/city/orders', icon: '🛒', gold: true },
              ].map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className="flex items-center gap-3 bg-[#F0F2F8] hover:bg-[#e4e7f0] rounded-lg px-3 py-2.5 transition-colors"
                >
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center text-xs flex-shrink-0"
                    style={{ background: action.gold ? '#C9A84C' : '#0D1B3E' }}
                  >
                    {action.icon}
                  </div>
                  <p className="text-xs font-medium text-[#0D1B3E]">{action.label}</p>
                </Link>
              ))}
            </div>
          </div>

          {/* Low Stock Alerts */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden flex-1">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/8">
              <h2 className="text-sm font-semibold text-[#0D1B3E]">Low stock alerts</h2>
              <Link href="/dashboard/city/inventory" className="text-xs text-[#C9A84C] hover:underline font-medium">
                View all
              </Link>
            </div>
            {lowStock.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-[#1D9E75] text-xs font-medium">✓ All stock levels are good</p>
              </div>
            ) : (
              lowStock.map((item) => (
                <div key={item.id} className="flex items-center justify-between px-4 py-3 border-b border-[#0D1B3E]/5">
                  <div>
                    <p className="text-xs font-medium text-[#0D1B3E]">{item.product.name}</p>
                    <p className="text-xs text-gray-400">Threshold: {item.low_stock_threshold}</p>
                  </div>
                  <span className="text-xs font-semibold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                    {item.quantity} left
                  </span>
                </div>
              ))
            )}
          </div>

        </div>
      </div>
          {/* Sales Summary */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-5 mt-2">
            <p className="text-sm font-semibold text-[#0D1B3E] mb-4">Sales Summary</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Units Sold',    value: (stats?.totalUnitsSold || 0).toLocaleString(),                                                          accent: '#0D1B3E' },
                { label: 'Total Revenue', value: `₱${(stats?.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,             accent: '#2563eb' },
                { label: 'Total Cost',    value: `₱${(stats?.totalCost    || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,             accent: '#e05252' },
                { label: 'Net Profit',    value: `₱${(stats?.totalProfit  || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,             accent: '#1a7a4a' },
              ].map((s) => (
                <div key={s.label} className="bg-[#F0F2F8] rounded-xl p-3"
                  style={{ borderTop: `2px solid ${s.accent}` }}>
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
                  <p className="text-lg font-semibold" style={{ color: s.accent }}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>

    </div>
  )
}