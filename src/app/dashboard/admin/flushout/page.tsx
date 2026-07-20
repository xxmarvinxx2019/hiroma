'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

interface FlushoutRecord {
  id:             string
  date:           string
  member:         string
  username:       string
  member_id:      string
  package:        string
  exceeded_pairs: number
  pair_value:     number
  flushout_value: number
  remarks:        string
}

interface PackageBreakdown {
  [pkg: string]: { pairs: number; value: number; color: string }
}

interface PackageConfig {
  name:             string
  daily_pair_limit: number
  pair_value:       number
  limit_type:       string
}

interface Summary {
  total_pairs_today:  number
  total_value_today:  number
  affected_members:   number
  avg_flushout:       number
}

const fmt  = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtS = (n: number) => {
  if (n >= 1000000) return `₱${(n/1000000).toFixed(2)}M`
  if (n >= 1000)    return `₱${(n/1000).toFixed(1)}K`
  return fmt(n)
}

const PKG_COLORS: Record<string, string> = {
  Starter:      '#6366f1',
  Builder:      '#22c55e',
  Entrepreneur: '#8b5cf6',
}
const getColor = (name: string, i: number) => {
  const colors = ['#6366f1', '#22c55e', '#8b5cf6', '#f59e0b', '#e05252', '#0D1B3E']
  return PKG_COLORS[name] || colors[i] || '#9ca3af'
}

