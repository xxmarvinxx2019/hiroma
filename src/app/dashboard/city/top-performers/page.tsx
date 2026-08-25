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

type PerformancePeriod = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time' | 'custom'

const periods: { value: PerformancePeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'last_week', label: 'Last Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_quarter', label: 'This Quarter' },
  { value: 'this_year', label: 'This Year' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
]

interface PerformanceSummary { total_credited_income: number; earning_resellers: number; highest_income: number; average_income: number }
interface EarningEntry { id: string; type_label: string; amount: number; points: number | null; created_at: string; source_name: string | null; source_username: string | null }

function EarningsDetailsModal({ performer, period, from, to, onClose }: { performer: Performer; period: PerformancePeriod; from: string; to: string; onClose: () => void }) {
  const [entries, setEntries] = useState<EarningEntry[]>([])
  const [meta, setMeta] = useState({ total: 0, shown: 0, capped: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams({ period, ...(period === 'custom' ? { from, to } : {}) })
    fetch(`/api/city/top-performers/${encodeURIComponent(performer.id)}?${params}`, { credentials: 'same-origin' })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load details.'); return data })
      .then((data) => { setEntries(data.entries || []); setMeta(data.meta || { total: 0, shown: 0, capped: false }) })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Unable to load details.'))
      .finally(() => setLoading(false))
  }, [performer.id, period, from, to])

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4" role="dialog" aria-modal="true" aria-label={`Earnings details for ${performer.full_name}`}>
    <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between bg-[#010521] px-6 py-4"><div><h2 className="font-bold text-white">Earnings Details</h2><p className="mt-0.5 text-xs text-white/60">{performer.full_name} · @{performer.username}</p></div><button onClick={onClose} aria-label="Close earnings details" className="text-xl text-white/60 hover:text-white">✕</button></div>
      <div className="max-h-[calc(90vh-72px)] overflow-y-auto p-5">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[
          ['Direct', performer.direct_referral], ['Package Binary', performer.binary_commission], ['Product Binary', performer.product_binary], ['Total', performer.total_income],
        ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-[#F4F6FA] p-3"><p className="text-[10px] font-bold uppercase text-gray-400">{label}</p><p className="mt-1 font-extrabold text-[#0D1B3E]">{formatPeso(Number(value))}</p></div>)}</div>
        {loading ? <p className="py-10 text-center text-sm text-gray-400">Loading commission entries...</p> : error ? <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : entries.length === 0 ? <p className="py-10 text-center text-sm text-gray-400">No commission entries in this period.</p> : <div className="space-y-2">{entries.map((entry) => <div key={entry.id} className="flex flex-col justify-between gap-2 rounded-xl border border-[#0D1B3E]/10 p-3 sm:flex-row sm:items-center"><div><p className="text-sm font-bold text-[#0D1B3E]">{entry.type_label}</p><p className="text-xs text-gray-500">{new Date(entry.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}{entry.source_name ? ` · From ${entry.source_name} (@${entry.source_username})` : ''}</p></div><div className="text-left sm:text-right"><p className="font-extrabold text-[#187443]">{formatPeso(entry.amount)}</p>{entry.points != null && <p className="text-xs text-gray-400">{entry.points.toLocaleString()} points</p>}</div></div>)}</div>}
        {meta.capped && <p className="mt-3 text-xs text-[#9a6f1e]">Showing the latest {meta.shown} of {meta.total.toLocaleString()} entries for this period.</p>}
      </div>
    </div>
  </div>
}

const formatPeso = (value: number) =>
  `\u20B1${Number(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export default function CityTopPerformersPage() {
  const [limit, setLimit] = useState(10)
  const [period, setPeriod] = useState<PerformancePeriod>('this_week')
  const [customFrom, setCustomFrom] = useState(new Date().toISOString().slice(0, 10))
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10))
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [performers, setPerformers] = useState<Performer[]>([])
  const [summary, setSummary] = useState<PerformanceSummary>({ total_credited_income: 0, earning_resellers: 0, highest_income: 0, average_income: 0 })
  const [selectedPerformer, setSelectedPerformer] = useState<Performer | null>(null)
  const [accountType, setAccountType] = useState('city')
  const [coverageArea, setCoverageArea] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadPerformers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: String(limit), period, ...(search ? { search } : {}), ...(period === 'custom' ? { from: customFrom, to: customTo } : {}) })
      const response = await fetch(`/api/city/top-performers?${params}`, {
        credentials: 'same-origin',
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load reseller rankings.')
      setPerformers(data.performers || [])
      setSummary(data.summary || { total_credited_income: 0, earning_resellers: 0, highest_income: 0, average_income: 0 })
      setAccountType(data.account_type || 'city')
      setCoverageArea(data.coverage_area || '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load reseller rankings.')
      setPerformers([])
      setSummary({ total_credited_income: 0, earning_resellers: 0, highest_income: 0, average_income: 0 })
    } finally {
      setLoading(false)
    }
  }, [limit, period, search, customFrom, customTo])

  useEffect(() => { const timer = setTimeout(() => setSearch(searchInput.trim()), 350); return () => clearTimeout(timer) }, [searchInput])

  useEffect(() => {
    loadPerformers()
  }, [loadPerformers])

  const highestIncome = performers[0]?.total_income || 1
  const ownerLabel = accountType === 'branch' ? 'Branch' : 'City Distributor'

  return (
    <div className="p-5 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B3E]">Top Performing Resellers by Credited Income</h1>
          <p className="text-sm text-gray-400 mt-1">
            Ranks active resellers assigned to this {ownerLabel}{coverageArea ? ` \u00B7 ${coverageArea}` : ''} using commissions actually credited within the selected period—not product sales, registrations, team size, or unconverted points.
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

      {period === 'custom' && <div className="mb-5 flex flex-col gap-3 rounded-xl border border-[#C9A84C]/25 bg-white p-4 sm:flex-row sm:items-end"><label className="text-xs text-gray-500"><span className="mb-1 block">From</span><input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} className="w-full rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-sm" /></label><label className="text-xs text-gray-500"><span className="mb-1 block">To</span><input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} className="w-full rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-sm" /></label></div>}

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
        { label: 'Total Credited Income', value: formatPeso(summary.total_credited_income), color: '#0D1B3E' },
        { label: 'Earning Resellers', value: summary.earning_resellers.toLocaleString(), color: '#9a6f1e' },
        { label: 'Highest Income', value: formatPeso(summary.highest_income), color: '#187443' },
        { label: 'Average per Earner', value: formatPeso(summary.average_income), color: '#2d64dc' },
      ].map((card) => <div key={card.label} className="rounded-xl p-4 text-white shadow-sm" style={{ backgroundColor: card.color }}><p className="text-xs font-bold uppercase text-white/90">{card.label}</p><p className="mt-2 text-xl font-extrabold" style={{ textShadow: '0 2px 3px rgba(0,0,0,.35)' }}>{card.value}</p></div>)}</div>

      <div className="bg-[#fef9ee] border border-[#C9A84C]/30 rounded-xl px-4 py-3 mb-5">
        <p className="text-xs text-[#7a6428]">
          Rankings use credited reseller income: direct referral, package binary, product binary, and other applicable commissions.
          A reseller moves to the new location&apos;s ranking when their official City/Branch assignment changes.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-x-auto">
        <div className="border-b border-[#0D1B3E]/8 p-3"><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search ranked reseller by name or username..." className="w-full rounded-xl border border-[#0D1B3E]/10 bg-[#F8F9FC] px-4 py-2.5 text-sm outline-none focus:border-[#C9A84C]" /></div>
        <div className="grid grid-cols-[60px_1.2fr_110px_300px_140px_130px] min-w-[1030px] px-5 py-3 bg-[#F0F2F8]">
          {['Rank', 'Reseller', 'Package', 'Income Breakdown', 'Total Income', 'Action'].map((heading) => (
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
              className="grid grid-cols-[60px_1.2fr_110px_300px_140px_130px] min-w-[1030px] px-5 py-4 border-b border-[#0D1B3E]/5 items-center hover:bg-[#F8F9FC]">
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
              <button onClick={() => setSelectedPerformer(performer)} className="rounded-lg border border-[#C9A84C] bg-[#C9A84C] px-3 py-2 text-xs font-bold text-[#0D1B3E] hover:bg-[#E8C96A]">View Details</button>
            </div>
          )
        })}
      </div>
      {selectedPerformer && <EarningsDetailsModal performer={selectedPerformer} period={period} from={customFrom} to={customTo} onClose={() => setSelectedPerformer(null)} />}
    </div>
  )
}
