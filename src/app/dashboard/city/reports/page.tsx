'use client'

import { useCallback, useEffect, useState } from 'react'

type ReportPeriod = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'all_time' | 'custom'
type SalesSummary = { orders: number; units: number; revenue: number; cost: number; profit: number }
type Breakdown = { id: string; name: string; units: number; revenue: number; cost: number; profit: number }

interface ReportData {
  account: { type: 'city' | 'branch'; coverage_area: string }
  period: { value: ReportPeriod; label: string; start: string | null; end: string | null }
  financial_integrity: { ledger_rows: number; legacy_reconstructed_rows: number; unclassified_used_pins: number; ledger_formula_mismatches: number }
  liquidation: {
    gross_revenue: number
    total_cost: number
    net_profit: number
    collected_cash_total: number
    collected_product_cash: number
    collected_registration_cash: number
    outstanding_product_sales: number
    total_orders: number
    total_units: number
  }
  member_sales: SalesSummary
  non_member_sales: SalesSummary
  registrations: {
    registrations: number
    customer_payment: number
    revenue: number
    cost: number
    acquisition_cost: number
    pin_allocation: number
    reseller_value: number
    profit: number
  }
  products: Breakdown[]
  packages: {
    id: string
    name: string
    registrations: number
    customer_payment: number
    revenue: number
    cost: number
    acquisition_cost: number
    pin_allocation: number
    reseller_value: number
    profit: number
  }[]
  notes: {
    sales_basis: string
    collection_basis: string
    registration_basis: string
    cost_basis: string
    registration_data_source: string
  }
}

