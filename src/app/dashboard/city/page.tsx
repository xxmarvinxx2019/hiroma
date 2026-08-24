'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

interface Stats {
  period: { value: CityStatsPeriod; label: string; start: string | null; end: string | null }
  financialIntegrity: { ledger_rows: number; legacy_reconstructed_rows: number; unclassified_used_pins: number; ledger_formula_mismatches: number; order_cost_fallback_rows: number; package_unit_fallback_rows: number }
  accountType: string
  isStaff: boolean
  staffPermissions: string[]
  salesRevenueToday: number
  salesRevenueYesterday: number
  registrationProfitToday: number
  registrationProfitYesterday: number
  resellerOrderProfitToday: number
  nonMemberProfitToday: number
  cityGrossProfitToday: number
  unitsSoldToday: number
  newResellersToday: number
  newResellersYesterday: number
  newResellersThisMonth: number
  pinsUsedToday: number
  pinsUsedInPeriod: number
  totalResellers: number
  activeResellers: number
  unusedPins: number
  usedPins: number
  cancelledPins: number
  expiredPins: number
  totalPinsRequested: number
  totalOrders: number
  pendingOrders: number
  lowStockItems: number
  totalInventoryItems: number
  totalStock: number
  totalInventoryCost: number
  totalRevenue: number
  totalCost: number
  totalProfit: number
  totalUnitsSold: number
  orderRevenue: number
  orderCost: number
  orderProfit: number
  orderUnitsSold: number
  resellerProductOrders: { revenue: number; cost: number; profit: number; units: number }
  walkInProductOrders: { revenue: number; cost: number; profit: number; units: number }
  registrationCount: number
  packageRevenue: number
  packageCost: number
  packagePinRemittance: number
  packageCustomerPayments: number
  packageUnitsSold: number
  registrationProductProfit: number
  combinedProductRevenue: number
  combinedProductCost: number
  combinedProductProfit: number
  totalCustomerCashCollected: number
  topProducts: { product_id: string; name: string; qty: number; revenue: number; cost: number }[]
  packageBreakdown: { package_id: string; name: string; count: number; units: number; customer_payment: number; revenue: number; pin_allocation: number; cost: number; profit: number }[]
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

const fmt = (n: number) => {
  const value = Number(n)
  return `₱${(Number.isFinite(value) ? value : 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
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
  const cardColor = color || '#0D1B3E'
  const foreground = '#FFFFFF'
  const overlay = '#FFFFFF24'
  const supportingTextShadow = '0 1px 2px rgba(0, 0, 0, 0.48)'
  const valueTextShadow = '0 2px 3px rgba(0, 0, 0, 0.46)'

  return (
    <div className="rounded-xl border p-4 hover:shadow-lg hover:-translate-y-0.5 transition-all"
      style={{ borderColor: cardColor, backgroundColor: cardColor, color: foreground }}>
      <div className="flex items-start justify-between mb-3">
        {icon && <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: overlay }}>{icon}</div>}
        {badge && <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: overlay, color: foreground }}>{badge}</span>}
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: foreground, opacity: 0.96, textShadow: supportingTextShadow }}>{label}</p>
      <p className="text-2xl font-extrabold tracking-tight" style={{ color: foreground, textShadow: valueTextShadow }}>{value}</p>
      {sub && <p className="text-xs font-medium leading-relaxed mt-1" style={{ color: foreground, opacity: 0.94, textShadow: supportingTextShadow }}>{sub}</p>}
    </div>
  )
}
type ReportTab = 'overview' | 'sales' | 'products' | 'packages' | 'pins' | 'inventory'
type CityStatsPeriod = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'all_time' | 'custom'

export default function CityDashboardPage() {
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<ReportTab>('overview')
  const [period, setPeriod]   = useState<CityStatsPeriod>('today')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showSalesBreakdown, setShowSalesBreakdown] = useState(false)
  const [showCostBreakdown, setShowCostBreakdown] = useState(false)

useEffect(() => {
    const query = new URLSearchParams({ period: period === 'custom' && (!customStart || !customEnd) ? 'all_time' : period })
    if (period === 'custom' && customStart && customEnd) {
      query.set('start', customStart)
      query.set('end', customEnd)
    }
    setLoading(true)
    fetch(`/api/city/stats?${query.toString()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setStats(d.stats))
      .finally(() => setLoading(false))
  }, [period, customStart, customEnd])

  const selectPeriod = (nextPeriod: CityStatsPeriod) => {
    if (nextPeriod === 'custom' && (!customStart || !customEnd)) {
      const todayValue = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
      setCustomStart(todayValue)
      setCustomEnd(todayValue)
    }
    setPeriod(nextPeriod)
  }

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
  const accountLabel = stats.accountType === 'branch' ? 'Branch' : 'City Distributor'

  return (
    <div className="w-full space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B3E]">
            {stats.accountType === 'branch' ? 'Branch Dashboard' : 'City Dashboard'}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">{today}</p>
        </div>
        <div className="flex gap-2">
          {!stats.isStaff && <Link href="/dashboard/city/staff"
            className="bg-white border border-[#C9A84C] text-[#9a6f1e] text-xs font-bold rounded-xl px-4 py-2 hover:bg-[#fef9ee] transition-colors">
            + Register Staff
          </Link>}
          {(!stats.isStaff || stats.staffPermissions.includes('register_reseller')) && <Link href="/dashboard/city/resellers/register"
            className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-bold rounded-xl px-4 py-2 hover:bg-[#E8C96A] transition-colors">
            + Register Reseller
          </Link>}
          {(!stats.isStaff || stats.staffPermissions.includes('orders')) && <Link href="/dashboard/city/orders?action=walk-in"
            className="bg-[#010521] text-white text-xs font-medium rounded-xl px-4 py-2 hover:bg-[#1A2F5E] transition-colors">
            🛒 Walk-in Sale
          </Link>}
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
            className={`text-xs px-3 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${tab === t.key ? 'bg-[#010521] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ OVERVIEW ══ */}
      <div className="bg-white border border-[#0D1B3E]/8 rounded-xl px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-[#0D1B3E]">{tab === 'inventory' ? 'Live inventory snapshot' : 'Sales reporting period'}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{tab === 'inventory' ? 'Shows current on-hand stock, thresholds, and inventory cost value. A date filter does not apply to live stock.' : 'Applies to Sales, Products, Packages, and PIN usage activity. Inventory and available PIN stock stay live.'}</p>
        </div>
        {tab !== 'inventory' && <div className="flex flex-wrap items-center gap-2">
          <select value={period} onChange={(event) => selectPeriod(event.target.value as CityStatsPeriod)} className="bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-lg px-3 py-2 text-sm font-semibold text-[#0D1B3E] outline-none">
            <option value="today">Daily — Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_week">Weekly — This Week</option>
            <option value="this_month">Monthly — This Month</option>
            <option value="this_year">Yearly — This Year</option>
            <option value="all_time">All Time</option>
            <option value="custom">Custom Range</option>
          </select>
          {period === 'custom' && <>
            <input aria-label="Custom start date" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-lg px-2 py-2 text-xs text-[#0D1B3E]" />
            <span className="text-xs text-gray-400">to</span>
            <input aria-label="Custom end date" type="date" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.target.value)} className="bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-lg px-2 py-2 text-xs text-[#0D1B3E]" />
          </>}
          <span className="text-[11px] font-semibold text-[#1a7a4a] whitespace-nowrap">{stats.period.label}</span>
        </div>}
      </div>
      {(stats.financialIntegrity.legacy_reconstructed_rows > 0 || stats.financialIntegrity.unclassified_used_pins > 0 || stats.financialIntegrity.ledger_formula_mismatches > 0 || stats.financialIntegrity.order_cost_fallback_rows > 0) && (
        <div className="rounded-xl border border-[#e8b3b3] bg-[#fff3f3] px-4 py-3 text-xs text-[#9d3030]">
          <p className="font-bold">Financial integrity attention required</p>
          <p className="mt-1">Ledger rows: {stats.financialIntegrity.ledger_rows}. Legacy registration rows reconstructed: {stats.financialIntegrity.legacy_reconstructed_rows}. Unclassified used PINs excluded from registration profit: {stats.financialIntegrity.unclassified_used_pins}. Formula mismatches: {stats.financialIntegrity.ledger_formula_mismatches}. Legacy order items using current catalog cost fallback: {stats.financialIntegrity.order_cost_fallback_rows}.</p>
          <p className="mt-1">Totals remain transparent, but each legacy/reconstructed row should be audited and backfilled before relying on it as an immutable historical financial record.</p>
        </div>
      )}
      {tab === 'overview' && (
        <>
          {/* Selected-period KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label={`${stats.period.label} Repeat + SRP Product Sales`} value={fmt(stats.orderRevenue)} color="#1a7a4a" icon="💰" sub="Revenue before product cost" />
            <StatCard label={`${stats.period.label} Registration Product Sales`} value={fmt(stats.packageRevenue)} color="#8b5cf6" icon="📈" sub="Registration product value · PIN allocation excluded" />
            <StatCard label={`${stats.period.label} Product Order Units Sold`} value={stats.orderUnitsSold} color="#2563eb" icon="📦" sub="Delivered product orders" />
            <StatCard label={`${stats.period.label} New Resellers`} value={stats.registrationCount} color="#9A6F1E" icon="👥" sub="Completed registrations" badge={stats.registrationCount > 0 ? 'New!' : undefined} />
          </div>

          {/* Running totals */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Resellers"    value={stats.totalResellers.toLocaleString()} color="#0D1B3E" icon="👤" sub={`+${stats.newResellersThisMonth} this month`} />
            <StatCard label="Available PINs"     value={stats.unusedPins}                       color="#1a7a4a" icon="🔓" sub={`${stats.usedPins} used · ${stats.totalPinsRequested} total`} />
            <StatCard label="Pending Orders"     value={stats.pendingOrders}                    color={stats.pendingOrders > 0 ? '#B45309' : '#0D1B3E'} icon="🕐" sub={`${stats.totalOrders} total orders`} badge={stats.pendingOrders > 0 ? 'Action needed' : undefined} />
            <StatCard label="Low Stock Items"    value={stats.lowStockItems}                    color={stats.lowStockItems > 0 ? '#e05252' : '#1a7a4a'} icon="⚠️" sub={`${stats.totalStock} units in stock`} badge={stats.lowStockItems > 0 ? 'Restock!' : undefined} />
          </div>

          <section className="rounded-2xl border border-[#1a7a4a]/30 bg-white overflow-hidden">
            <div className="px-5 py-4 bg-[#e2f5e9] border-b border-[#1a7a4a]/15">
              <p className="text-xs font-bold uppercase tracking-wide text-[#187443]">{stats.period.label} {accountLabel} Financial Summary</p>
              <p className="text-xs leading-relaxed text-[#53627e] mt-1">Sales across reseller repeat orders, non-member/SRP sales, and new reseller registrations. Prepaid PIN allocation is excluded from distributor sales.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 bg-[#f8faf9]">
              <button type="button" onClick={() => setShowSalesBreakdown(true)} className="rounded-xl border border-[#2563eb]/20 bg-white p-5 text-left hover:bg-[#eff6ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] transition-colors group" aria-label={`View ${stats.period.label.toLowerCase()} total sales breakdown`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Total sales</p>
                  <span className="text-xs font-semibold text-[#2563eb] group-hover:underline">View breakdown →</span>
                </div>
                <p className="text-2xl font-bold text-[#2563eb] mt-2">{fmt(stats.totalRevenue)}</p>
                <p className="text-xs leading-relaxed text-gray-500 mt-1">Before product cost deductions</p>
              </button>

              <button type="button" onClick={() => setShowCostBreakdown(true)} className="rounded-xl border border-[#e05252]/20 bg-white p-5 text-left hover:bg-[#fff3f3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e05252] transition-colors group" aria-label={`View ${stats.period.label.toLowerCase()} total product cost breakdown`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Total product cost</p>
                  <span className="text-xs font-semibold text-[#e05252] group-hover:underline">View breakdown →</span>
                </div>
                <p className="text-2xl font-bold text-[#e05252] mt-2">{fmt(stats.totalCost)}</p>
                <p className="text-xs leading-relaxed text-gray-500 mt-1">Historical acquisition cost</p>
              </button>

              <div className="rounded-xl border border-[#1a7a4a]/25 bg-[#e2f5e9] p-5">
                <p className="text-xs uppercase tracking-wide font-semibold text-[#187443]">{accountLabel} gross profit</p>
                <p className="text-3xl font-bold text-[#08703c] mt-1">{fmt(stats.totalProfit)}</p>
                <p className="text-xs leading-relaxed text-[#187443] mt-1">Sales − product cost; before operating expenses or refunds</p>
              </div>
            </div>

            <div className="px-4 pb-4 bg-white">
              <p className="text-xs font-bold uppercase tracking-wide text-[#0D1B3E] mb-2">Gross Profit Breakdown</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 rounded-xl border border-[#0D1B3E]/8 overflow-hidden divide-y sm:divide-y-0 sm:divide-x divide-[#0D1B3E]/8 bg-[#fbfcfd]">
                <div className="p-4"><p className="text-xs uppercase tracking-wide text-gray-500">Reseller repeat-order profit</p><p className="text-lg font-bold text-[#2563eb] mt-1">{fmt(stats.resellerProductOrders.profit)}</p></div>
                <div className="p-4"><p className="text-xs uppercase tracking-wide text-gray-500">Non-member / SRP profit</p><p className="text-lg font-bold text-[#9a6f1e] mt-1">{fmt(stats.walkInProductOrders.profit)}</p></div>
                <div className="p-4"><p className="text-xs uppercase tracking-wide text-gray-500">New reseller registration profit</p><p className="text-lg font-bold text-[#8b5cf6] mt-1">{fmt(stats.registrationProductProfit)}</p></div>
              </div>
            </div>
          </section>

          {showSalesBreakdown && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#010521]/55 p-3 sm:p-4" onMouseDown={() => setShowSalesBreakdown(false)}>
              <div role="dialog" aria-modal="true" aria-labelledby="sales-breakdown-title" className="w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] rounded-xl sm:rounded-2xl bg-white shadow-2xl overflow-y-auto" onMouseDown={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between gap-4 border-b border-[#0D1B3E]/8 px-5 py-4">
                  <div>
                    <h2 id="sales-breakdown-title" className="text-base font-bold text-[#0D1B3E]">Where {fmt(stats.totalRevenue)} total sales came from</h2>
                    <p className="text-xs text-gray-400 mt-1">{stats.period.label} · {accountLabel}</p>
                  </div>
                  <button type="button" onClick={() => setShowSalesBreakdown(false)} className="h-10 w-10 shrink-0 rounded-lg text-lg text-gray-400 hover:bg-gray-100 hover:text-[#0D1B3E]" aria-label="Close total sales breakdown">✕</button>
                </div>
                <div className="p-4 sm:p-5 space-y-3">
                  {[
                    { label: 'Reseller repeat-order sales', value: stats.resellerProductOrders.revenue, detail: `${stats.resellerProductOrders.units.toLocaleString()} units sold to existing resellers` },
                    { label: 'Non-member / SRP sales', value: stats.walkInProductOrders.revenue, detail: `${stats.walkInProductOrders.units.toLocaleString()} units sold at non-member/SRP pricing` },
                    { label: 'New reseller registration product sales', value: stats.packageRevenue, detail: `${stats.registrationCount.toLocaleString()} new registrations · prepaid PIN allocation excluded` },
                  ].map((channel) => (
                    <div key={channel.label} className="rounded-xl border border-[#0D1B3E]/8 px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-semibold text-[#0D1B3E]">{channel.label}</p>
                        <p className="text-sm font-bold text-[#2563eb]">{fmt(channel.value)}</p>
                      </div>
                      <p className="text-xs leading-relaxed text-gray-500 mt-1">{channel.detail}</p>
                    </div>
                  ))}
                  <div className="rounded-xl bg-[#eff6ff] px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-[#2563eb] font-semibold">Formula</p>
                    <p className="text-sm leading-relaxed text-[#0D1B3E] mt-1">
                      {fmt(stats.resellerProductOrders.revenue)} + {fmt(stats.walkInProductOrders.revenue)} + {fmt(stats.packageRevenue)} = <span className="font-bold text-[#2563eb]">{fmt(stats.totalRevenue)}</span>
                    </p>
                  </div>
                  <p className="text-xs leading-relaxed text-gray-500">Total sales is before product-cost deductions. The prepaid PIN allocation collected during registration is excluded because it is not distributor sales income.</p>
                </div>
              </div>
            </div>
          )}

          {showCostBreakdown && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#010521]/55 p-3 sm:p-4" onMouseDown={() => setShowCostBreakdown(false)}>
              <div role="dialog" aria-modal="true" aria-labelledby="cost-breakdown-title" className="w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] rounded-xl sm:rounded-2xl bg-white shadow-2xl overflow-y-auto" onMouseDown={(event) => event.stopPropagation()}>
                <div className="flex items-start justify-between gap-4 border-b border-[#0D1B3E]/8 px-5 py-4">
                  <div>
                    <h2 id="cost-breakdown-title" className="text-base font-bold text-[#0D1B3E]">Where {fmt(stats.totalCost)} total product cost came from</h2>
                    <p className="text-xs text-gray-400 mt-1">{stats.period.label} · {accountLabel}</p>
                  </div>
                  <button type="button" onClick={() => setShowCostBreakdown(false)} className="h-10 w-10 shrink-0 rounded-lg text-lg text-gray-400 hover:bg-gray-100 hover:text-[#0D1B3E]" aria-label="Close total product cost breakdown">✕</button>
                </div>
                <div className="p-4 sm:p-5 space-y-3">
                  {[
                    { label: 'Reseller repeat-order product cost', value: stats.resellerProductOrders.cost, detail: `${stats.resellerProductOrders.units.toLocaleString()} units valued at their historical acquisition cost` },
                    { label: 'Non-member / SRP product cost', value: stats.walkInProductOrders.cost, detail: `${stats.walkInProductOrders.units.toLocaleString()} units valued at their historical acquisition cost` },
                    { label: 'New reseller registration product cost', value: stats.packageCost, detail: `${stats.registrationCount.toLocaleString()} registrations using the cost captured when each registration was completed` },
                  ].map((channel) => (
                    <div key={channel.label} className="rounded-xl border border-[#0D1B3E]/8 px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-semibold text-[#0D1B3E]">{channel.label}</p>
                        <p className="text-sm font-bold text-[#e05252]">{fmt(channel.value)}</p>
                      </div>
                      <p className="text-xs leading-relaxed text-gray-500 mt-1">{channel.detail}</p>
                    </div>
                  ))}
                  <div className="rounded-xl bg-[#fff3f3] px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-[#e05252] font-semibold">Formula</p>
                    <p className="text-sm leading-relaxed text-[#0D1B3E] mt-1">
                      {fmt(stats.resellerProductOrders.cost)} + {fmt(stats.walkInProductOrders.cost)} + {fmt(stats.packageCost)} = <span className="font-bold text-[#e05252]">{fmt(stats.totalCost)}</span>
                    </p>
                  </div>
                  <p className="text-xs leading-relaxed text-gray-500">Product cost uses the historical acquisition cost stored with each transaction. Later Admin price changes do not rewrite completed transaction costs.</p>
                </div>
              </div>
            </div>
          )}

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
                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#010521] text-white text-[8px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        {fmt(m.revenue)}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="border-t border-[#0D1B3E]/5 mt-3 pt-3 flex justify-between text-xs">
                <span className="text-gray-400">Total Revenue</span>
                <span className="font-bold text-[#0D1B3E]">{fmt(stats.totalRevenue)}</span>
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
                  <div className="w-8 h-8 rounded-full bg-[#010521] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {r.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0D1B3E] truncate">{r.full_name}</p>
                    <p className="text-[10px] text-gray-400">@{r.username} · {r.reseller_profile?.package?.name || '—'}</p>
                  </div>
                  <p className="text-[10px] text-gray-400 flex-shrink-0">
                    {new Date(r.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
              ))}
            </div>

            {/* Top Performing Resellers */}
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#0D1B3E]/8">
                <p className="text-sm font-bold text-[#0D1B3E]">Top Performing Resellers</p>
                <Link href="/dashboard/city/top-performers" className="text-[11px] text-[#C9A84C] hover:underline">View All →</Link>
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
                  <div className="w-8 h-8 rounded-full bg-[#010521] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {r.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0D1B3E] truncate">{r.full_name}</p>
                    <p className="text-[10px] text-gray-400">@{r.username} · {r.package_name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold text-[#1a7a4a]">{fmt(r.total_earned)}</p>
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
                    <p className="text-sm font-semibold text-[#0D1B3E] truncate">{o.buyer.full_name}</p>
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

        </>
      )}

      {/* ══ SALES REPORT ══ */}
      {tab === 'sales' && (
        <>
          <div className="bg-[#fffaf0] border border-[#e8c66a]/60 rounded-2xl px-5 py-5">
            <p className="text-base font-extrabold text-[#0D1B3E]">{accountLabel} income summary</p>
            <p className="text-sm font-semibold leading-6 text-[#72551b] mt-1.5">{stats.period.label}: only three income channels are counted: reseller repeat orders, non-member/SRP sales, and new reseller registrations.</p>
            <p className="text-sm font-medium leading-6 text-[#72551b] mt-1">Prices and costs are recorded as historical transaction snapshots. Changes in Admin price settings apply only to future orders and registrations.</p>
          </div>

          <section>
            <p className="text-base font-bold text-[#0D1B3E] mb-1">Where the {accountLabel} earns</p>
            <p className="text-sm font-semibold text-[#53627e] mb-4">Every card shows the sales amount, product cost, and the profit generated by that channel.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { title: '1. Reseller Repeat Orders', revenue: stats.resellerProductOrders.revenue, cost: stats.resellerProductOrders.cost, profit: stats.resellerProductOrders.profit, units: stats.resellerProductOrders.units, color: '#ffffff', background: '#14264f', border: '#14264f', description: 'Products sold to existing reseller accounts at reseller price.' },
                { title: '2. Non-member / SRP Sales', revenue: stats.walkInProductOrders.revenue, cost: stats.walkInProductOrders.cost, profit: stats.walkInProductOrders.profit, units: stats.walkInProductOrders.units, color: '#ffffff', background: '#14264f', border: '#14264f', description: 'Walk-in or non-member products sold at SRP price.' },
                { title: '3. New Reseller Registrations', revenue: stats.packageRevenue, cost: stats.packageCost, profit: stats.registrationProductProfit, units: stats.packageUnitsSold, color: '#ffffff', background: '#14264f', border: '#14264f', description: `${accountLabel} product value inside new reseller packages. PIN allocation is excluded from ${accountLabel} income.` },
              ].map(channel => (
                <div key={channel.title} className="rounded-2xl border p-5 shadow-md" style={{ backgroundColor: channel.background, borderColor: channel.border, textShadow: '0 1px 2px rgba(0, 0, 0, 0.38)' }}>
                  <p className="text-base font-extrabold leading-6 text-white drop-shadow-sm">{channel.title}</p>
                  <p className="text-sm leading-5 font-semibold text-white/90 min-h-10 mt-1.5">{channel.description}</p>
                  <div className="mt-4 space-y-2.5 text-sm">
                    <div className="flex justify-between gap-4"><span className="font-bold text-white/85">Sales value</span><span className="font-extrabold text-white drop-shadow-sm">{fmt(channel.revenue)}</span></div>
                    <div className="flex justify-between gap-4"><span className="font-bold text-white/85">Product cost</span><span className="font-extrabold text-white drop-shadow-sm">{fmt(channel.cost)}</span></div>
                    <div className="pt-2.5 border-t border-white/25 flex justify-between gap-4"><span className="font-extrabold text-white">Profit</span><span className="font-extrabold text-white drop-shadow-sm">{fmt(channel.profit)}</span></div>
                    <div className="flex justify-between gap-4"><span className="font-bold text-white/85">Units released</span><span className="font-extrabold text-white">{channel.units.toLocaleString()}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-[#0D1B3E]/10 bg-white p-4 shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                { label: 'Reseller Repeat-Order Profit', value: stats.resellerProductOrders.profit, background: '#1e4fa8' },
                { label: 'Non-Member / SRP Profit', value: stats.walkInProductOrders.profit, background: '#795515' },
                { label: 'Registration Profit', value: stats.registrationProductProfit, background: '#a9363b' },
                { label: 'Total City Gross Profit', value: stats.combinedProductProfit, background: '#14653d', subtext: 'Before operating expenses or refunds' },
              ].map(item => (
                <div
                  key={item.label}
                  className="flex min-h-32 flex-col justify-between rounded-xl p-4 shadow-md"
                  style={{ backgroundColor: item.background, textShadow: '0 1px 2px rgba(0, 0, 0, 0.38)' }}
                >
                  <p className="min-h-10 text-sm font-extrabold uppercase leading-5 tracking-wide text-white">{item.label}</p>
                  <div>
                    <p className="text-2xl font-extrabold text-white drop-shadow-sm">{fmt(item.value)}</p>
                    {item.subtext && <p className="mt-1 text-xs font-semibold leading-4 text-white/90">{item.subtext}</p>}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl bg-[#f5f7fb] px-4 py-3 text-sm font-medium leading-5 text-[#53627e]">
              <span className="font-extrabold text-[#0D1B3E]">Formula:</span> reseller repeat-order profit + non-member/SRP profit + registration profit = Total City Gross Profit.
            </div>
          </section>

          <details className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden group">
            <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between text-base font-extrabold text-[#0D1B3E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]">Registration cash and PIN reference <span className="text-[#9a6f1e] group-open:rotate-180 transition-transform">v</span></summary>
            <div className="border-t border-[#0D1B3E]/8 px-5 py-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 text-sm">
              <div><p className="font-bold text-[#667085]">Package cash collected</p><p className="text-base font-extrabold text-[#2563eb] mt-1.5">{fmt(stats.packageCustomerPayments)}</p></div>
              <div><p className="font-bold text-[#667085]">City product value</p><p className="text-base font-extrabold text-[#9a6f1e] mt-1.5">{fmt(stats.packageRevenue)}</p></div>
              <div><p className="font-bold text-[#667085]">Prepaid PIN allocation</p><p className="text-base font-extrabold text-[#9a6f1e] mt-1.5">{fmt(stats.packagePinRemittance)}</p></div>
              <div><p className="font-bold text-[#667085]">Formula</p><p className="font-bold leading-5 text-[#0D1B3E] mt-1.5">Cash collected = City product value + PIN allocation</p></div>
            </div>
          </details>

          <details className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden group">
            <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between text-base font-extrabold text-[#0D1B3E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563eb]">Monthly delivered product-sales reference <span className="text-[#9a6f1e] group-open:rotate-180 transition-transform">v</span></summary>
            <div className="border-t border-[#0D1B3E]/8">
              <div className="grid grid-cols-3 gap-4 px-5 py-3 bg-[#f8f9fc]">{['Month', 'Delivered Product Revenue', 'New Reseller Registrations'].map(h => <p key={h} className="text-sm text-[#667085] uppercase tracking-wide font-bold">{h}</p>)}</div>
              {stats.monthlyRevenue.map((m, i) => <div key={i} className="grid grid-cols-3 gap-4 px-5 py-4 border-b border-[#0D1B3E]/5"><p className="text-sm font-semibold text-[#0D1B3E]">{m.month}</p><p className="text-sm font-extrabold text-[#1a7a4a]">{fmt(m.revenue)}</p><p className="text-sm font-bold text-[#9a6f1e]">{m.resellers}</p></div>)}
            </div>
          </details>
        </>
      )}
      {/* ══ PRODUCT MOVEMENT ══ */}
      {tab === 'products' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard label="Delivered Product Revenue"  value={fmt(stats.orderRevenue)}              color="#2563eb" icon="🛒" sub={`${stats.orderUnitsSold} units`} />
            <StatCard label="Delivered Product Cost"     value={fmt(stats.orderCost)}                 color="#e05252" icon="🏷️" sub={stats.financialIntegrity.order_cost_fallback_rows > 0 ? `Includes ${stats.financialIntegrity.order_cost_fallback_rows} legacy catalog-cost fallback${stats.financialIntegrity.order_cost_fallback_rows === 1 ? "" : "s"}` : "Historical acquisition cost"} />
            <StatCard label="Delivered Product Gross Profit" value={fmt(stats.orderProfit)} color="#1a7a4a" icon="📈" sub="Revenue minus product cost; before operating expenses or refunds" />
          </div>
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-base font-extrabold text-[#0D1B3E]">Product Movement and Profit Breakdown</p>
              <p className="text-sm font-medium text-[#667085] mt-1">Every row explains how delivered product revenue and gross profit were calculated. Reseller registrations are excluded.</p>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[980px]">
                <div className="grid grid-cols-[1.5fr_.65fr_.9fr_.9fr_.9fr_.9fr_1fr] gap-4 px-5 py-3 bg-[#f8f9fc]">
                  {['Product', 'Units', 'Avg. Selling Price', 'Revenue', 'Product Cost', 'Gross Profit', 'Unit Sales Share'].map(h => <p key={h} className="text-xs text-[#667085] uppercase tracking-wide font-extrabold">{h}</p>)}
                </div>
                {stats.topProducts.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-10">No product sales yet</p>
                ) : stats.topProducts.map((p, i) => {
                  const totalQty = stats.orderUnitsSold || 1
                  const pct = Math.round((p.qty / totalQty) * 1000) / 10
                  const averageSellingPrice = p.qty > 0 ? p.revenue / p.qty : 0
                  const hasProductCost = Number.isFinite(Number(p.cost))
                  const productCost = hasProductCost ? Number(p.cost) : stats.topProducts.length === 1 ? stats.orderCost : null
                  const grossProfit = productCost == null ? null : p.revenue - productCost
                  return (
                    <div key={p.product_id} className="grid grid-cols-[1.5fr_.65fr_.9fr_.9fr_.9fr_.9fr_1fr] gap-4 px-5 py-4 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: i === 0 ? '#C9A84C' : i === 1 ? '#9ca3af' : '#f1f5f9', color: i < 2 ? 'white' : '#9ca3af' }}>{i+1}</span>
                        <p className="truncate text-sm font-bold text-[#0D1B3E]">{p.name}</p>
                      </div>
                      <p className="text-sm font-bold text-[#0D1B3E]">{p.qty.toLocaleString()}</p>
                      <p className="text-sm font-bold text-[#0D1B3E]">{fmt(averageSellingPrice)}</p>
                      <p className="text-sm font-extrabold text-[#2563eb]">{fmt(p.revenue)}</p>
                      <p className="text-sm font-extrabold text-[#d94343]">{productCost == null ? 'Refresh required' : fmt(productCost)}</p>
                      <p className="text-sm font-extrabold text-[#1a7a4a]">{grossProfit == null ? 'Refresh required' : fmt(grossProfit)}</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-[#e8edf5] rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-[#C9A84C]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-10 text-xs font-bold text-[#667085]">{pct}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            {stats.topProducts.length > 0 && (
              <div className="border-t border-[#0D1B3E]/8 bg-[#f8fafc] px-5 py-3 text-sm font-semibold text-[#53627e]">
                Formula: <span className="text-[#0D1B3E]">units × average selling price = revenue</span>; <span className="text-[#1a7a4a]">revenue − historical product cost = gross profit</span>.
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ REGISTRATION PACKAGES ══ */}
      {tab === 'packages' && (
        <>
          {stats.financialIntegrity.package_unit_fallback_rows > 0 && (
            <div className="rounded-xl border border-[#e8c66a]/70 bg-[#fffaf0] px-4 py-3 text-sm leading-5 text-[#72551b]">
              <p className="font-extrabold">Historical package-unit note</p>
              <p className="mt-1">{stats.financialIntegrity.package_unit_fallback_rows} registration{stats.financialIntegrity.package_unit_fallback_rows === 1 ? '' : 's'} predate the unit-snapshot field, so unit totals use the current package composition. Their customer cash, product sales, PIN allocation, historical product cost, and gross profit remain stored transaction snapshots and are not affected.</p>
            </div>
          )}          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatCard label={`${stats.period.label} Completed Registrations`} value={stats.registrationCount.toLocaleString()} color="#0D1B3E" icon="✅" sub="One used PIN per completed reseller registration" />
            <StatCard label="Registration Product Sales" value={fmt(stats.packageRevenue)} color="#2563eb" icon="🎁" sub={`${accountLabel} product value; prepaid PIN allocation excluded`} />
            <StatCard label="Registration Product Cost" value={fmt(stats.packageCost)} color="#e05252" icon="🏷️" sub="Historical product acquisition cost" />
            <StatCard label="Registration Gross Profit" value={fmt(stats.registrationProductProfit)} color="#1a7a4a" icon="📈" sub="Product sales minus product cost" />
          </div>
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-base font-extrabold text-[#0D1B3E]">Registration Package Financial Breakdown</p>
              <p className="text-sm font-medium text-[#667085] mt-1">Every row explains customer cash, product sales, PIN allocation, historical product cost, and gross profit for completed registrations.</p>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[1320px]">
                <div className="grid grid-cols-[1.25fr_.7fr_.6fr_.9fr_.9fr_.85fr_.9fr_.9fr_1fr] gap-4 px-5 py-3 bg-[#f8f9fc]">
                  {['Package', 'Registrations', 'Units', 'Customer Cash', 'Product Sales', 'PIN Allocation', 'Product Cost', 'Gross Profit', 'Registration Share'].map(h => <p key={h} className="text-xs text-[#667085] uppercase tracking-wide font-extrabold">{h}</p>)}
                </div>
                {stats.packageBreakdown.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-10">No completed registrations in this period</p>
                ) : stats.packageBreakdown.map((pkg, i) => {
                  const totalRegistrations = stats.registrationCount || 1
                  const pct = Math.round((pkg.count / totalRegistrations) * 1000) / 10
                  return (
                    <div key={pkg.package_id} className="grid grid-cols-[1.25fr_.7fr_.6fr_.9fr_.9fr_.85fr_.9fr_.9fr_1fr] gap-4 px-5 py-4 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: i === 0 ? '#C9A84C' : i === 1 ? '#9ca3af' : '#f1f5f9', color: i < 2 ? 'white' : '#9ca3af' }}>{i + 1}</span>
                        <p className="truncate text-sm font-bold text-[#0D1B3E]">{pkg.name}</p>
                      </div>
                      <p className="text-sm font-bold text-[#0D1B3E]">{pkg.count.toLocaleString()}</p>
                      <p className="text-sm font-bold text-[#0D1B3E]">{pkg.units.toLocaleString()}</p>
                      <p className="text-sm font-extrabold text-[#0D1B3E]">{fmt(pkg.customer_payment)}</p>
                      <p className="text-sm font-extrabold text-[#2563eb]">{fmt(pkg.revenue)}</p>
                      <p className="text-sm font-extrabold text-[#9a6f1e]">{fmt(pkg.pin_allocation)}</p>
                      <p className="text-sm font-extrabold text-[#d94343]">{fmt(pkg.cost)}</p>
                      <p className="text-sm font-extrabold text-[#1a7a4a]">{fmt(pkg.profit)}</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-[#e8edf5] rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-[#C9A84C]" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-10 text-xs font-bold text-[#667085]">{pct}%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            {stats.packageBreakdown.length > 0 && (
              <div className="border-t border-[#0D1B3E]/8 bg-[#f8fafc] px-5 py-3 text-sm font-semibold leading-6 text-[#53627e]">
                <span className="text-[#0D1B3E]">Customer cash = registration product sales + prepaid PIN allocation.</span>{' '}
                <span className="text-[#1a7a4a]">Registration gross profit = product sales − historical product cost.</span>
              </div>
            )}
          </div>
        </>
      )}
      {/* ══ PIN REPORT ══ */}
      {tab === 'pins' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total PINs Assigned" value={stats.totalPinsRequested} color="#0D1B3E" icon="📋" sub="All-time PINs issued by Admin" />
            <StatCard label="Available PINs" value={stats.unusedPins} color="#2563eb" icon="🔓" sub="Live stock · ready to use" />
            <StatCard label={`${stats.period.label} PINs Used`} value={stats.pinsUsedInPeriod} color="#1a7a4a" icon="✅" sub="Follows the selected reporting period" />
            <StatCard label="Cancelled PINs" value={stats.cancelledPins} color="#64748b" icon="🚫" sub="All time · permanently unusable" />
          </div>

          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
            <div className="mb-4">
              <p className="text-sm font-bold text-[#0D1B3E]">All-time PIN Inventory Reconciliation</p>
              <p className="mt-1 text-xs font-medium text-[#667085]">Used + available + cancelled + expired must equal total PINs assigned.</p>
            </div>
            <div className="space-y-4">
              {[
                { label: 'Used',      value: stats.usedPins,   total: stats.totalPinsRequested, color: '#1a7a4a' },
                { label: 'Available', value: stats.unusedPins, total: stats.totalPinsRequested, color: '#2563eb' },
                { label: 'Cancelled', value: stats.cancelledPins, total: stats.totalPinsRequested, color: '#64748b' },
                { label: 'Expired', value: stats.expiredPins, total: stats.totalPinsRequested, color: '#e05252' },
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
                { label: 'Activation Rate (Used ÷ Usable Pool)', value: (stats.usedPins + stats.unusedPins) > 0 ? `${Math.round((stats.usedPins / (stats.usedPins + stats.unusedPins)) * 100)}%` : '0%', color: '#1a7a4a' },
                { label: 'All-time PINs Used', value: stats.usedPins.toLocaleString(), color: '#0D1B3E' },
                { label: 'Reconciled Total', value: (stats.usedPins + stats.unusedPins + stats.cancelledPins + stats.expiredPins).toLocaleString(), color: '#C9A84C' },
              ].map(s => (
                <div key={s.label}>
                  <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            {(stats.usedPins + stats.unusedPins + stats.cancelledPins + stats.expiredPins) !== stats.totalPinsRequested && (
              <div className="mt-4 rounded-xl border border-[#e05252]/25 bg-[#fff3f3] px-4 py-3 text-sm font-semibold text-[#a03030]">
                PIN count mismatch detected. Assigned: {stats.totalPinsRequested.toLocaleString()}, reconciled statuses: {(stats.usedPins + stats.unusedPins + stats.cancelledPins + stats.expiredPins).toLocaleString()}.
              </div>
            )}
          </div>
        </>
      )}

      {/* ══ INVENTORY ══ */}
      {tab === 'inventory' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Product Types" value={stats.totalInventoryItems} color="#0D1B3E" icon="📦" sub="Distinct products in inventory" />
            <StatCard label="Units On Hand" value={stats.totalStock.toLocaleString()} color="#2563eb" icon="🏭" sub="Current physical stock" />
            <StatCard label="Low-stock Products" value={stats.lowStockItems} color="#e05252" icon="⚠️" sub="At or below threshold" badge={stats.lowStockItems > 0 ? 'Restock!' : undefined} />
            <StatCard label="Inventory Cost Value" value={fmt(stats.totalInventoryCost)} color="#1a7a4a" icon="💰" sub={`${accountLabel} acquisition cost × on-hand units`} />
          </div>
          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
              <p className="text-sm font-bold text-[#0D1B3E]">Inventory Status</p>
            </div>
            <div className="grid grid-cols-4 px-5 py-2 bg-[#f8f9fc]">
              {['Product', 'Stock', 'Threshold', 'Status'].map(h => <p key={h} className="text-sm text-[#667085] uppercase tracking-wide font-bold">{h}</p>)}
            </div>
            {stats.inventoryItems.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">No inventory yet</p>
            ) : stats.inventoryItems.map((item, i) => {
              const isLow = item.quantity <= item.low
              const difference = item.quantity - item.low
              return (
                <div key={`${item.name}-${i}`} className="grid grid-cols-4 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] items-center">
                  <p className="text-sm font-semibold text-[#0D1B3E] truncate">{item.name}</p>
                  <p className="text-xs font-bold" style={{ color: isLow ? '#e05252' : '#1a7a4a' }}>{item.quantity.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">{item.low.toLocaleString()}</p>
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-xs font-semibold ${isLow ? 'text-[#a03030]' : 'text-[#1a7a4a]'}`}>
                      {difference > 0 ? `${difference.toLocaleString()} units above threshold` : difference === 0 ? 'At threshold' : `${Math.abs(difference).toLocaleString()} units below threshold`}
                    </span>
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
