'use client'

import { useCallback, useEffect, useState } from 'react'

type PartnerType = 'all' | 'regional' | 'provincial' | 'city' | 'branch' | 'reseller'
type PerformancePeriod = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time'

interface Performer {
  id: string
  rank: number
  full_name: string
  username: string
  partner_type: Exclude<PartnerType, 'all'>
  location: string
  performance_value: number
  activity_count: number
  product_revenue: number
  registration_revenue: number
  product_sales: number
  registration_sales: number
  direct_referral: number
  binary_commission: number
  product_binary: number
  other_income: number
  metric_basis: string
}

const partnerTypes: { value: PartnerType; label: string }[] = [
  { value: 'all', label: 'All Partners' },
  { value: 'regional', label: 'Regional' },
  { value: 'provincial', label: 'Provincial' },
  { value: 'city', label: 'City' },
  { value: 'branch', label: 'Hiroma Branch' },
  { value: 'reseller', label: 'Reseller' },
]

const periods: { value: PerformancePeriod; label: string }[] = [
  { value: 'this_week', label: 'This Week' },
  { value: 'last_week', label: 'Last Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
]

const formatPeso = (value: number) =>
  `₱${Number(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export default function AdminTopPerformersPage() {
  const [type, setType] = useState<PartnerType>('all')
  const [limit, setLimit] = useState(10)
  const [period, setPeriod] = useState<PerformancePeriod>('this_week')
  const [performers, setPerformers] = useState<Performer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialType = params.get('type') as PartnerType | null
    if (initialType && partnerTypes.some((option) => option.value === initialType)) {
      setType(initialType)
    }
  }, [])

  const loadPerformers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ type, limit: String(limit), period })
      const response = await fetch(`/api/admin/top-performers?${params}`, {
        credentials: 'same-origin',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load top-performing partners.')
      setPerformers(data.performers || [])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load top-performing partners.')
      setPerformers([])
    } finally {
      setLoading(false)
    }
  }, [type, limit, period])

  useEffect(() => {
    loadPerformers()
  }, [loadPerformers])

  const highestValue = performers[0]?.performance_value || 1

  return (
    <div className="p-5 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#0D1B3E]">Top Performing Partners</h1>
        <p className="text-sm text-gray-400 mt-1">
          Ranked by actual downstream sales for distributors and credited commission income for resellers.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-4 mb-5">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1.5">Partner type</label>
            <select value={type} onChange={(event) => setType(event.target.value as PartnerType)}
              className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2.5 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
              {partnerTypes.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="w-full md:w-52">
            <label className="block text-xs text-gray-400 mb-1.5">Performance period</label>
            <select value={period} onChange={(event) => setPeriod(event.target.value as PerformancePeriod)}
              className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2.5 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
              {periods.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="w-full md:w-44">
            <label className="block text-xs text-gray-400 mb-1.5">Show ranking</label>
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}
              className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2.5 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
              {[5, 10, 20, 30].map((value) => (
                <option key={value} value={value}>Top {value}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          Inventory purchases and internal stock transfers never increase a partner&apos;s ranking.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-x-auto">
        <div className="grid grid-cols-[60px_1.2fr_110px_160px_280px_180px] min-w-[1050px] px-5 py-3 bg-[#F0F2F8]">
          {['Rank', 'Partner', 'Type', 'Location', 'Performance Details', 'Value'].map((heading) => (
            <p key={heading} className="text-xs uppercase tracking-wide text-gray-400 font-medium">{heading}</p>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-sm text-gray-400 py-12">Loading rankings…</p>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-sm text-[#a03030]">{error}</p>
            <button onClick={loadPerformers} className="text-xs text-[#C9A84C] hover:underline mt-2">Retry</button>
          </div>
        ) : performers.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-12">No completed sales found for this partner type.</p>
        ) : performers.map((performer) => {
          const percentage = Math.max(2, Math.round((performer.performance_value / highestValue) * 100))
          const isReseller = performer.partner_type === 'reseller'
          return (
            <div key={performer.id}
              className="grid grid-cols-[60px_1.2fr_110px_160px_280px_180px] min-w-[1050px] px-5 py-4 border-b border-[#0D1B3E]/5 items-center hover:bg-[#F8F9FC]">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                performer.rank === 1 ? 'bg-[#C9A84C] text-[#0D1B3E]' : 'bg-[#F0F2F8] text-gray-500'
              }`}>{performer.rank}</div>
              <div className="min-w-0 pr-4">
                <p className="text-sm font-semibold text-[#0D1B3E] truncate">{performer.full_name}</p>
                <p className="text-[11px] text-gray-400">@{performer.username}</p>
                <div className="w-full max-w-xs h-1.5 bg-[#F0F2F8] rounded-full overflow-hidden mt-2">
                  <div className="h-full bg-[#C9A84C] rounded-full" style={{ width: `${percentage}%` }} />
                </div>
              </div>
              <span className="capitalize text-xs font-medium text-[#0D1B3E]">{performer.partner_type}</span>
              <p className="text-xs text-gray-500 truncate pr-4">{performer.location}</p>
              <div>
                <p className="text-sm font-semibold text-[#0D1B3E]">
                  {isReseller ? `${performer.activity_count} commissions` : `${performer.activity_count} sales`}
                </p>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  {isReseller
                    ? `Direct ${formatPeso(performer.direct_referral)} · Binary ${formatPeso(performer.binary_commission)} · Product ${formatPeso(performer.product_binary)}`
                    : `${performer.product_sales} product · ${performer.registration_sales} registrations`}
                </p>
              </div>
              <div>
                <p className="text-sm font-bold text-[#1a7a4a]">{formatPeso(performer.performance_value)}</p>
                <p className="text-[9px] text-gray-400 mt-0.5">{performer.metric_basis}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