const periods: { value: ReportPeriod; label: string }[] = [
  { value: 'today', label: 'Daily - Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'Weekly - This Week' },
  { value: 'this_month', label: 'Monthly - This Month' },
  { value: 'this_year', label: 'Yearly - This Year' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
]

const peso = (value: number) => `₱${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`

function MetricCard({ label, value, detail, color }: {
  label: string
  value: string
  detail: string
  color: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5" style={{ borderTop: `2px solid ${color}` }}>
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-xl font-bold mt-2" style={{ color }}>{value}</p>
      <p className="text-[11px] text-gray-400 mt-1">{detail}</p>
    </div>
  )
}

function BreakdownLine({ label, value, emphasize, color }: {
  label: string
  value: string
  emphasize?: boolean
  color?: string
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${emphasize ? 'border-t border-[#0D1B3E]/10 pt-2 mt-2' : ''}`}>
      <span className={emphasize ? 'font-semibold text-[#0D1B3E]' : 'text-gray-400'}>{label}</span>
      <span className={emphasize ? 'font-bold' : 'font-medium text-[#0D1B3E]'} style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  )
}

export default function CityReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>('today')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
const query = new URLSearchParams({ period: period === 'custom' && (!customStart || !customEnd) ? 'all_time' : period })
      if (period === 'custom' && customStart && customEnd) {
        query.set('start', customStart)
        query.set('end', customEnd)
      }
      const response = await fetch(`/api/city/reports?${query.toString()}`, { credentials: 'same-origin' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to generate the report.')
      setReport(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to generate the report.')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [period, customStart, customEnd])

useEffect(() => { loadReport() }, [loadReport])

  const selectPeriod = (nextPeriod: ReportPeriod) => {
    if (nextPeriod === 'custom' && (!customStart || !customEnd)) {
      const todayValue = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
      setCustomStart(todayValue)
      setCustomEnd(todayValue)
    }
    setPeriod(nextPeriod)
  }

  return (
    <div className="p-5 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B3E]">Sales & Liquidation Reports</h1>
          <p className="text-sm text-gray-400 mt-1">
            Revenue, collection, costs, and profit for daily business liquidation.
          </p>
        </div>
<div className="w-full md:w-auto flex flex-col sm:flex-row sm:items-end gap-2">
          <div className="w-full md:w-60">
            <label className="block text-xs text-gray-400 mb-1.5">Report period</label>
            <select value={period} onChange={(event) => selectPeriod(event.target.value as ReportPeriod)}
              className="w-full bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2.5 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
              {periods.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          {period === 'custom' && <>
            <input aria-label="Custom report start date" type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2.5 text-sm text-[#0D1B3E]" />
            <input aria-label="Custom report end date" type="date" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.target.value)} className="bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2.5 text-sm text-[#0D1B3E]" />
          </>}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl py-20 text-center text-sm text-gray-400">Generating report...</div>
      ) : error || !report ? (
        <div className="bg-white rounded-2xl py-20 text-center">
          <p className="text-sm text-[#a03030]">{error}</p>
          <button onClick={loadReport} className="text-xs text-[#C9A84C] mt-2 hover:underline">Retry</button>
        </div>
      ) : (
        <>
          {(report.financial_integrity.legacy_reconstructed_rows > 0 || report.financial_integrity.unclassified_used_pins > 0 || report.financial_integrity.ledger_formula_mismatches > 0) && (
            <div className="bg-[#fff3f3] border border-[#e8b3b3] rounded-xl px-4 py-3 mb-5 text-xs text-[#9d3030]">
              <p className="font-bold">Financial integrity attention required</p>
              <p className="mt-1">Ledger rows: {report.financial_integrity.ledger_rows}; reconstructed legacy registrations: {report.financial_integrity.legacy_reconstructed_rows}; unclassified used PINs excluded: {report.financial_integrity.unclassified_used_pins}; formula mismatches: {report.financial_integrity.ledger_formula_mismatches}.</p>
              <p className="mt-1">Audit and backfill each legacy row before treating it as an immutable historical financial record.</p>
            </div>
          )}
          <div className="bg-[#fef9ee] border border-[#C9A84C]/30 rounded-xl px-4 py-3 mb-5 text-xs text-[#7a6428]">
            {report.period.label} · {report.account.type === 'branch' ? 'Branch' : 'City Distributor'}
            {report.account.coverage_area ? ` · ${report.account.coverage_area}` : ''}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <MetricCard label="Gross Revenue" value={peso(report.liquidation.gross_revenue)}
              detail="Product revenue only; prepaid PIN allocation excluded" color="#1a7a4a" />
            <MetricCard label="Total Cost" value={peso(report.liquidation.total_cost)}
              detail={report.notes.cost_basis} color="#dc4444" />
            <MetricCard label="Net Profit" value={peso(report.liquidation.net_profit)}
              detail="Gross revenue minus total cost" color="#2563eb" />
            <MetricCard label="Cash Collected" value={peso(report.liquidation.collected_cash_total)}
              detail={`Products ${peso(report.liquidation.collected_product_cash)} · Registrations ${peso(report.liquidation.collected_registration_cash)} · Outstanding ${peso(report.liquidation.outstanding_product_sales)}`} color="#C9A84C" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            {[
              { title: 'Member / Reseller Sales', data: report.member_sales },
              { title: 'Non-member / SRP Sales', data: report.non_member_sales },
            ].map(({ title, data }) => (
              <div key={title} className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
                <h2 className="text-sm font-bold text-[#0D1B3E]">{title}</h2>
                <p className="text-xl font-bold text-[#1a7a4a] mt-3">{peso(data.revenue)}</p>
                <div className="grid grid-cols-2 gap-y-2 text-xs mt-4">
                  <span className="text-gray-400">Orders</span><span className="text-right">{data.orders}</span>
                  <span className="text-gray-400">Units sold</span><span className="text-right">{data.units}</span>
                  <span className="text-gray-400">Cost</span><span className="text-right">{peso(data.cost)}</span>
                  <span className="text-gray-400">Profit</span><span className="text-right font-semibold text-[#1a7a4a]">{peso(data.profit)}</span>
                </div>
              </div>
            ))}
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
              <h2 className="text-sm font-bold text-[#0D1B3E]">New Reseller Registrations</h2>
              <p className="text-xl font-bold text-[#C9A84C] mt-3">{peso(report.registrations.profit)}</p>
              <div className="grid grid-cols-2 gap-y-2 text-xs mt-4">
                <span className="text-gray-400">Registrations</span><span className="text-right">{report.registrations.registrations}</span>
                <span className="text-gray-400">Customer cash collected</span><span className="text-right">{peso(report.registrations.customer_payment)}</span>
                <span className="text-gray-400">Product revenue</span><span className="text-right">{peso(report.registrations.revenue)}</span>
                <span className="text-gray-400">Product acquisition</span><span className="text-right">{peso(report.registrations.acquisition_cost)}</span>
                <span className="text-gray-400">Prepaid PIN allocation consumed</span><span className="text-right">{peso(report.registrations.pin_allocation)}</span>
                <span className="text-gray-400">Profit</span><span className="text-right font-semibold text-[#1a7a4a]">{peso(report.registrations.profit)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8 bg-gradient-to-r from-[#0D1B3E] to-[#162b5b]">
              <h2 className="text-sm font-bold text-white">Overall Liquidation Breakdown</h2>
              <p className="text-[11px] text-white/65 mt-1">
                Complete reconciliation of sales, registration activity, costs, collections, and final net profit.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
              <div className="p-5 border-b md:border-r xl:border-b-0 border-[#0D1B3E]/8">
                <p className="text-xs font-bold uppercase tracking-wide text-[#1a7a4a] mb-4">Revenue Composition</p>
                <div className="space-y-2.5 text-xs">
                  <BreakdownLine label="Member / reseller sales" value={peso(report.member_sales.revenue)} />
                  <BreakdownLine label="Non-member / SRP sales" value={peso(report.non_member_sales.revenue)} />
                  <BreakdownLine label="Registration product revenue" value={peso(report.registrations.revenue)} />
                  <BreakdownLine label="Gross revenue" value={peso(report.liquidation.gross_revenue)}
                    emphasize color="#1a7a4a" />
                </div>
              </div>

              <div className="p-5 border-b xl:border-b-0 xl:border-r border-[#0D1B3E]/8">
                <p className="text-xs font-bold uppercase tracking-wide text-[#dc4444] mb-4">Cost Composition</p>
                <div className="space-y-2.5 text-xs">
                  <BreakdownLine label="Member / reseller cost" value={peso(report.member_sales.cost)} />
                  <BreakdownLine label="Non-member / SRP cost" value={peso(report.non_member_sales.cost)} />
                  <BreakdownLine label="Registration product acquisition" value={peso(report.registrations.acquisition_cost)} />
                  <BreakdownLine label="Total cost" value={peso(report.liquidation.total_cost)}
                    emphasize color="#dc4444" />
                </div>
              </div>

              <div className="p-5 border-b md:border-b-0 md:border-r border-[#0D1B3E]/8">
                <p className="text-xs font-bold uppercase tracking-wide text-[#2563eb] mb-4">Profit Reconciliation</p>
                <div className="space-y-2.5 text-xs">
                  <BreakdownLine label="Member / reseller profit" value={peso(report.member_sales.profit)} />
                  <BreakdownLine label="Non-member / SRP profit" value={peso(report.non_member_sales.profit)} />
                  <BreakdownLine label="Registration profit" value={peso(report.registrations.profit)} />
                  <BreakdownLine label="Overall net profit" value={peso(report.liquidation.net_profit)}
                    emphasize color="#2563eb" />
                </div>
              </div>

              <div className="p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-[#C9A84C] mb-4">Cash Accountability</p>
                <div className="space-y-2.5 text-xs">
                  <BreakdownLine label="Product cash collected" value={peso(report.liquidation.collected_product_cash)} />
                  <BreakdownLine label="Registration cash collected" value={peso(report.registrations.customer_payment)} />
                  <BreakdownLine label="Prepaid PIN allocation consumed" value={peso(report.registrations.pin_allocation)} />
                  <BreakdownLine label="Outstanding product sales" value={peso(report.liquidation.outstanding_product_sales)} />
                  <BreakdownLine label="Total cash collected" value={peso(report.liquidation.collected_cash_total)}
                    emphasize color="#9a7418" />
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-[#fef9ee] border-t border-[#C9A84C]/20 text-[11px] text-[#7a6428]">
              Net profit reconciliation: {peso(report.member_sales.profit)} member sales + {peso(report.non_member_sales.profit)}
              {' '}non-member sales + {peso(report.registrations.profit)} registrations = {peso(report.liquidation.net_profit)}.
              Registration cash includes {peso(report.registrations.pin_allocation)} already paid when the PIN was purchased and is not counted as City/Branch revenue, cost, or profit.
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-x-auto">
              <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
                <h2 className="text-sm font-bold text-[#0D1B3E]">Product Sales Breakdown</h2>
              </div>
              <table className="w-full min-w-[600px] text-xs">
                <thead className="bg-[#F0F2F8] text-gray-400">
                  <tr>{['Product', 'Units', 'Revenue', 'Cost', 'Profit'].map((heading) =>
                    <th key={heading} className="text-left font-medium px-4 py-3">{heading}</th>)}</tr>
                </thead>
                <tbody>
                  {report.products.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-gray-400 py-10">No delivered product sales.</td></tr>
                  ) : report.products.map((row) => (
                    <tr key={row.id} className="border-b border-[#0D1B3E]/5">
                      <td className="px-4 py-3 font-medium text-[#0D1B3E]">{row.name}</td>
                      <td className="px-4 py-3">{row.units}</td>
                      <td className="px-4 py-3">{peso(row.revenue)}</td>
                      <td className="px-4 py-3">{peso(row.cost)}</td>
                      <td className="px-4 py-3 font-semibold text-[#1a7a4a]">{peso(row.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-x-auto">
              <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
                <h2 className="text-sm font-bold text-[#0D1B3E]">Registration Breakdown</h2>
              </div>
              <table className="w-full min-w-[600px] text-xs">
                <thead className="bg-[#F0F2F8] text-gray-400">
                  <tr>{['Package', 'Count', 'Product Revenue', 'Prepaid PIN Allocation', 'Profit'].map((heading) =>
                    <th key={heading} className="text-left font-medium px-4 py-3">{heading}</th>)}</tr>
                </thead>
                <tbody>
                  {report.packages.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-gray-400 py-10">No completed registrations.</td></tr>
                  ) : report.packages.map((row) => (
                    <tr key={row.id} className="border-b border-[#0D1B3E]/5">
                      <td className="px-4 py-3 font-medium text-[#0D1B3E]">{row.name}</td>
                      <td className="px-4 py-3">{row.registrations}</td>
                      <td className="px-4 py-3">{peso(row.revenue)}</td>
                      <td className="px-4 py-3">{peso(row.pin_allocation)}</td>
                      <td className="px-4 py-3 font-semibold text-[#1a7a4a]">{peso(row.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 px-4 py-3 mt-5 text-[11px] text-gray-400">
            {report.notes.sales_basis}. {report.notes.collection_basis}. {report.notes.registration_basis}.
            <span className="block mt-1">Registration source: {report.notes.registration_data_source}.</span>
          </div>
        </>
      )}
    </div>
  )
}
