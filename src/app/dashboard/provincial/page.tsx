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

function fmt(n: number) {
  return n.toLocaleString()
}

export default function ProvincialDashboardPage() {
  const [stats, setStats]           = useState<Stats | null>(null)
  const [coverageArea, setCoverage] = useState('')
  const [supplier, setSupplier]     = useState<{ full_name: string; username: string; level: string } | null>(null)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    fetch('/api/provincial/stats')
      .then((r) => r.json())
      .then((data) => {
        if (data.stats)       setStats(data.stats)
        if (data.coverage_area) setCoverage(data.coverage_area)
        if (data.supplier)    setSupplier(data.supplier)
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
          <p className="text-[#C9A84C] text-xs uppercase tracking-widest mb-1">Provincial Distributor</p>
          <h1 className="text-white text-xl font-semibold">{coverageArea || 'Your Province'}</h1>
          <p className="text-white/40 text-xs mt-0.5">Coverage area dashboard</p>
        </div>
        {supplier && (
          <div className="text-right hidden sm:block">
            <p className="text-white/40 text-xs">Supplier</p>
            <p className="text-white text-sm font-medium">{supplier.full_name}</p>
            <p className="text-white/40 text-xs">{supplier.level}</p>
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'City Distributors', value: fmt(stats?.cityDistributors || 0), accent: '#0D1B3E', href: null },
          { label: 'Total Orders',      value: fmt(stats?.totalOrders      || 0), accent: '#2563eb', href: '/dashboard/provincial/orders' },
          { label: 'Pending Orders',    value: fmt(stats?.pendingOrders    || 0), accent: '#C9A84C', href: '/dashboard/provincial/orders' },
          { label: 'Delivered Orders',  value: fmt(stats?.deliveredOrders  || 0), accent: '#1a7a4a', href: '/dashboard/provincial/orders' },
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

      {/* Inventory summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Products',  value: fmt(stats?.totalInventoryItems || 0), accent: '#0D1B3E' },
          { label: 'Total Units',     value: fmt(stats?.totalUnits          || 0), accent: '#0D1B3E' },
          { label: 'Low Stock',       value: fmt(stats?.lowStockItems       || 0), accent: '#C9A84C' },
          { label: 'Out of Stock',    value: fmt(stats?.outOfStockItems     || 0), accent: '#e05252' },
        ].map((s) => (
          <Link key={s.label} href="/dashboard/provincial/inventory"
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
          { label: 'View Inventory', href: '/dashboard/provincial/inventory', icon: '📦' },
          { label: 'Place Order',    href: '/dashboard/provincial/orders',    icon: '🛒' },
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