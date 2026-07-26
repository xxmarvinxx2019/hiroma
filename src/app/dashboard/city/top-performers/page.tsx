'use client'

import { useCallback, useEffect, useState } from 'react'

interface Performer {
  id: string
  rank: number
  full_name: string
  username: string
  package_name: string
  direct_referral: number
  binary_commission: number
  product_binary: number
  other_income: number
  commission_count: number
  total_income: number
}

type PerformancePeriod = 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time'

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
  `\u20B1${Number(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export default function CityTopPerformersPage() {
  const [limit, setLimit] = useState(10)
  const [period, setPeriod] = useState<PerformancePeriod>('this_week')
  const [performers, setPerformers] = useState<Performer[]>([])
  const [accountType, setAccountType] = useState('city')
  const [coverageArea, setCoverageArea] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadPerformers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: String(limit), period })
      const response = await fetch(`/api/city/top-performers?${params}`, {
        credentials: 'same-origin',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load reseller rankings.')
      setPerformers(data.performers || [])
      setAccountType(data.account_type || 'city')
      setCoverageArea(data.coverage_area || '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load reseller rankings.')
      setPerformers([])
    } finally {
      setLoading(false)
    }
  }, [limit, period])

  useEffect(() => {
    loadPerformers()
  }, [loadPerformers])

  const highestIncome = performers[0]?.total_income || 1
  const ownerLabel = accountType === 'branch' ? 'Branch' : 'City Distributor'

  return (
    <div className="p-5 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B3E]">Top Performing Resellers</h1>
          <p className="text-sm text-gray-400 mt-1">
            Active resellers currently assigned to this {ownerLabel}{coverageArea ? ` \u00B7 ${coverageArea}` : ''}.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <div className="w-full sm:w-52">
            <label className="block text-xs text-gray-400 mb-1.5">Performance period</label>
            <select value={period} onChange={(event) => setPeriod(event.target.value as PerformancePeriod)}
              className="w-full bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2.5 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
              {periods.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-44">
            <label className="block text-xs text-gray-400 mb-1.5">Show ranking</label>
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}
              className="w-full bg-white border border-[#0D1B3E]/15 rounded-lg px-3 py-2.5 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
              {[5, 10, 20, 30].map((value) => (
                <option key={value} value={value}>Top {value}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-[#fef9ee] border border-[#C9A84C]/30 rounded-xl px-4 py-3 mb-5">
        <p className="text-xs text-[#7a6428]">
          Rankings use credited reseller income: direct referral, package binary, product binary, and other applicable commissions.
          A reseller moves to the new location&apos;s ranking when their official City/Branch assignment changes.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-x-auto">
        <div className="grid grid-cols-[60px_1.2fr_110px_300px_160px] min-w-[900px] px-5 py-3 bg-[#F0F2F8]">
          {['Rank', 'Reseller', 'Package', 'Income Breakdown', 'Total Income'].map((heading) => (
            <p key={heading} className="text-xs uppercase tracking-wide text-gray-400 font-medium">{heading}</p>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-sm text-gray-400 py-12">Loading rankings...</p>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-sm text-[#a03030]">{error}</p>
            <button onClick={loadPerformers} className="text-xs text-[#C9A84C] hover:underline mt-2">Retry</button>
          </div>
        ) : performers.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-12">No credited reseller income found for this location.</p>
        ) : performers.map((performer) => {
          const percentage = Math.max(2, Math.round((performer.total_income / highestIncome) * 100))
          return (
            <div key={performer.id}
              className="grid grid-cols-[60px_1.2fr_110px_300px_160px] min-w-[900px] px-5 py-4 border-b border-[#0D1B3E]/5 items-center hover:bg-[#F8F9FC]">
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
              <p className="text-xs text-[#0D1B3E]">{performer.package_name}</p>
              <div>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Direct {formatPeso(performer.direct_referral)} {'\u00B7'} Binary {formatPeso(performer.binary_commission)}
                </p>
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Product binary {formatPeso(performer.product_binary)} {'\u00B7'} Other {formatPeso(performer.other_income)}
                </p>
                <p className="text-[10px] text-gray-400">{performer.commission_count} credited commissions</p>
              </div>
              <p className="text-sm font-bold text-[#1a7a4a]">{formatPeso(performer.total_income)}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
