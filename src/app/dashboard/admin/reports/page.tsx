'use client'

import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'

// ============================================================
// TYPES
// ============================================================

interface DailySale   { date: string; orders: number; revenue: number }
interface TopProduct  { product_id: string; name: string; type: string; units_sold: number; revenue: number }
interface ProductSale { product_id: string; name: string; type: string; units_sold: number; revenue: number; cost: number; profit: number }
interface PinSale     { package_id: string; package_name: string; pins_sold: number; pin_price: number; products_value: number; package_value: number; revenue: number }

interface ReportData {
  period: { days: number; since: string; until: string; dateFrom: string | null; dateTo: string | null }
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
  overview: {
    totalProductRevenue: number; totalProductCost: number; totalProductProfit: number; totalProductUnitsSold: number
    totalPinRevenue: number; totalPinsSoldPeriod: number
    overallRevenue: number; overallProfit: number
  }
  productSales: { breakdown: ProductSale[]; resellerOrders: { product_id: string; name: string; type: string; units_sold: number; revenue: number }[] }
  pinSales: { breakdown: PinSale[]; totalRevenue: number; totalPinsSold: number }
  charts: { dailySales: DailySale[]; topProducts: TopProduct[] }
}

// ============================================================
// HELPERS
// ============================================================

const fmt  = (n: number) => `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtN = (n: number) => Number(n).toLocaleString()

function StatCard({ label, value, accent, sub, icon, badge }: { label: string; value: string; accent: string; sub?: string; icon?: string; badge?: string }) {
  return (
    <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:shadow-sm transition-all" style={{ borderTop: `2px solid ${accent}` }}>
      <div className="flex items-start justify-between mb-3">
        {icon ? <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: accent + '15' }}>{icon}</div> : <div />}
        {badge && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: accent + '15', color: accent }}>{badge}</span>}
      </div>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-xl font-bold" style={{ color: accent }}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-[#0D1B3E]">{title}</h2>
      {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
  )
}

// Simple SVG bar chart
function BarChart({ data }: { data: DailySale[] }) {
  if (!data.length) return null
  const max = Math.max(...data.map((d) => d.revenue), 1)
  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 h-32 min-w-max px-1">
        {data.map((d) => {
          const h = Math.max(4, (d.revenue / max) * 120)
          return (
            <div key={d.date} className="flex flex-col items-center gap-1 group relative">
              <div className="absolute bottom-8 bg-[#0D1B3E] text-white text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
                {new Date(d.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}<br />
                {fmt(d.revenue)}<br />
                {d.orders} orders
              </div>
              <div className="w-5 bg-[#C9A84C] rounded-t transition-all" style={{ height: `${h}px` }} />
              <p className="text-[8px] text-gray-400 rotate-45 origin-left whitespace-nowrap mt-1">
                {new Date(d.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function AdminReportsPage() {
  const [report, setReport]   = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab]   = useState<'overview' | 'products' | 'pins' | 'packages' | 'network' | 'mlm'>('overview')
  const [showAllTime, setShowAllTime] = useState(false)

  // Filters
  const [days,     setDays]     = useState(30)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [useRange, setUseRange] = useState(false)

  const fetchReport = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (useRange && dateFrom) {
      params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
    } else {
      params.set('days', String(days))
    }
    fetch(`/api/admin/reports?${params}`)
      .then((r) => r.json())
      .then((d) => setReport(d.report || null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchReport() }, [days, useRange])

  const applyRange = () => { if (dateFrom) fetchReport() }


  // ── Export to Excel ──
  const exportExcel = () => {
    if (!report) return
    const wb = XLSX.utils.book_new()

    // Overview sheet
    const overviewData = [
      ['HIROMA MLM - Sales Report'],
      ['Period', report.period.dateFrom ? `${report.period.dateFrom} to ${report.period.dateTo || 'today'}` : `Last ${report.period.days} days`],
      ['Generated', new Date().toLocaleString('en-PH')],
      [],
      ['OVERALL SUMMARY'],
      ['Metric', 'Value'],
      ['Total Revenue',          fmt(overview.overallRevenue)],
      ['Total Profit',           fmt(overview.overallProfit)],
      ['Product Revenue',        fmt(overview.totalProductRevenue)],
      ['Product Cost',           fmt(overview.totalProductCost)],
      ['Product Profit',         fmt(overview.totalProductProfit)],
      ['Units Sold',             fmtN(overview.totalProductUnitsSold)],
      ['PIN Revenue',            fmt(overview.totalPinRevenue)],
      ['PINs Sold',              fmtN(overview.totalPinsSoldPeriod)],
      [],
      ['CHAIN REVENUE BY LEVEL'],
      ['Level',        'Orders', 'Revenue'],
      ['Regional',     fmtN(sales.regionalOrders),   fmt(sales.regionalRevenue)],
      ['Provincial',   fmtN(sales.provincialOrders), fmt(sales.provincialRevenue)],
      ['City',         fmtN(sales.cityOrders),        fmt(sales.cityRevenue)],
      ['Total Chain',  fmtN(sales.chainOrders),       fmt(sales.chainRevenue)],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overviewData), 'Overview')

    // Product Sales sheet
    const productData = [
      ['PRODUCT SALES BREAKDOWN'],
      ['Product', 'Type', 'Units Sold', 'Revenue', 'Cost', 'Profit'],
      ...productSales.breakdown.map((p) => [p.name, p.type, p.units_sold, p.revenue, p.cost, p.profit]),
      [],
      ['TOTALS', '', overview.totalProductUnitsSold, overview.totalProductRevenue, overview.totalProductCost, overview.totalProductProfit],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(productData), 'Product Sales')

    // PIN Sales sheet
    const pinData = [
      ['PIN SALES BREAKDOWN'],
      ['Package', 'PINs Sold', 'Revenue', 'Share %'],
      ...pinSales.breakdown.map((p) => [
        p.package_name, p.pins_sold, p.revenue,
        pinSales.totalRevenue > 0 ? ((p.revenue / pinSales.totalRevenue) * 100).toFixed(1) + '%' : '0%'
      ]),
      [],
      ['TOTALS', pinSales.totalPinsSold, pinSales.totalRevenue, '100%'],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pinData), 'PIN Sales')

    // Daily Sales sheet
    const dailyData = [
      ['DAILY REVENUE'],
      ['Date', 'Orders', 'Revenue'],
      ...charts.dailySales.map((d) => [d.date, d.orders, d.revenue]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailyData), 'Daily Sales')

    // Network sheet
    const networkData = [
      ['NETWORK SUMMARY'],
      ['Metric', 'Value'],
      ['Total Resellers',    fmtN(network.totalResellers)],
      ['Active Resellers',   fmtN(network.activeResellers)],
      ['Inactive Resellers', fmtN(network.suspendedResellers)],
      ['Regional Dists',     fmtN(network.regionalCount)],
      ['Provincial Dists',   fmtN(network.provincialCount)],
      ['City Dists',         fmtN(network.cityCount)],
      [],
      ['FINANCIAL'],
      ['Total Wallet Balance',  fmt(financial.totalWalletBalance)],
      ['Total Earned',          fmt(financial.totalEarned)],
      ['Total Withdrawn',       fmt(financial.totalWithdrawn)],
      ['Pending Payouts',       fmtN(financial.totalPendingPayouts)],
      ['Pending Amount',        fmt(financial.totalPendingAmount)],
      ['Total Commissions Paid',fmt(financial.totalCommissionsPaid)],
      [],
      ['MLM COMMISSIONS'],
      ['Direct Referrals',   fmtN(mlm.directReferralCount)],
      ['Binary Pairings',    fmtN(mlm.binaryPairingCount)],
      ['Sponsor Points',     fmtN(mlm.sponsorPointCount)],
      ['Overflow to HIROMA', fmtN(mlm.totalOverflowCount)],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(networkData), 'Network & MLM')

    const date = new Date().toISOString().split('T')[0]
    XLSX.writeFile(wb, `hiroma-report-${date}.xlsx`)
  }

  // ── Export to PDF (print) ──
  const exportPDF = () => { window.print() }

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!report) return <p className="text-center text-gray-400 py-12">No data available.</p>

  const { network, financial, sales, mlm, catalog, overview, productSales, pinSales, charts } = report

  return (
    <div className="max-w-7xl mx-auto space-y-8 print-area">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; }
          button { display: none !important; }
        }
      `}</style>

      {/* Header + date controls */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Reports</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {useRange && dateFrom
              ? `${new Date(dateFrom).toLocaleDateString('en-PH')} → ${dateTo ? new Date(dateTo).toLocaleDateString('en-PH') : 'today'}`
              : `Last ${days} days`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Export buttons */}
          <button onClick={exportExcel}
            className="flex items-center gap-1.5 text-xs bg-[#1a7a4a] text-white px-3 py-1.5 rounded-lg hover:bg-[#15633c] transition-colors">
            📊 Export Excel
          </button>
          <button onClick={exportPDF}
            className="flex items-center gap-1.5 text-xs bg-[#e05252] text-white px-3 py-1.5 rounded-lg hover:bg-[#c94444] transition-colors">
            🖨️ Print / PDF
          </button>
          {/* Quick period buttons */}
          {!useRange && (
            <div className="flex gap-1">
              {[7, 14, 30, 60, 90].map((d) => (
                <button key={d} onClick={() => setDays(d)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${days === d && !useRange ? 'bg-[#0D1B3E] text-white' : 'bg-white border border-[#0D1B3E]/10 text-gray-400 hover:text-[#0D1B3E]'}`}>
                  {d}d
                </button>
              ))}
            </div>
          )}

          {/* Date range toggle */}
          <button onClick={() => { setUseRange(!useRange); setDateFrom(''); setDateTo('') }}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${useRange ? 'bg-[#C9A84C] text-[#0D1B3E] border-[#C9A84C]' : 'bg-white border-[#0D1B3E]/10 text-gray-400 hover:text-[#0D1B3E]'}`}>
            📅 Custom Range
          </button>

          {/* Date inputs */}
          {useRange && (
            <div className="flex items-center gap-2">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-1.5 text-xs text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />
              <span className="text-xs text-gray-400">to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-1.5 text-xs text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />
              <button onClick={applyRange}
                className="bg-[#0D1B3E] text-white text-xs px-3 py-1.5 rounded-lg hover:bg-[#162850]">
                Apply
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit flex-wrap">
        {([
          { key: 'overview', label: '📊 Overview'      },
          { key: 'products', label: '📦 Product Sales' },
          { key: 'pins',     label: '🔑 PIN Sales'     },
          { key: 'packages', label: '📦 Package Sales'  },
          { key: 'network',  label: '👥 Network'       },
          { key: 'mlm',      label: '💰 MLM & Commissions' },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-xs transition-colors ${activeTab === t.key ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════ */}
      {/* OVERVIEW TAB */}
      {/* ══════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <div className="space-y-6">

          {/* Overall sales summary */}
          <div>
            <SectionTitle title="Overall Sales Summary" subtitle="Product sales + PIN sales combined for the period" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total Revenue"   icon="💰" value={fmt(overview.overallRevenue)}          accent="#1a7a4a" sub="PIN + Product combined" />
              <StatCard label="Total Profit"    icon="📈" value={fmt(overview.overallProfit)}           accent="#2563eb" sub={`${Math.round(overview.overallRevenue > 0 ? (overview.overallProfit/overview.overallRevenue)*100 : 0)}% margin`} />
              <StatCard label="Product Revenue" icon="🧴" value={fmt(overview.totalProductRevenue)}     accent="#0D1B3E" sub={`${fmtN(overview.totalProductUnitsSold)} units sold`} />
              <StatCard label="PIN Revenue"     icon="🔑" value={fmt(overview.totalPinRevenue)}         accent="#C9A84C" sub={`${fmtN(overview.totalPinsSoldPeriod)} PINs sold`} />
            </div>
          </div>

          {/* Admin direct sales */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-base font-bold text-[#0D1B3E]">Admin Direct Sales</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {showAllTime ? 'All-time performance' : `Last ${report.period.days} days`}
                </p>
              </div>
              <div className="flex items-center gap-2 bg-white border border-[#0D1B3E]/8 rounded-xl p-1">
                <button onClick={() => setShowAllTime(false)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${!showAllTime ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
                  Period
                </button>
                <button onClick={() => setShowAllTime(true)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${showAllTime ? 'bg-[#C9A84C] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
                  All Time
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total Revenue" icon="💰"
                value={fmt(showAllTime ? sales.adminRevenue : sales.periodRevenue)}
                accent="#1a7a4a"
                sub={showAllTime ? `${fmtN(sales.adminOrders)} total orders` : `${fmtN(sales.periodOrders)} orders this period`} />
              <StatCard label="Total Cost" icon="🏷️"
                value={fmt(showAllTime ? sales.adminCost : sales.adminCost * (sales.periodRevenue / (sales.adminRevenue || 1)))}
                accent="#e05252"
                sub="Cost of goods sold" />
              <StatCard label="Net Profit" icon="📈"
                value={fmt(showAllTime ? sales.adminProfit : sales.periodRevenue - (sales.adminCost * (sales.periodRevenue / (sales.adminRevenue || 1))))}
                accent="#2563eb"
                sub={sales.adminRevenue > 0 ? `${Math.round((sales.adminProfit / sales.adminRevenue) * 100)}% margin` : ''} />
              <StatCard label="Units Sold" icon="📦"
                value={fmtN(showAllTime ? sales.adminUnitsSold : Math.round(sales.adminUnitsSold * (sales.periodRevenue / (sales.adminRevenue || 1))))}
                accent="#C9A84C"
                sub={showAllTime ? 'All time' : 'Estimated period'} />
            </div>
          </div>



          {/* Daily revenue chart */}
          <div>
            <SectionTitle title="Daily Revenue" subtitle="Delivered order revenue per day" />
            <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-5">
              <BarChart data={charts.dailySales} />
              {charts.dailySales.every((d) => d.revenue === 0) && (
                <p className="text-center text-gray-400 text-sm py-6">No delivered orders in this period.</p>
              )}
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* PRODUCT SALES TAB */}
      {/* ══════════════════════════════════════════════ */}
      {activeTab === 'products' && (
        <div className="space-y-6">

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Revenue"    value={fmt(overview.totalProductRevenue)}    accent="#0D1B3E" />
            <StatCard label="Total Cost"       value={fmt(overview.totalProductCost)}       accent="#e05252" />
            <StatCard label="Total Profit"     value={fmt(overview.totalProductProfit)}     accent="#1a7a4a" />
            <StatCard label="Units Sold"       value={fmtN(overview.totalProductUnitsSold)} accent="#C9A84C" />
          </div>

          {/* Distributor product orders breakdown */}
          <div>
            <SectionTitle title="Product Sales Breakdown" subtitle="All delivered product orders across the chain (period)" />
            <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="grid px-4 py-2 bg-[#F0F2F8]" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}>
                {['Product', 'Type', 'Units Sold', 'Revenue', 'Cost', 'Profit'].map((h) => (
                  <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
                ))}
              </div>
              {productSales.breakdown.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-10">No product sales in this period.</p>
              ) : (
                productSales.breakdown.map((p, i) => (
                  <div key={p.product_id} className="grid px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 items-center"
                    style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                      <p className="text-xs font-medium text-[#0D1B3E]">{p.name}</p>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded w-fit ${p.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'}`}>{p.type}</span>
                    <p className="text-xs font-semibold text-[#0D1B3E]">{fmtN(p.units_sold)}</p>
                    <p className="text-xs text-[#2563eb]">{fmt(p.revenue)}</p>
                    <p className="text-xs text-[#e05252]">{fmt(p.cost)}</p>
                    <p className={`text-xs font-semibold ${p.profit >= 0 ? 'text-[#1a7a4a]' : 'text-[#e05252]'}`}>{fmt(p.profit)}</p>
                  </div>
                ))
              )}
              {productSales.breakdown.length > 0 && (
                <div className="grid px-4 py-3 bg-[#F0F2F8] font-semibold" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}>
                  <p className="text-xs text-[#0D1B3E] col-span-2">TOTAL</p>
                  <p className="text-xs text-[#0D1B3E]">{fmtN(overview.totalProductUnitsSold)}</p>
                  <p className="text-xs text-[#2563eb]">{fmt(overview.totalProductRevenue)}</p>
                  <p className="text-xs text-[#e05252]">{fmt(overview.totalProductCost)}</p>
                  <p className="text-xs text-[#1a7a4a]">{fmt(overview.totalProductProfit)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Top 10 products chart */}
          <div>
            <SectionTitle title="Top 10 Products by Units Sold" subtitle="Most sold products in the period" />
            <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 space-y-2">
              {charts.topProducts.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-6">No data.</p>
              ) : (() => {
                const maxUnits = Math.max(...charts.topProducts.map((p) => p.units_sold), 1)
                return charts.topProducts.map((p, i) => (
                  <div key={p.product_id} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-5 flex-shrink-0">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-xs font-medium text-[#0D1B3E] truncate">{p.name}</p>
                        <p className="text-xs text-gray-400 ml-2 flex-shrink-0">{fmtN(p.units_sold)} units · {fmt(p.revenue)}</p>
                      </div>
                      <div className="w-full bg-[#F0F2F8] rounded-full h-1.5">
                        <div className="bg-[#C9A84C] h-1.5 rounded-full" style={{ width: `${(p.units_sold / maxUnits) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* PIN SALES TAB */}
      {/* ══════════════════════════════════════════════ */}
      {activeTab === 'pins' && (
        <div className="space-y-6">

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total PIN Revenue" value={fmt(pinSales.totalRevenue)}  accent="#0D1B3E" />
            <StatCard label="PINs Sold (Period)" value={fmtN(pinSales.totalPinsSold)} accent="#C9A84C" />
            <StatCard label="Total Generated"   value={fmtN(catalog.totalPinsGenerated)} accent="#0D1B3E" />
            <StatCard label="Unused PINs"       value={fmtN(catalog.unusedPins)}     accent="#9a6f1e" sub={`${fmtN(catalog.usedPins)} used`} />
          </div>

          {/* PIN sales by package */}
          <div>
            <SectionTitle title="PIN Sales by Package" subtitle="Number of PINs used and revenue per package (period)" />
            <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
              <div className="grid px-4 py-2 bg-[#F0F2F8]" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                {['Package', 'PINs Sold', 'Revenue', 'Share'].map((h) => (
                  <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
                ))}
              </div>
              {pinSales.breakdown.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-10">No PIN sales in this period.</p>
              ) : (
                pinSales.breakdown.map((p, i) => {
                  const pct = pinSales.totalRevenue > 0 ? ((p.revenue / pinSales.totalRevenue) * 100).toFixed(1) : '0'
                  const share = pinSales.totalRevenue > 0 ? (p.revenue / pinSales.totalRevenue) * 100 : 0
                  return (
                    <div key={p.package_id} className="grid px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 items-center"
                      style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                        <div>
                          <p className="text-xs font-semibold text-[#0D1B3E]">{p.package_name}</p>
                          <div className="w-24 bg-[#F0F2F8] rounded-full h-1 mt-1">
                            <div className="bg-[#C9A84C] h-1 rounded-full" style={{ width: `${share}%` }} />
                          </div>
                        </div>
                      </div>
                      <p className="text-xs font-semibold text-[#0D1B3E]">{fmtN(p.pins_sold)}</p>
                      <p className="text-xs font-semibold text-[#2563eb]">{fmt(p.revenue)}</p>
                      <p className="text-xs text-gray-400">{share.toFixed(1)}%</p>
                    </div>
                  )
                })
              )}
              {pinSales.breakdown.length > 0 && (
                <div className="grid px-4 py-3 bg-[#F0F2F8] font-semibold" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                  <p className="text-xs text-[#0D1B3E] col-span-1">TOTAL</p>
                  <p className="text-xs text-[#0D1B3E]">{fmtN(pinSales.totalPinsSold)}</p>
                  <p className="text-xs text-[#2563eb]">{fmt(pinSales.totalRevenue)}</p>
                  <p className="text-xs text-gray-400">100%</p>
                </div>
              )}
            </div>
          </div>

          {/* Catalog summary */}
          <div>
            <SectionTitle title="Package Catalog" subtitle="All packages and PINs in the system" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="Active Packages"   value={fmtN(catalog.totalPackages)}       accent="#0D1B3E" />
              <StatCard label="Total PINs"        value={fmtN(catalog.totalPinsGenerated)}  accent="#0D1B3E" />
              <StatCard label="Unused PINs"       value={fmtN(catalog.unusedPins)}          accent="#C9A84C" sub={`${fmtN(catalog.usedPins)} used`} />
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* PACKAGE SALES TAB */}
      {activeTab === 'packages' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Packages Sold"      value={fmtN(pinSales.totalPinsSold)} accent="#0D1B3E" />
            <StatCard label="PIN Revenue"         value={fmt(pinSales.totalRevenue)}   accent="#C9A84C" />
            <StatCard label="Products Revenue"    value={fmt(pinSales.breakdown.reduce((s, p) => s + (p.products_value || 0) * p.pins_sold, 0))} accent="#2563eb" />
            <StatCard label="Total Package Value" value={fmt(pinSales.breakdown.reduce((s, p) => s + (p.package_value || 0) * p.pins_sold, 0))} accent="#1a7a4a" />
          </div>

          <SectionTitle title="Package Sales Breakdown" subtitle="PIN price + included product values per package sold" />
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="grid px-4 py-2 bg-[#F0F2F8] text-xs text-gray-400 uppercase tracking-wide font-medium" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}>
              <span>Package</span>
              <span>Sold</span>
              <span>PIN Price</span>
              <span>Products Value</span>
              <span>Total / Package</span>
              <span>Total Revenue</span>
            </div>
            {pinSales.breakdown.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-6 text-center">No package sales in this period.</p>
            ) : (
              <>
                {pinSales.breakdown.map((p) => (
                  <div key={p.package_id} className="grid px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 items-center" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}>
                    <span className="text-xs font-medium text-[#0D1B3E]">{p.package_name}</span>
                    <span className="text-xs text-gray-500">{fmtN(p.pins_sold)}</span>
                    <span className="text-xs text-gray-400">{fmt(p.pin_price || 0)}</span>
                    <span className="text-xs text-gray-400">{fmt(p.products_value || 0)}</span>
                    <span className="text-xs font-medium text-[#C9A84C]">{fmt(p.package_value || 0)}</span>
                    <span className="text-xs font-bold text-[#0D1B3E]">{fmt((p.package_value || 0) * p.pins_sold)}</span>
                  </div>
                ))}
                <div className="grid px-4 py-3 bg-[#F0F2F8] font-semibold" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}>
                  <span className="text-xs text-[#0D1B3E]">TOTAL</span>
                  <span className="text-xs text-[#0D1B3E]">{fmtN(pinSales.totalPinsSold)}</span>
                  <span />
                  <span />
                  <span />
                  <span className="text-xs text-[#1a7a4a]">{fmt(pinSales.breakdown.reduce((s, p) => s + (p.package_value || 0) * p.pins_sold, 0))}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* NETWORK TAB */}
      {/* ══════════════════════════════════════════════ */}
      {activeTab === 'network' && (
        <div className="space-y-6">
          <div>
            <SectionTitle title="Reseller Network" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="Total Resellers"  value={fmtN(network.totalResellers)}   accent="#0D1B3E" />
              <StatCard label="Active Resellers" value={fmtN(network.activeResellers)}  accent="#1a7a4a" />
              <StatCard label="Inactive"         value={fmtN(network.suspendedResellers)} accent="#e05252" />
            </div>
          </div>
          <div>
            <SectionTitle title="Distributor Network" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Total Distributors" value={fmtN(network.totalDistributors)} accent="#0D1B3E" />
              <StatCard label="Regional"           value={fmtN(network.regionalCount)}     accent="#7c3aed" />
              <StatCard label="Provincial"         value={fmtN(network.provincialCount)}   accent="#2563eb" />
              <StatCard label="City"               value={fmtN(network.cityCount)}         accent="#C9A84C" />
            </div>
          </div>
          <div>
            <SectionTitle title="Financial Overview" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="Total Wallet Balance"  value={fmt(financial.totalWalletBalance)}   accent="#0D1B3E" />
              <StatCard label="Total Earned (All)"    value={fmt(financial.totalEarned)}          accent="#1a7a4a" />
              <StatCard label="Total Withdrawn"       value={fmt(financial.totalWithdrawn)}       accent="#e05252" />
              <StatCard label="Pending Payouts"       value={fmtN(financial.totalPendingPayouts)} accent="#9a6f1e" sub={fmt(financial.totalPendingAmount)} />
              <StatCard label="Total Commissions"     value={fmt(financial.totalCommissionsPaid)} accent="#C9A84C" />
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════ */}
      {/* MLM TAB */}
      {/* ══════════════════════════════════════════════ */}
      {activeTab === 'mlm' && (
        <div className="space-y-6">
          <div>
            <SectionTitle title="Commission Breakdown" subtitle="All commissions ever paid" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="Total Commissions"   value={fmtN(mlm.totalCommissions)}    accent="#0D1B3E" />
              <StatCard label="Direct Referrals"    value={fmtN(mlm.directReferralCount)} accent="#1a7a4a" />
              <StatCard label="Binary Pairings"     value={fmtN(mlm.binaryPairingCount)}  accent="#C9A84C" />
              <StatCard label="Sponsor Points"      value={fmtN(mlm.sponsorPointCount)}   accent="#2563eb" />
              <StatCard label="Overflow to HIROMA"  value={fmtN(mlm.totalOverflowCount)}  accent="#e05252" />
              <StatCard label="Total Points Earned" value={fmtN(mlm.totalPointsEarned)}   accent="#7c3aed" sub="product binary points" />
            </div>
          </div>

          {/* Commission type breakdown bar */}
          <div>
            <SectionTitle title="Commission Type Distribution" />
            <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-5 space-y-3">
              {[
                { label: 'Direct Referral', value: mlm.directReferralCount, color: '#1a7a4a' },
                { label: 'Binary Pairing',  value: mlm.binaryPairingCount,  color: '#C9A84C' },
                { label: 'Sponsor Points',  value: mlm.sponsorPointCount,   color: '#2563eb' },
                { label: 'Overflow',        value: mlm.totalOverflowCount,  color: '#e05252' },
              ].map((item) => {
                const pct = mlm.totalCommissions > 0 ? (item.value / mlm.totalCommissions) * 100 : 0
                return (
                  <div key={item.label} className="flex items-center gap-3">
                    <p className="text-xs text-gray-500 w-32 flex-shrink-0">{item.label}</p>
                    <div className="flex-1 bg-[#F0F2F8] rounded-full h-2">
                      <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: item.color }} />
                    </div>
                    <p className="text-xs font-medium text-[#0D1B3E] w-12 text-right">{fmtN(item.value)}</p>
                    <p className="text-[10px] text-gray-400 w-10 text-right">{pct.toFixed(1)}%</p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}