function DonutChart({ breakdown, total }: { breakdown: PackageBreakdown; total: number }) {
  const entries = Object.entries(breakdown).filter(([, v]) => v.pairs > 0)
  if (entries.length === 0 || total === 0) return (
    <div className="w-40 h-40 rounded-full border-8 border-[#f1f5f9] flex items-center justify-center">
      <p className="text-xs text-gray-400">No data</p>
    </div>
  )

  const radius = 60, cx = 70, cy = 70
  const circumference = 2 * Math.PI * radius
  let offset = 0
  const segments: { name: string; pct: number; color: string; dashArray: string; dashOffset: number }[] = []

  for (const [name, data] of entries) {
    const pct = data.pairs / total
    const dash = pct * circumference
    segments.push({
      name, pct,
      color:      data.color,
      dashArray:  `${dash} ${circumference - dash}`,
      dashOffset: -offset,
    })
    offset += dash
  }

  return (
    <div className="relative">
      <svg width="140" height="140" viewBox="0 0 140 140">
        {segments.map((s, i) => (
          <circle key={i} cx={cx} cy={cy} r={radius}
            fill="none" stroke={s.color} strokeWidth="20"
            strokeDasharray={s.dashArray}
            strokeDashoffset={s.dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: 'stroke-dasharray 0.5s ease' }} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" className="text-lg font-bold" style={{ fontSize: 20, fontWeight: 700, fill: '#0D1B3E' }}>{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: 10, fill: '#9ca3af' }}>Total Pairs</text>
      </svg>
    </div>
  )
}

const PAGE_SIZE = 15

export default function AdminFlushoutPage() {
  const [records, setRecords]           = useState<FlushoutRecord[]>([])
  const [summary, setSummary]           = useState<Summary>({ total_pairs_today: 0, total_value_today: 0, affected_members: 0, avg_flushout: 0 })
  const [breakdown, setBreakdown]       = useState<PackageBreakdown>({})
  const [pkgConfig, setPkgConfig]       = useState<PackageConfig[]>([])
  const [pkgNames, setPkgNames]         = useState<string[]>([])
  const [meta, setMeta]                 = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]           = useState(true)
  const [page, setPage]                 = useState(1)
  const [pkgFilter, setPkgFilter]       = useState('all')
  const [search, setSearch]             = useState('')
  const [searchInput, setSearchInput]   = useState('')
  const [dateFrom, setDateFrom]         = useState('2024-01-01')  // show all history by default
  const [dateTo, setDateTo]             = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => { const t = setTimeout(() => setSearch(searchInput), 400); return () => clearTimeout(t) }, [searchInput])
  useEffect(() => { setPage(1) }, [search, pkgFilter, dateFrom, dateTo])

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page), pageSize: String(PAGE_SIZE),
      package: pkgFilter, search, from: dateFrom, to: dateTo,
    })
    fetch(`/api/admin/flushout?${params}`)
      .then(r => r.json())
      .then(d => {
        setRecords(d.records || [])
        setSummary(d.summary || { total_pairs_today: 0, total_value_today: 0, affected_members: 0, avg_flushout: 0 })
        setBreakdown(d.package_breakdown || {})
        setPkgConfig(d.package_config   || [])
        setPkgNames(d.package_names     || [])
        setMeta(d.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
      })
      .finally(() => setLoading(false))
  }, [page, search, pkgFilter, dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  const today = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })

  const exportCSV = () => {
    const headers = ['Date', 'Time', 'Member', 'Member ID', 'Package', 'Exceeded Pairs', 'Pair Value', 'Flushout Value', 'Remarks']
    const rows = records.map(r => [
      new Date(r.date).toLocaleDateString('en-PH'),
      new Date(r.date).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
      r.member, r.member_id, r.package, r.exceeded_pairs, r.pair_value, r.flushout_value, r.remarks,
    ])
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url; a.download = `flushout-${dateFrom}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="w-full space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B3E]">Flushout / Overflow Management</h1>
          <p className="text-xs text-gray-400 mt-0.5">Track overflow pairs that exceed the daily pair limit</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-white border border-[#0D1B3E]/8 rounded-xl px-3 py-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-400">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="text-xs text-[#0D1B3E] outline-none bg-transparent" />
            <span className="text-gray-300 text-xs">—</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="text-xs text-[#0D1B3E] outline-none bg-transparent" />
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Flushout (Period)', value: (summary.total_pairs_today || 0).toLocaleString(), sub: 'Pairs · Exceeded daily limit', icon: '⚡', color: '#6366f1', badge: 'Pairs' },
          { label: 'Total Flushout Value', value: fmtS(summary.total_value_today || 0), sub: 'From all packages', icon: '💼', color: '#1a7a4a' },
          { label: 'Affected Members', value: (summary.affected_members ?? 0).toLocaleString(), sub: 'Members', icon: '👥', color: '#8b5cf6' },
          { label: 'Average Flushout per Member', value: Number(summary.avg_flushout ?? 0).toFixed(2), sub: 'Pairs', icon: '📊', color: '#f59e0b' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 hover:shadow-sm transition-all"
            style={{ borderTop: `2px solid ${s.color}` }}>
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: s.color + '15' }}>{s.icon}</div>
              {s.badge && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: s.color + '15', color: s.color }}>{s.badge}</span>}
            </div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Breakdown + Config */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Flushout by Package */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <p className="text-sm font-bold text-[#0D1B3E] mb-4">Flushout by Package (Period)</p>
          <div className="flex items-start gap-6">
            <DonutChart breakdown={breakdown} total={summary.total_pairs_today} />
            <div className="flex-1">
              <div className="grid grid-cols-3 text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-2 pb-1 border-b border-[#0D1B3E]/5">
                <span>Package</span><span className="text-center">Pairs</span><span className="text-right">Value</span>
              </div>
              {Object.entries(breakdown).length === 0 ? (
                <p className="text-xs text-gray-400 py-4 text-center">No flushout today</p>
              ) : Object.entries(breakdown).map(([name, data], i) => {
                const total = summary.total_pairs_today || 1
                const pct = Math.round((data.pairs / total) * 100)
                return (
                  <div key={name} className="grid grid-cols-3 items-center py-1.5 border-b border-[#0D1B3E]/5">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: data.color }} />
                      <span className="text-xs font-medium text-[#0D1B3E]">{name}</span>
                    </div>
                    <span className="text-xs text-center font-semibold text-[#0D1B3E]">{data.pairs} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                    <span className="text-xs text-right font-bold text-[#1a7a4a]">{fmt(data.value)}</span>
                  </div>
                )
              })}
              {Object.entries(breakdown).length > 0 && (
                <div className="grid grid-cols-3 items-center py-1.5 mt-1">
                  <span className="text-xs font-bold text-[#0D1B3E]">Total</span>
                  <span className="text-xs text-center font-bold text-[#0D1B3E]">{summary.total_pairs_today} <span className="text-gray-400 font-normal">(100%)</span></span>
                  <span className="text-xs text-right font-bold text-[#1a7a4a]">{fmt(summary.total_value_today)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pair Limit Configuration */}
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <p className="text-sm font-bold text-[#0D1B3E] mb-4">Pair Limit Configuration</p>
          <div className="grid grid-cols-4 px-2 py-2 bg-[#f8f9fc] rounded-lg mb-2">
            {['Package', 'Daily Pair Limit', 'Pair Value', 'Limit Type'].map(h => (
              <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{h}</p>
            ))}
          </div>
          {pkgConfig.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">No packages configured</p>
          ) : pkgConfig.map((pkg, i) => (
            <div key={pkg.name} className="grid grid-cols-4 px-2 py-3 border-b border-[#0D1B3E]/5 items-center">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: getColor(pkg.name, i) }} />
                <p className="text-xs font-semibold text-[#0D1B3E]">{pkg.name}</p>
              </div>
              <p className="text-xs font-semibold text-[#0D1B3E]">{pkg.daily_pair_limit} Pairs</p>
              <p className="text-xs font-bold text-[#1a7a4a]">{fmt(pkg.pair_value)}</p>
              <span className="text-[10px] bg-[#eef0f8] text-[#0D1B3E] px-2 py-0.5 rounded-full font-medium w-fit">{pkg.limit_type}</span>
            </div>
          ))}
          <div className="mt-3 bg-[#fffbeb] border border-[#f59e0b]/20 rounded-xl px-3 py-2">
            <p className="text-[10px] text-[#9a6f1e]">ℹ️ Pairs exceeding the daily limit will be recorded as Flushout / Overflow.</p>
          </div>
        </div>
      </div>

      {/* Flushout Records */}
      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#0D1B3E]/8">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-[#0D1B3E]">Flushout Records</p>
            {/* Package filter tabs */}
            <div className="flex gap-1 bg-[#f8f9fc] rounded-lg p-0.5">
              {['all', ...pkgNames].map(pkg => (
                <button key={pkg} onClick={() => setPkgFilter(pkg)}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all capitalize ${pkgFilter === pkg ? 'bg-white shadow-sm text-[#0D1B3E]' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
                  {pkg === 'all' ? 'All Packages' : pkg}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV}
              className="flex items-center gap-2 text-xs bg-[#0D1B3E] text-white px-3 py-2 rounded-lg hover:bg-[#1A2F5E] transition-colors">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export
            </button>
            <div className="flex items-center gap-2 bg-[#f8f9fc] border border-[#0D1B3E]/10 rounded-xl px-3 py-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-gray-300">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input value={searchInput} onChange={e => setSearchInput(e.target.value)}
                placeholder="Search member or transaction..."
                className="text-xs text-[#0D1B3E] outline-none bg-transparent placeholder:text-gray-300 w-48" />
            </div>
          </div>
        </div>

        {/* Table headers */}
        <div className="grid grid-cols-9 px-5 py-2.5 bg-[#f8f9fc] border-b border-[#0D1B3E]/8">
          {['Date','Time','Member','Member ID','Package','Exceeded Pairs','Pair Value','Flushout Value','Remarks'].map(h => (
            <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{h}</p>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col items-center py-16">
            <div className="w-6 h-6 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-gray-400 text-sm">Loading records...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <span className="text-4xl mb-3">⚡</span>
            <p className="text-gray-400 text-sm">No flushout records for this period</p>
            <p className="text-xs text-gray-300 mt-1">All pairs within the daily limit — great!</p>
          </div>
        ) : records.map(r => {
          const color = getColor(r.package, pkgNames.indexOf(r.package))
          return (
            <div key={r.id} className="grid grid-cols-9 px-5 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#f8f9fc] transition-colors items-center">
              <p className="text-xs text-gray-600">{new Date(r.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              <p className="text-xs text-gray-600">{new Date(r.date).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}</p>
              <div>
                <p className="text-xs font-semibold text-[#0D1B3E]">{r.member}</p>
                <p className="text-[9px] text-gray-400">@{r.username}</p>
              </div>
              <p className="text-xs text-gray-500 font-mono">{r.member_id}</p>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold w-fit" style={{ background: color + '18', color }}>
                {r.package}
              </span>
              <p className="text-xs font-bold text-[#e05252]">{r.exceeded_pairs}</p>
              <p className="text-xs font-semibold text-[#0D1B3E]">{fmt(Number(r.pair_value) || 0)}</p>
              <p className="text-xs font-bold text-[#6366f1]">{fmt(Number(r.flushout_value) || 0)}</p>
              <p className="text-xs text-gray-400">{r.remarks}</p>
            </div>
          )
        })}

        <div className="px-5 py-3 border-t border-[#0D1B3E]/5 flex items-center justify-between">
          <p className="text-xs text-gray-400">Showing {((page-1)*PAGE_SIZE)+1} to {Math.min(page*PAGE_SIZE, meta.total)} of {meta.total} entries</p>
          <Pagination meta={meta} onPageChange={setPage} />
        </div>
      </div>

      {/* How Flushout Works */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">⚡</span>
            <p className="text-sm font-bold text-[#0D1B3E]">How Flushout Works</p>
          </div>
          <ol className="space-y-2 text-xs text-gray-500 list-decimal list-inside">
            <li>Each package has a daily maximum of 10 pairs.</li>
            <li>Any pairs beyond the 10 limit will be recorded as Flushout / Overflow.</li>
            <li>Flushout pairs are not paid as commission to the member.</li>
            <li>The value of flushout pairs goes to the company (Hiroma).</li>
          </ol>
        </div>

        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <p className="text-sm font-bold text-[#0D1B3E] mb-3">Pair Value Guide</p>
          <div className="space-y-2">
            {pkgConfig.map((pkg, i) => (
              <div key={pkg.name} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: getColor(pkg.name, i) }} />
                <p className="text-xs text-gray-500">
                  <span className="font-semibold text-[#0D1B3E]">{pkg.name}</span> — {fmt(pkg.pair_value)} per pair
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5">
          <p className="text-sm font-bold text-[#0D1B3E] mb-3">Example</p>
          {pkgConfig[1] ? (
            <div className="text-xs text-gray-500 space-y-1.5">
              <p>If a <span className="font-semibold text-[#0D1B3E]">{pkgConfig[1]?.name}</span> member generates 13 pairs in a day:</p>
              <div className="bg-[#e8f7ef] rounded-lg px-3 py-2 mt-2 space-y-1">
                <p className="text-[#1a7a4a] font-medium">• 10 pairs = Paid as commission</p>
                <p className="text-[#e05252] font-medium">• 3 pairs = Flushout</p>
                <p className="text-[#6366f1] font-medium">• 3 × {fmt(pkgConfig[1]?.pair_value || 0)} = {fmt((pkgConfig[1]?.pair_value || 0) * 3)} goes to Hiroma</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400">No package data yet</p>
          )}
        </div>
      </div>

    </div>
  )
}