'use client'

import { useCallback, useEffect, useState } from 'react'
import DepositReconciliationPanel from './DepositReconciliationPanel'

type ReportPeriod = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'this_year' | 'all_time' | 'custom'
type SalesSummary = { orders: number; units: number; revenue: number; cost: number; profit: number }
type Breakdown = { id: string; name: string; sale_type: 'member' | 'non_member'; units: number; revenue: number; cost: number; profit: number }

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
  collections: {
    total: number
    methods: { method: string; label: string; amount: number; transactions: number }[]
    note: string
  }
  payment_status_summary: {
    paid: { orders: number; amount: number }
    awaiting: { orders: number; amount: number }
    cancelled: { orders: number; amount: number }
  }
  adjustments: {
    physical_count_events: number
    units_added: number
    units_removed: number
    net_units: number
    value_added: number
    value_removed: number
    net_value_change: number
    events: { id: string; quantity_delta: number; total_value: number; reason: string | null; actor_name_snapshot: string; created_at: string; reference_id: string | null }[]
    refunds: { supported: boolean; amount: number | null; note: string }
  }
  deposit_summary: null | {
    records: number
    expected_cash: number
    deposited: number
    variance: number
    statuses: Record<string, number>
    latest: { id: string; reference_number: string; expected_cash_snapshot: number; deposit_amount: number; variance_amount: number; status: string; deposited_at: string }[]
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
  { value: 'last_week', label: 'Weekly - Last Week' },
  { value: 'this_month', label: 'Monthly - This Month' },
  { value: 'this_year', label: 'Yearly - This Year' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
]

const peso = (value: number) => `₱${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`

const metricCardTones = {
  revenue: '#1F8E65',
  cost: '#C63F47',
  profit: '#326BE0',
  cash: '#AC7E18',
} as const

function MetricCard({ label, value, detail, tone }: {
  label: string
  value: string
  detail: string
  tone: keyof typeof metricCardTones
}) {
  return (
    <div
      className="min-h-32 rounded-2xl border border-black/5 p-5 text-white"
      style={{ backgroundColor: metricCardTones[tone] }}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-white/90">{label}</p>
      <p className="mt-4 text-2xl font-extrabold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-[11px] font-medium leading-relaxed text-white/80">{detail}</p>
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

// Remote report synchronization follows the selected accounting period.
// eslint-disable-next-line react-hooks/set-state-in-effect
useEffect(() => { loadReport() }, [loadReport])

  const selectPeriod = (nextPeriod: ReportPeriod) => {
    if (nextPeriod === 'custom' && (!customStart || !customEnd)) {
      const todayValue = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
      setCustomStart(todayValue)
      setCustomEnd(todayValue)
    }
    setPeriod(nextPeriod)
  }

  const exportCsv = () => {
    if (!report) return
    const rows: (string | number)[][] = [
      ['Sales & Liquidation Report'],
      ['Account', report.account.type === 'branch' ? 'Branch' : 'City Distributor'],
      ['Coverage area', report.account.coverage_area],
      ['Period', report.period.label],
      [],
      ['Summary', 'Amount'],
      ['Total revenue', report.liquidation.gross_revenue],
      ['Total product cost', report.liquidation.total_cost],
      ['Total net profit', report.liquidation.net_profit],
      ['Payments collected', report.collections.total],
      [],
      ['Payment method', 'Transactions', 'Amount'],
      ...report.collections.methods.map((method) => [method.label, method.transactions, method.amount]),
      [],
      ['Payment status', 'Orders', 'Amount'],
      ['Paid and confirmed', report.payment_status_summary.paid.orders, report.payment_status_summary.paid.amount],
      ['Awaiting payment / verification', report.payment_status_summary.awaiting.orders, report.payment_status_summary.awaiting.amount],
      ['Cancelled', report.payment_status_summary.cancelled.orders, report.payment_status_summary.cancelled.amount],
      [],
      ['Product', 'Sale type', 'Units', 'Revenue', 'Cost', 'Profit'],
      ...report.products.map((product) => [product.name, product.sale_type === 'member' ? 'Member / Reseller' : 'Non-member / SRP', product.units, product.revenue, product.cost, product.profit]),
      [],
      ['Registration package', 'Registrations', 'Product revenue', 'PIN value used', 'Profit'],
      ...report.packages.map((pkg) => [pkg.name, pkg.registrations, pkg.revenue, pkg.pin_allocation, pkg.profit]),
      [],
      ['Approved inventory corrections', 'Value'],
      ['Approved corrections', report.adjustments.physical_count_events],
      ['Stock added through approved count correction', report.adjustments.units_added],
      ['Stock removed through approved count correction', -report.adjustments.units_removed],
      ['Net units corrected', report.adjustments.net_units],
      ['Inventory cost value added by correction', report.adjustments.value_added],
      ['Inventory cost value removed by correction', -report.adjustments.value_removed],
      ['Net inventory cost increase / decrease', report.adjustments.net_value_change],
    ]
    if (report.deposit_summary) {
      rows.push([], ['Branch deposit summary', 'Amount'], ['Expected cash', report.deposit_summary.expected_cash], ['Deposited', report.deposit_summary.deposited], ['Variance', report.deposit_summary.variance])
    }
    const escape = (value: string | number) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const blob = new Blob([`\uFEFF${rows.map((row) => row.map(escape).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sales-liquidation-${report.period.value}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-5 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6 print:hidden">
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
          <button type="button" onClick={exportCsv} disabled={!report} className="rounded-lg border border-[#0D1B3E]/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#0D1B3E] disabled:opacity-40">Export CSV</button>
          <button type="button" onClick={() => window.print()} disabled={!report} className="rounded-lg bg-[#0D1B3E] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Print / Save PDF</button>
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
          <div className="mb-5 hidden border-b border-[#0D1B3E] pb-3 print:block">
            <h1 className="text-xl font-bold text-[#0D1B3E]">Sales & Liquidation Report</h1>
            <p className="mt-1 text-xs text-gray-600">{report.account.type === 'branch' ? 'Branch' : 'City Distributor'} · {report.account.coverage_area || 'No coverage area'} · {report.period.label}</p>
            <p className="mt-1 text-[10px] text-gray-400">Generated {new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p>
          </div>
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
              detail="Product revenue only; prepaid PIN allocation excluded" tone="revenue" />
            <MetricCard label="Total Cost" value={peso(report.liquidation.total_cost)}
              detail={report.notes.cost_basis} tone="cost" />
            <MetricCard label="Net Profit" value={peso(report.liquidation.net_profit)}
              detail="Gross revenue minus total cost" tone="profit" />
            <MetricCard label="Payments Collected" value={peso(report.collections.total)}
              detail={`Products ${peso(report.liquidation.collected_product_cash)} · Registrations ${peso(report.liquidation.collected_registration_cash)} · Outstanding ${peso(report.liquidation.outstanding_product_sales)}`} tone="cash" />
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
              <p className="text-xl font-bold text-[#1a7a4a] mt-3">{peso(report.registrations.revenue)}</p>
              <p className="mt-1 text-[11px] text-gray-400">Product sales value before cost · PIN excluded</p>
              <div className="grid grid-cols-2 gap-y-2 text-xs mt-4">
                <span className="text-gray-400">Registrations</span><span className="text-right">{report.registrations.registrations}</span>
                <span className="text-gray-400">Total customer payment</span><span className="text-right">{peso(report.registrations.customer_payment)}</span>
                <span className="text-gray-400">Product sales (PIN excluded)</span><span className="text-right font-semibold text-[#1a7a4a]">{peso(report.registrations.revenue)}</span>
                <span className="text-gray-400">Product cost</span><span className="text-right">{peso(report.registrations.acquisition_cost)}</span>
                <span className="text-gray-400">Prepaid PIN value used</span><span className="text-right">{peso(report.registrations.pin_allocation)}</span>
                <span className="text-gray-400">Profit</span><span className="text-right font-semibold text-[#1a7a4a]">{peso(report.registrations.profit)}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-[#0D1B3E]/8 bg-[#010521]">
              <h2 className="text-sm font-bold text-white">Complete Financial Breakdown</h2>
              <p className="text-[11px] text-white/65 mt-1">
                See where the revenue came from, what the products cost, how profit was calculated, and how much cash was received.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
              <div className="p-5 border-b md:border-r xl:border-b-0 border-[#0D1B3E]/8">
                <p className="text-xs font-bold uppercase tracking-wide text-[#1a7a4a]">Where the Revenue Came From</p>
                <p className="mb-4 mt-1 text-[11px] text-gray-400">Income value recorded during this period</p>
                <div className="space-y-2.5 text-xs">
                  <BreakdownLine label="Sales to members (reseller price)" value={peso(report.member_sales.revenue)} />
                  <BreakdownLine label="Sales to non-members (SRP)" value={peso(report.non_member_sales.revenue)} />
                  <BreakdownLine label="Product value from registrations" value={peso(report.registrations.revenue)} />
                  <BreakdownLine label="Total revenue" value={peso(report.liquidation.gross_revenue)}
                    emphasize color="#1a7a4a" />
                </div>
              </div>

              <div className="p-5 border-b xl:border-b-0 xl:border-r border-[#0D1B3E]/8">
                <p className="text-xs font-bold uppercase tracking-wide text-[#dc4444]">Where the Product Cost Came From</p>
                <p className="mb-4 mt-1 text-[11px] text-gray-400">Acquisition cost of products sold or released</p>
                <div className="space-y-2.5 text-xs">
                  <BreakdownLine label="Product cost for member sales" value={peso(report.member_sales.cost)} />
                  <BreakdownLine label="Product cost for non-member sales" value={peso(report.non_member_sales.cost)} />
                  <BreakdownLine label="Cost of products in registrations" value={peso(report.registrations.acquisition_cost)} />
                  <BreakdownLine label="Total product cost" value={peso(report.liquidation.total_cost)}
                    emphasize color="#dc4444" />
                </div>
              </div>

              <div className="p-5 border-b md:border-b-0 md:border-r border-[#0D1B3E]/8">
                <p className="text-xs font-bold uppercase tracking-wide text-[#2563eb]">How Net Profit Was Calculated</p>
                <p className="mb-4 mt-1 text-[11px] text-gray-400">Revenue minus product cost for each source</p>
                <div className="space-y-2.5 text-xs">
                  <BreakdownLine label="Profit from member sales" value={peso(report.member_sales.profit)} />
                  <BreakdownLine label="Profit from non-member sales" value={peso(report.non_member_sales.profit)} />
                  <BreakdownLine label="Profit from registrations" value={peso(report.registrations.profit)} />
                  <BreakdownLine label="Total net profit" value={peso(report.liquidation.net_profit)}
                    emphasize color="#2563eb" />
                </div>
              </div>

              <div className="p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-[#C9A84C]">Cash Received and Still Due</p>
                <p className="mb-4 mt-1 text-[11px] text-gray-400">Actual collections compared with unpaid product sales</p>
                <div className="space-y-2.5 text-xs">
                  <BreakdownLine label="Cash received from product orders" value={peso(report.liquidation.collected_product_cash)} />
                  <BreakdownLine label="Cash received from registrations" value={peso(report.registrations.customer_payment)} />
                  <BreakdownLine label="PIN value paid in advance (used)" value={peso(report.registrations.pin_allocation)} />
                  <BreakdownLine label="Product sales not yet collected" value={peso(report.liquidation.outstanding_product_sales)} />
                  <BreakdownLine label="Total cash received" value={peso(report.liquidation.collected_cash_total)}
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

          <div className="mb-6 grid grid-cols-1 gap-5 xl:grid-cols-3">
            <section className="rounded-2xl border border-[#0D1B3E]/8 bg-white p-5">
              <h2 className="text-sm font-bold text-[#0D1B3E]">How Payments Were Received</h2>
              <p className="mt-1 text-[11px] text-gray-400">Paid transactions grouped by their recorded payment method</p>
              <div className="mt-4 space-y-2.5 text-xs">
                {report.collections.methods.length ? report.collections.methods.map((method) => (
                  <div key={method.method} className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">{method.label} <span className="text-gray-300">({method.transactions})</span></span>
                    <span className="font-semibold text-[#0D1B3E]">{peso(method.amount)}</span>
                  </div>
                )) : <p className="rounded-lg bg-[#f8f9fc] p-3 text-gray-400">No payments were collected in this period.</p>}
                <BreakdownLine label="Total payments collected" value={peso(report.collections.total)} emphasize color="#9a7418" />
              </div>
              <p className="mt-4 rounded-lg bg-[#f8f9fc] p-3 text-[10px] leading-relaxed text-gray-500">
                Cash includes member and non-member walk-in sales plus paid Cash on Pickup orders. GCash and Bank Transfer are shown separately when selected for an online order.
              </p>
              <p className="mt-4 rounded-lg bg-[#fffaf0] p-3 text-[10px] leading-relaxed text-[#7a6428]">{report.collections.note}</p>
            </section>

            <section className="rounded-2xl border border-[#0D1B3E]/8 bg-white p-5">
              <h2 className="text-sm font-bold text-[#0D1B3E]">Payment Status Summary</h2>
              <p className="mt-1 text-[11px] text-gray-400">Payment-first monitoring for orders created in this report period</p>
              <div className="mt-4 space-y-2.5 text-xs">
                <BreakdownLine label={`Paid and confirmed (${report.payment_status_summary.paid.orders})`} value={peso(report.payment_status_summary.paid.amount)} emphasize color="#1a7a4a" />
                <BreakdownLine label={`Awaiting payment / verification (${report.payment_status_summary.awaiting.orders})`} value={peso(report.payment_status_summary.awaiting.amount)} emphasize color="#9a7418" />
                <BreakdownLine label={`Cancelled (${report.payment_status_summary.cancelled.orders})`} value={peso(report.payment_status_summary.cancelled.amount)} />
              </div>
              <p className="mt-4 rounded-lg bg-[#f8f9fc] p-3 text-[10px] leading-relaxed text-gray-500">
                Hiroma does not offer credit sales. Awaiting orders are not collected revenue and must be paid or verified before fulfillment.
              </p>
            </section>

            <section className="rounded-2xl border border-[#0D1B3E]/8 bg-white p-5">
              <h2 className="text-sm font-bold text-[#0D1B3E]">Approved Inventory Corrections</h2>
              <p className="mt-1 text-[11px] text-gray-400">Changes confirmed after a physical stock count</p>
              <div className="mt-4 space-y-2.5 text-xs">
                <BreakdownLine label="Approved corrections" value={String(report.adjustments.physical_count_events)} />
                <BreakdownLine label="Stock added by approved count correction" value={`+${report.adjustments.units_added} units`} color="#1a7a4a" />
                <BreakdownLine label="Stock removed by approved count correction" value={`-${report.adjustments.units_removed} units`} color="#dc4444" />
                <BreakdownLine label="Net units corrected" value={`${report.adjustments.net_units > 0 ? '+' : ''}${report.adjustments.net_units} units`} emphasize color={report.adjustments.net_units < 0 ? '#dc4444' : report.adjustments.net_units > 0 ? '#1a7a4a' : '#0D1B3E'} />
                <div className="my-2 border-t border-gray-100" />
                <BreakdownLine label="Inventory cost value added" value={`+${peso(report.adjustments.value_added)}`} color="#1a7a4a" />
                <BreakdownLine label="Inventory cost value removed" value={`-${peso(report.adjustments.value_removed)}`} color="#dc4444" />
                <BreakdownLine label="Net inventory cost increase / decrease" value={`${report.adjustments.net_value_change > 0 ? '+' : report.adjustments.net_value_change < 0 ? '-' : ''}${peso(Math.abs(report.adjustments.net_value_change))}`} emphasize color={report.adjustments.net_value_change < 0 ? '#dc4444' : report.adjustments.net_value_change > 0 ? '#1a7a4a' : '#0D1B3E'} />
              </div>
              <p className="mt-4 rounded-lg bg-[#f8f9fc] p-3 text-[10px] leading-relaxed text-gray-500">
                These are approved physical-count corrections only—not normal Stock In from deliveries or Stock Out from sales. Positive means the actual count was higher; negative means it was lower than the system stock.
              </p>
              <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-[10px] leading-relaxed text-[#35527a]">
                <span className="font-bold text-[#0D1B3E]">Example only:</span> System stock is 15 bottles, but the approved physical count is 13. The correction is <b>-2 units</b>. If each bottle costs ₱163, the inventory cost value changes by <b>-₱326</b>.
              </div>
            </section>
          </div>

          {report.account.type === 'branch' && report.deposit_summary && (
            <section className="mb-6 overflow-hidden rounded-2xl border border-[#0D1B3E]/10 bg-white">
              <div className="border-b border-[#0D1B3E]/8 bg-[#010521] px-5 py-4 text-white">
                <h2 className="text-sm font-bold">Branch Deposit Status Summary</h2>
                <p className="mt-1 text-[11px] text-white/65">Company-owned Branch only · deposits are independently confirmed and reviewed</p>
              </div>
              <div className="grid grid-cols-2 gap-px bg-[#0D1B3E]/8 sm:grid-cols-4">
                {[
                  ['Expected cash', peso(report.deposit_summary.expected_cash)],
                  ['Amount deposited', peso(report.deposit_summary.deposited)],
                  ['Deposit variance', peso(report.deposit_summary.variance)],
                  ['Pending review', String((report.deposit_summary.statuses.submitted || 0) + (report.deposit_summary.statuses.confirmed || 0) + (report.deposit_summary.statuses.needs_explanation || 0))],
                ].map(([label, value]) => <div key={label} className="bg-white p-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p><p className="mt-1 text-lg font-bold text-[#0D1B3E]">{value}</p></div>)}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[#0D1B3E]/8 px-5 py-3 text-[11px] text-gray-500">
                <span>Submitted: <b>{report.deposit_summary.statuses.submitted || 0}</b></span>
                <span>Branch confirmed: <b>{report.deposit_summary.statuses.confirmed || 0}</b></span>
                <span>Area Manager verified: <b className="text-green-700">{report.deposit_summary.statuses.verified || 0}</b></span>
                <span>Needs explanation: <b className="text-amber-700">{report.deposit_summary.statuses.needs_explanation || 0}</b></span>
                <span>Rejected: <b className="text-red-600">{report.deposit_summary.statuses.rejected || 0}</b></span>
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-x-auto">
              <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
                <h2 className="text-sm font-bold text-[#0D1B3E]">Product Sales Breakdown</h2>
              </div>
              <table className="w-full min-w-[600px] text-xs">
                <thead className="bg-[#F0F2F8] text-gray-400">
                  <tr>{['Product', 'Sale Type', 'Units', 'Revenue', 'Cost', 'Profit'].map((heading) =>
                    <th key={heading} className="text-left font-medium px-4 py-3">{heading}</th>)}</tr>
                </thead>
                <tbody>
                  {report.products.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-gray-400 py-10">No delivered product sales.</td></tr>
                  ) : report.products.map((row) => (
                    <tr key={`${row.id}:${row.sale_type}`} className="border-b border-[#0D1B3E]/5">
                      <td className="px-4 py-3 font-medium text-[#0D1B3E]">{row.name}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${row.sale_type === 'member' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                          {row.sale_type === 'member' ? 'Member / Reseller' : 'Non-member / SRP'}
                        </span>
                      </td>
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
          {report.account.type === 'branch' && <div className="print:hidden"><DepositReconciliationPanel /></div>}
        </>
      )}
    </div>
  )
}
