'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface Summary {
  total_points:        number
  points_in_php:       number
  php_value_per_point: number
  points_reset_at:     string | null
  next_reset:          string | null
  reset_days:          number
  all_time_points:     number
  all_time_amount:     number
  package_name:        string | null
}

interface PointLog {
  id:          string
  points:      number | null
  amount:      number
  created_at:  string
  source_user: { full_name: string; username: string } | null
}

const PAGE_SIZE = 15

function fmt(n: number) {
  return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

// ============================================================
// PAGE
// ============================================================

export default function ResellerPointsPage() {
  const [summary, setSummary]     = useState<Summary | null>(null)
  const [logs, setLogs]           = useState<PointLog[]>([])
  const [meta, setMeta]           = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]     = useState(true)
  const [page, setPage]           = useState(1)
  const [runningTotals, setRunningTotals] = useState<number[]>([])

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    fetch(`/api/reseller/points?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.summary)    setSummary(data.summary)
        if (data.point_logs) setLogs(data.point_logs)
        if (data.meta)       setMeta(data.meta)
      })
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => { fetchData() }, [fetchData])

  // Compute running accumulated totals per page
  // Start from all_time_points minus points earned before this page
  useEffect(() => {
    if (!summary || logs.length === 0) return
    // Calculate the total points AFTER this page (older entries)
    const pointsOnThisPage = logs.reduce((s, l) => s + Number(l.points || 0), 0)
    // For page 1: running total starts at all_time total and decreases
    // We compute descending running total per row
    let running = summary.all_time_points
    // Subtract points from pages before this one
    // We don't have exact count but approximate via page offset
    // Simpler: just show cumulative from top of current view
    const totals: number[] = []
    let acc = 0
    for (const log of logs) {
      acc += Number(log.points || 0)
      totals.push(acc)
    }
    setRunningTotals(totals)
  }, [logs, summary])

  const daysLeft = summary?.next_reset ? daysUntil(summary.next_reset) : null

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Pairing Points</h1>
        <p className="text-sm text-gray-400 mt-0.5">Product binary pairing point tracker</p>
      </div>

      {/* How it works banner */}
      <div className="bg-[#0D1B3E]/5 border border-[#0D1B3E]/10 rounded-xl px-4 py-3">
        <p className="text-xs font-medium text-[#0D1B3E] mb-1">How pairing points work</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Every time your downlines on <span className="font-medium text-[#0D1B3E]">both sides</span> buy products, you earn points — and points mean cash! 🎉
          Each pair fired earns you points based on the <span className="font-medium text-[#0D1B3E]">lowest package</span> in the pairing — 1 pair fires for every 2 products sold on each leg. Each point is worth <span className="font-medium text-[#1a7a4a]">₱0.50</span>.
          The more your network sells, the more you earn — up to <span className="font-medium text-[#0D1B3E]">10 pairs daily</span>.
          Points reset every <span className="font-medium text-[#0D1B3E]">{summary?.reset_days || 30} days</span> so keep your team selling! 🚀
        </p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">

          {/* Current points */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: '2px solid #1a7a4a' }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Current Points</p>
            <p className="text-2xl font-semibold text-[#1a7a4a]">{summary.total_points.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">≈ {fmt(summary.points_in_php)}</p>
          </div>

          {/* All time points */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: '2px solid #0D1B3E' }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">All Time Points</p>
            <p className="text-2xl font-semibold text-[#0D1B3E]">{summary.all_time_points.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">≈ {fmt(summary.all_time_amount)}</p>
          </div>

          {/* Reset countdown */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${daysLeft !== null && daysLeft <= 5 ? '#e05252' : '#9a6f1e'}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Reset In</p>
            {daysLeft !== null ? (
              <>
                <p className="text-2xl font-semibold"
                  style={{ color: daysLeft <= 5 ? '#e05252' : '#9a6f1e' }}>
                  {daysLeft}d
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  {summary.next_reset
                    ? new Date(summary.next_reset).toLocaleDateString('en-PH')
                    : '—'}
                </p>
              </>
            ) : (
              <p className="text-sm text-gray-400 mt-2">No reset scheduled</p>
            )}
          </div>
        </div>
      )}

      {/* Reset progress bar */}
      {summary?.points_reset_at && summary.next_reset && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-[#0D1B3E]">Reset Period Progress</p>
            <p className="text-xs text-gray-400">
              {daysLeft !== null ? `${daysLeft} days remaining` : ''}
            </p>
          </div>
          <div className="w-full bg-[#F0F2F8] rounded-full h-2">
            {(() => {
              const totalMs  = summary.reset_days * 24 * 60 * 60 * 1000
              const elapsedMs = Date.now() - new Date(summary.points_reset_at).getTime()
              const pct = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100))
              return (
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    background: pct > 80 ? '#e05252' : '#C9A84C',
                  }}
                />
              )
            })()}
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
            <span>{summary.points_reset_at ? new Date(summary.points_reset_at).toLocaleDateString('en-PH') : ''}</span>
            <span>{summary.next_reset ? new Date(summary.next_reset).toLocaleDateString('en-PH') : ''}</span>
          </div>
        </div>
      )}

      {/* Point logs table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
          <p className="text-sm font-semibold text-[#0D1B3E]">Point History</p>
          <p className="text-xs text-gray-400 mt-0.5">All sponsor pairing point transactions</p>
        </div>

        {/* Header */}
        <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
          {['Source', 'Points', 'Accumulated', 'PHP Value', 'Date'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm">No pairing points earned yet.</p>
            <p className="text-gray-300 text-xs mt-1">
              Points fire when both your left and right legs have product sales. Every 2 products sold on each side = 1 point.
            </p>
          </div>
        ) : (
          logs.map((log, index) => (
            <div key={log.id}
              className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center">

              {/* Source */}
              <div>
                {log.source_user ? (
                  <>
                    <p className="text-xs font-medium text-[#0D1B3E]">Triggered by {log.source_user.full_name}</p>
                    <p className="text-[10px] text-gray-400">@{log.source_user.username} · {log.points || 1} pair{Number(log.points || 1) > 1 ? 's' : ''} fired</p>
                  </>
                ) : (
                  <p className="text-xs text-gray-400">System pair</p>
                )}
              </div>

              {/* Points */}
              <div className="flex items-center gap-1.5">
                <div className="w-5 h-5 rounded-full bg-[#e8f7ef] flex items-center justify-center">
                  <span className="text-[10px] text-[#1a7a4a] font-bold">P</span>
                </div>
                <p className="text-sm font-semibold text-[#1a7a4a]">+{log.points || 0}</p>
              </div>

              {/* Accumulated */}
              <div className="flex items-center gap-1">
                <p className="text-xs font-semibold text-[#C9A84C]">{(runningTotals[index] || 0).toLocaleString()}</p>
                <span className="text-[10px] text-gray-400">pts</span>
              </div>

              {/* PHP value */}
              <p className="text-xs font-medium text-[#0D1B3E]">{fmt(Number(log.amount))}</p>

              {/* Date */}
              <p className="text-xs text-gray-400">
                {new Date(log.created_at).toLocaleDateString('en-PH', {
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
              </p>
            </div>
          ))
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>
    </div>
  )
}