'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stats {
  cityDistributors: number
  totalOrders: number
  pendingOrders: number
  deliveredOrders: number
  lowStockItems: number
  outOfStockItems: number
  totalInventoryItems: number
  totalUnits: number
}

export default function RegionalDashboardPage() {
  const [stats, setStats]       = useState<Stats | null>(null)
  const [coverageArea, setCoverage] = useState('')
  const [regionName, setRegionName] = useState('')
  const [supplier, setSupplier] = useState<{ full_name: string; username: string; level: string } | null>(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    fetch('/api/regional/stats')
      .then((r) => r.json())
      .then((data) => {
        if (data.stats)        setStats(data.stats)
        if (data.coverage_area) setCoverage(data.coverage_area)
        if (data.region_name)   setRegionName(data.region_name)
        if (data.supplier)     setSupplier(data.supplier)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Welcome banner */}
      <div className="bg-[#0D1B3E] rounded-2xl p-5 flex items-center justify-between">
        <div>
          <p className="text-[#C9A84C] text-xs uppercase tracking-widest mb-1">Regional Distributor</p>
          <h1 className="text-white text-xl font-semibold">{coverageArea || regionName || 'Your Region'}</h1>
          <p className="text-white/40 text-xs mt-0.5">Regional coverage dashboard</p>
        </div>
        {supplier && (
          <div className="text-right hidden sm:block">
            <p className="text-white/40 text-xs">Supplier</p>
            <p className="text-white text-sm font-medium">{supplier.full_name}</p>
            <p className="text-white/40 text-xs">{supplier.level}</p>
          </div>
        )}
      </div>

      {/* Order stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Provincial Dists', value: (stats?.cityDistributors || 0).toLocaleString(), accent: '#0D1B3E', href: null },
          { label: 'Total Orders',     value: (stats?.totalOrders      || 0).toLocaleString(), accent: '#2563eb', href: '/dashboard/regional/orders' },
          { label: 'Pending Orders',   value: (stats?.pendingOrders    || 0).toLocaleString(), accent: '#C9A84C', href: '/dashboard/regional/orders' },
          { label: 'Delivered Orders', value: (stats?.deliveredOrders  || 0).toLocaleString(), accent: '#1a7a4a', href: '/dashboard/regional/orders' },
        ].map((s) => {
          const inner = (
            <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 h-full"
              style={{ borderTop: `2px solid ${s.accent}` }}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
              <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
            </div>
          )
          return s.href
            ? <Link key={s.label} href={s.href} className="block hover:scale-[1.01] transition-transform">{inner}</Link>
            : <div key={s.label}>{inner}</div>
        })}
      </div>

      {/* Inventory stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Products', value: (stats?.totalInventoryItems || 0).toLocaleString(), accent: '#0D1B3E' },
          { label: 'Total Units',    value: (stats?.totalUnits          || 0).toLocaleString(), accent: '#0D1B3E' },
          { label: 'Low Stock',      value: (stats?.lowStockItems       || 0).toLocaleString(), accent: '#C9A84C' },
          { label: 'Out of Stock',   value: (stats?.outOfStockItems     || 0).toLocaleString(), accent: '#e05252' },
        ].map((s) => (
          <Link key={s.label} href="/dashboard/regional/inventory"
            className="block hover:scale-[1.01] transition-transform">
            <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
              style={{ borderTop: `2px solid ${s.accent}` }}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{s.label}</p>
              <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'View Inventory', href: '/dashboard/regional/inventory', icon: '📦' },
          { label: 'Place Order',    href: '/dashboard/regional/orders',    icon: '🛒' },
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