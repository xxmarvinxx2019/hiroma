'use client'

import { useState, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

interface DailySale {
  date:    string
  orders:  number
  revenue: number
  units:   number
}

interface TopProduct {
  product_id: string
  name:       string
  type:       string
  units_sold: number
  revenue:    number
}

interface ReportData {
  period: { days: number; since: string }
  network: {
    totalResellers: number; activeResellers: number; suspendedResellers: number
    totalDistributors: number; regionalCount: number; provincialCount: number; cityCount: number
  }
  financial: {
    totalWalletBalance: number; totalEarned: number; totalWithdrawn: number
    totalPendingPayouts: number; totalPendingAmount: number; totalCommissionsPaid: number
  }
  sales: {
    adminRevenue: number; adminCost: number; adminProfit: number
    adminOrders: number; adminUnitsSold: number
    periodRevenue: number; periodOrders: number
    chainRevenue: number; chainOrders: number
    regionalRevenue: number; regionalOrders: number
    provincialRevenue: number; provincialOrders: number
    cityRevenue: number; cityOrders: number
  }
  mlm: {
    totalCommissions: number; directReferralCount: number; binaryPairingCount: number
    multilevelCount: number; sponsorPointCount: number
    totalPointsEarned: number; totalOverflowCount: number
  }
  catalog: {
    totalProducts: number; physicalProducts: number; digitalProducts: number
    totalPackages: number; totalPinsGenerated: number; unusedPins: number; usedPins: number
  }
  charts: { dailySales: DailySale[]; topProducts: TopProduct[] }
}

// ============================================================
// HELPERS
// ============================================================

const fmt  = (n: number) => `₱${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtN = (n: number) => n.toLocaleString()

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-[#0D1B3E]">{title}</h2>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function StatCard({ label, value, accent, sub }: { label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${accent}` }}>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-semibold" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// Simple bar chart using SVG
function DailyChart({ data, days }: { data: DailySale[]; days: number }) {
  if (!data.length) return <p className="text-center text-gray-400 text-sm py-8">No data yet.</p>

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1)
  const barWidth   = Math.max(4, Math.floor(560 / data.length) - 2)

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 600 160`} className="w-full" style={{ minWidth: '400px' }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
          <line key={pct}
            x1="30" y1={130 - pct * 110}
            x2="590" y2={130 - pct * 110}
            stroke="#e5e7eb" strokeWidth="0.5" />
        ))}
        {/* Y axis labels */}
        {[0, 0.5, 1].map((pct) => (
          <text key={pct}
            x="28" y={134 - pct * 110}
            textAnchor="end" fontSize="7" fill="#9ca3af">
            {pct === 0 ? '0' : pct === 0.5 ? fmt(maxRevenue * 0.5).replace('₱', '') : fmt(maxRevenue).replace('₱', '')}
          </text>
        ))}
        {/* Bars */}
        {data.map((d, i) => {
          const x      = 32 + i * (barWidth + 2)
          const height = Math.max(1, (d.revenue / maxRevenue) * 110)
          const y      = 130 - height
          return (
            <g key={d.date}>
              <rect x={x} y={y} width={barWidth} height={height}
                fill={d.revenue > 0 ? '#C9A84C' : '#e5e7eb'} rx="1" opacity="0.85" />
              {/* X label — only show every N days */}
              {(i === 0 || i === Math.floor(data.length / 2) || i === data.length - 1) && (
                <text x={x + barWidth / 2} y="148" textAnchor="middle" fontSize="7" fill="#9ca3af">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-1">
        <span>{data.reduce((s, d) => s + d.orders, 0)} total orders</span>
        <span>{fmt(data.reduce((s, d) => s + d.revenue, 0))} total revenue</span>
      </div>
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function AdminReportsPage() {
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays]       = useState(30)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/reports?days=${days}`)
      .then((r) => r.json())
      .then((d) => setReport(d.report || null))
      .finally(() => setLoading(false))
  }, [days])

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto py-20 text-center">
        <div className="w-8 h-8 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-gray-400 text-sm">Loading report...</p>
      </div>
    )
  }

  if (!report) return <p className="text-center text-gray-400 py-20">Failed to load report.</p>

  const { network, financial, sales, mlm, catalog, charts } = report

  return (
    <div className="max-w-7xl mx-auto space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Reports & Analytics</h1>
          <p className="text-sm text-gray-400 mt-0.5">Full business overview — sales, profit, commissions, network</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Period:</span>
          {[7, 14, 30, 60, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${days === d ? 'bg-[#0D1B3E] text-white' : 'bg-white border border-[#0D1B3E]/15 text-gray-400 hover:text-[#0D1B3E]'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* ── SALES & PROFIT ── */}
      <section>
        <SectionTitle title="💰 Sales & Profit" subtitle={`All-time totals + last ${days} days period`} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <StatCard label="Total Revenue (All Time)"  value={fmt(sales.adminRevenue)}  accent="#1a7a4a" sub="From stock assignments to distributors" />
          <StatCard label="Total Cost (All Time)"     value={fmt(sales.adminCost)}     accent="#e05252" sub="Cost of goods sold at production cost" />
          <StatCard label="Total Profit (All Time)"   value={fmt(sales.adminProfit)}   accent="#2563eb" sub="Revenue minus cost" />
          <StatCard label="Units Sold (All Time)"     value={fmtN(sales.adminUnitsSold)} accent="#0D1B3E" sub="Total units assigned to distributors" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label={`Revenue (Last ${days}d)`}  value={fmt(sales.periodRevenue)}  accent="#1a7a4a" sub={`${fmtN(sales.periodOrders)} orders`} />
          <StatCard label="Chain Revenue (All Levels)" value={fmt(sales.chainRevenue)}   accent="#2563eb" sub={`${fmtN(sales.chainOrders)} total delivered orders`} />
          <StatCard label="Total Assignments"          value={fmtN(sales.adminOrders)}   accent="#0D1B3E" sub="Stock assignments made" />
        </div>
      </section>

      {/* ── DAILY SALES CHART ── */}
      <section>
        <SectionTitle title="📈 Daily Revenue" subtitle={`Last ${days} days — delivered orders`} />
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-5">
          <DailyChart data={charts.dailySales} days={days} />
        </div>
      </section>

      {/* ── REVENUE PER LEVEL ── */}
      <section>
        <SectionTitle title="🏪 Revenue by Distributor Level" subtitle={`Last ${days} days`} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: 'Regional Distributors', revenue: sales.regionalRevenue,   orders: sales.regionalOrders,   accent: '#2563eb', priceLabel: 'at regional price' },
            { label: 'Provincial Distributors', revenue: sales.provincialRevenue, orders: sales.provincialOrders, accent: '#9a6f1e', priceLabel: 'at provincial price' },
            { label: 'City Distributors',      revenue: sales.cityRevenue,       orders: sales.cityOrders,       accent: '#1a7a4a', priceLabel: 'at city price' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
              style={{ borderTop: `2px solid ${s.accent}` }}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
              <p className="text-xl font-semibold" style={{ color: s.accent }}>{fmt(s.revenue)}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">{fmtN(s.orders)} orders · {s.priceLabel}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── TOP PRODUCTS ── */}
      <section>
        <SectionTitle title="🏆 Top Products Sold" subtitle={`Last ${days} days — by units sold`} />
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="grid grid-cols-4 px-4 py-2 bg-[#F0F2F8]">
            {['Product', 'Units Sold', 'Revenue', 'Type'].map((h) => (
              <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
            ))}
          </div>
          {charts.topProducts.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">No sales data for this period.</p>
          ) : (
            charts.topProducts.map((p, i) => (
              <div key={p.product_id}
                className="grid grid-cols-4 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 items-center">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: i === 0 ? '#C9A84C' : i === 1 ? '#e5e7eb' : '#f3f4f6', color: i < 2 ? '#0D1B3E' : '#9ca3af' }}>
                    {i + 1}
                  </span>
                  <p className="text-xs font-medium text-[#0D1B3E] truncate">{p.name}</p>
                </div>
                <p className="text-xs font-semibold text-[#0D1B3E]">{fmtN(p.units_sold)}</p>
                <p className="text-xs font-semibold text-[#1a7a4a]">{fmt(p.revenue)}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded w-fit ${p.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'}`}>
                  {p.type}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── NETWORK ── */}
      <section>
        <SectionTitle title="🌐 Network Overview" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Resellers"    value={fmtN(network.totalResellers)}    accent="#0D1B3E" sub={`${fmtN(network.activeResellers)} active`} />
          <StatCard label="Suspended"          value={fmtN(network.suspendedResellers)} accent="#e05252" />
          <StatCard label="Total Distributors" value={fmtN(network.totalDistributors)} accent="#2563eb" />
          <StatCard label="Regional / Provincial / City"
            value={`${network.regionalCount} / ${network.provincialCount} / ${network.cityCount}`}
            accent="#9a6f1e" />
        </div>
      </section>

      {/* ── MLM COMMISSIONS ── */}
      <section>
        <SectionTitle title="💎 MLM Commissions" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <StatCard label="Total Paid Out"      value={fmt(financial.totalCommissionsPaid)} accent="#1a7a4a" />
          <StatCard label="Total Wallet Balance" value={fmt(financial.totalWalletBalance)} accent="#2563eb" sub="Across all resellers" />
          <StatCard label="Pending Payouts"     value={fmtN(financial.totalPendingPayouts)} accent="#e05252" sub={fmt(financial.totalPendingAmount)} />
          <StatCard label="Points Earned"       value={fmtN(mlm.totalPointsEarned)} accent="#C9A84C" />
        </div>
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
          <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
            {['Commission Type', 'Count', '', '', ''].map((h, i) => (
              <p key={i} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
            ))}
          </div>
          {[
            { label: 'Direct Referral', count: mlm.directReferralCount,  accent: '#2563eb' },
            { label: 'Binary Pairing',  count: mlm.binaryPairingCount,   accent: '#1a7a4a' },
            { label: 'Sponsor Points',  count: mlm.sponsorPointCount,    accent: '#C9A84C' },
            { label: 'Multi-level',     count: mlm.multilevelCount,      accent: '#9a6f1e' },
            { label: 'Overflow',        count: mlm.totalOverflowCount,   accent: '#e05252' },
          ].map((c) => (
            <div key={c.label} className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 items-center">
              <div className="flex items-center gap-2 col-span-2">
                <div className="w-2 h-2 rounded-full" style={{ background: c.accent }} />
                <p className="text-xs font-medium text-[#0D1B3E]">{c.label}</p>
              </div>
              <p className="text-xs text-[#0D1B3E] col-span-2">{fmtN(c.count)} transactions</p>
              {/* Bar */}
              <div className="h-1.5 bg-[#F0F2F8] rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{
                  width: `${mlm.totalCommissions > 0 ? (c.count / mlm.totalCommissions) * 100 : 0}%`,
                  background: c.accent,
                }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CATALOG & PINS ── */}
      <section>
        <SectionTitle title="📦 Catalog & PINs" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Active Products" value={fmtN(catalog.totalProducts)}
            accent="#0D1B3E" sub={`${fmtN(catalog.physicalProducts)} physical · ${fmtN(catalog.digitalProducts)} digital`} />
          <StatCard label="Active Packages"    value={fmtN(catalog.totalPackages)}      accent="#2563eb" />
          <StatCard label="PINs Generated"     value={fmtN(catalog.totalPinsGenerated)} accent="#0D1B3E"
            sub={`${fmtN(catalog.unusedPins)} unused · ${fmtN(catalog.usedPins)} used`} />
          <StatCard label="PIN Usage Rate"
            value={`${catalog.totalPinsGenerated > 0 ? Math.round((catalog.usedPins / catalog.totalPinsGenerated) * 100) : 0}%`}
            accent="#1a7a4a" />
        </div>
      </section>

    </div>
  )
}