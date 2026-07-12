'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Payout {
  id:                 string
  amount:             number
  status:             'pending' | 'approved' | 'rejected'
  payment_method:     string | null
  payment_reference:  string | null
  transaction_number: string | null
  cutoff_date:        string | null
  notes:              string | null
  requested_at:       string
  processed_at:       string | null
  user:               { id: string; full_name: string; username: string; role: string }
  approver:           { full_name: string } | null
}

const fmt    = (n: number) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })

const STATUS_STYLE: Record<string, string> = {
  pending:  'bg-[#fef9ee] text-[#9a6f1e] border border-[#C9A84C]/30',
  approved: 'bg-[#e8f7ef] text-[#1a7a4a] border border-[#1a7a4a]/20',
  rejected: 'bg-[#fdecea] text-[#a03030] border border-[#a03030]/20',
}

const PAGE_SIZE = 15

export default function AdminPayoutsPage() {
  const [payouts, setPayouts]         = useState<Payout[]>([])
  const [summary, setSummary]         = useState({ pending_count: 0, total_amount: 0 })
  const [meta, setMeta]               = useState({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]         = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [search, setSearch]           = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [cutoffFilter, setCutoffFilter] = useState('')
  const [page, setPage]               = useState(1)
  const [expandedId, setExpandedId]   = useState<string | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [notes, setNotes]             = useState('')
  const [actionTarget, setActionTarget] = useState<{ payout: Payout; action: 'approve' | 'reject' } | null>(null)
  const [resultModal, setResultModal] = useState<{ txNumber: string; amount: number } | null>(null)
  const [cutoffSettings, setCutoffSettings]       = useState('15,31')
  const [cutoffInput, setCutoffInput]             = useState('15,31')
  const [payoutDateMap, setPayoutDateMap]         = useState<Record<string,string>>({'15':'18','31':'3'})
  const [payoutDateMapInput, setPayoutDateMapInput] = useState<Record<string,string>>({'15':'18','31':'3'})
  const [savingSettings, setSavingSettings] = useState(false)
  const [showSettings, setShowSettings]     = useState(false)

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const fetchPayouts = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      status: statusFilter, page: String(page), pageSize: String(PAGE_SIZE),
      ...(search   && { search }),
      ...(cutoffFilter && { cutoff: cutoffFilter }),
    })
    fetch(`/api/admin/payouts?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setPayouts(data.payouts || [])
        setSummary(data.summary || { pending_count: 0, total_amount: 0 })
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
      })
      .finally(() => setLoading(false))
  }, [statusFilter, search, cutoffFilter, page])

  useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.payout_cutoff_days)       { setCutoffSettings(d.payout_cutoff_days); setCutoffInput(d.payout_cutoff_days) }
        if (d.payout_date_map) {
          try {
            const m = JSON.parse(d.payout_date_map)
            setPayoutDateMap(m); setPayoutDateMapInput(m)
          } catch {}
        }
      })
  }, [])

  useEffect(() => { fetchPayouts() }, [fetchPayouts])
  useEffect(() => { setPage(1) }, [statusFilter, search, cutoffFilter])

  const handleSaveSettings = async () => {
    setSavingSettings(true)
    const res = await fetch('/api/admin/settings', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ payout_cutoff_days: cutoffInput, payout_date_map: JSON.stringify(payoutDateMapInput) }),
    })
    const data = await res.json()
    setSavingSettings(false)
    if (data.success) { setCutoffSettings(cutoffInput); setPayoutDateMap(payoutDateMapInput); setShowSettings(false) }
  }

  const handleAction = async () => {
    if (!actionTarget) return
    setProcessingId(actionTarget.payout.id)
    const res = await fetch('/api/admin/payouts', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ payout_id: actionTarget.payout.id, action: actionTarget.action, notes }),
    })
    const data = await res.json()
    setProcessingId(null)
    setActionTarget(null)
    setNotes('')
    if (data.success) {
      if (actionTarget.action === 'approve' && data.transaction_number) {
        setResultModal({ txNumber: data.transaction_number, amount: Number(actionTarget.payout.amount) })
      }
      fetchPayouts()
    }
  }

  return (
    <div className="max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Payout Requests</h1>
          <p className="text-sm text-gray-400 mt-0.5">Review and process reseller withdrawal requests</p>
        </div>
        <button onClick={() => setShowSettings(!showSettings)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-[#0D1B3E]/10 hover:border-[#C9A84C] text-sm text-[#0D1B3E] transition-colors">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          Cutoff Settings
        </button>
      </div>

      {/* Cutoff Settings Panel */}
      {showSettings && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4 mb-5">
          <p className="text-sm font-semibold text-[#0D1B3E] mb-1">Payout Cutoff Days</p>
          <p className="text-xs text-gray-400 mb-3">
            Enter day numbers separated by commas. Use <span className="font-mono font-medium">31</span> for last day of month.
            <br/>Current: <span className="font-medium text-[#0D1B3E]">{cutoffSettings.split(',').map((d) => d === '31' ? 'Last day' : `${d}th`).join(' & ')} of every month</span>
          </p>
          <div className="flex gap-2 items-center">
            <input
              value={cutoffInput}
              onChange={(e) => setCutoffInput(e.target.value)}
              placeholder="e.g. 15,31"
              className="flex-1 border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm font-mono text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
            />
            <button onClick={handleSaveSettings} disabled={savingSettings}
              className="px-4 py-2 rounded-lg bg-[#0D1B3E] text-white text-sm font-medium hover:bg-[#162850] disabled:opacity-50 whitespace-nowrap">
              {savingSettings ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => { setCutoffInput(cutoffSettings); setShowSettings(false) }}
              className="px-4 py-2 rounded-lg border border-[#0D1B3E]/15 text-sm text-gray-500 hover:bg-gray-50">
              Cancel
            </button>
          </div>
          {/* Per-cutoff payout dates */}
          <div className="mt-4 pt-3 border-t border-[#0D1B3E]/8">
            <p className="text-xs font-medium text-[#0D1B3E] mb-1">Payout Date per Cutoff Period</p>
            <p className="text-[10px] text-gray-400 mb-3">Set the day of the month when payout is released for each cutoff. Use day numbers (e.g. 18 = 18th, 3 = 3rd of next month if after cutoff day).</p>
            <div className="space-y-2">
              {cutoffInput.split(',').map((c) => {
                const key   = c.trim()
                const label = key === '31' ? 'Last day of month' : `${key}th of month`
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-36">Cutoff: <span className="font-medium text-[#0D1B3E]">{label}</span></span>
                    <span className="text-xs text-gray-400">→ Payout on</span>
                    <input
                      type="number" min={1} max={31}
                      value={payoutDateMapInput[key] || ''}
                      onChange={(e) => setPayoutDateMapInput((m) => ({ ...m, [key]: e.target.value }))}
                      placeholder="day"
                      className="w-16 border border-[#0D1B3E]/15 rounded-lg px-2 py-1.5 text-sm font-mono text-[#0D1B3E] outline-none focus:border-[#C9A84C] text-center"
                    />
                    <span className="text-xs text-gray-400">of the month</span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex gap-2 mt-2 flex-wrap">
            {[['15,31', '15th & Last day'], ['10,25', '10th & 25th'], ['1,15', '1st & 15th'], ['30', 'Monthly (30th)']].map(([val, label]) => (
              <button key={val} onClick={() => setCutoffInput(val)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${cutoffInput === val ? 'bg-[#0D1B3E] text-white border-[#0D1B3E]' : 'border-[#0D1B3E]/15 text-gray-500 hover:border-[#0D1B3E]/30'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Pending Requests', value: String(summary.pending_count), color: '#C9A84C', sub: 'Awaiting approval' },
          { label: 'Total Amount',     value: fmt(summary.total_amount),     color: '#0D1B3E', sub: 'Filtered results' },
          { label: 'Cutoff Periods',   value: cutoffSettings.split(',').map((d) => d.trim() === '31' ? 'EOM' : `${d}th`).join(' & '), color: '#1a7a4a', sub: 'Every month' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.color}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-xl font-semibold" style={{ color: s.color }}>{s.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, username or transaction no..."
            className="flex-1 min-w-[200px] bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />

          {/* Cutoff date filter */}
          <input type="date" value={cutoffFilter} onChange={(e) => setCutoffFilter(e.target.value)}
            className="bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
            title="Filter by cutoff date" />
          {cutoffFilter && (
            <button onClick={() => setCutoffFilter('')} className="text-xs text-gray-400 hover:text-[#a03030]">✕ Clear</button>
          )}

          {/* Status filter */}
          <div className="flex gap-1">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  statusFilter === s ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-500 hover:text-[#0D1B3E]'
                }`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-6 px-4 py-2 bg-[#F0F2F8]">
          {['Reseller', 'Amount', 'Method', 'Cutoff', 'Status', 'Actions'].map((h) => (
            <p key={h} className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-5 h-5 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : payouts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">No payout requests found.</p>
          </div>
        ) : payouts.map((payout) => (
          <div key={payout.id}>
            <div
              className="grid grid-cols-6 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F8F9FC] transition-colors items-center cursor-pointer"
              onClick={() => setExpandedId(expandedId === payout.id ? null : payout.id)}>

              {/* Reseller */}
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{payout.user.full_name}</p>
                <p className="text-[10px] text-gray-400">@{payout.user.username}</p>
              </div>

              {/* Amount */}
              <p className="text-sm font-semibold text-[#0D1B3E]">{fmt(Number(payout.amount))}</p>

              {/* Method */}
              <div>
                <p className="text-xs text-[#0D1B3E] capitalize">{payout.payment_method || '—'}</p>
                {payout.payment_reference && (
                  <p className="text-[10px] text-gray-400 font-mono">{payout.payment_reference}</p>
                )}
              </div>

              {/* Cutoff */}
              <p className="text-xs text-gray-500">
                {payout.cutoff_date ? fmtDate(payout.cutoff_date) : '—'}
              </p>

              {/* Status */}
              <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize w-fit font-medium ${STATUS_STYLE[payout.status]}`}>
                {payout.status}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                <Link href={`/dashboard/admin/payouts/${payout.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="w-7 h-7 rounded-lg bg-[#eef0f8] hover:bg-[#C9A84C] flex items-center justify-center transition-colors group"
                  title="View details">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0D1B3E] group-hover:text-white">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                </Link>
                {payout.status === 'pending' && (
                  <>
                    <button
                      disabled={processingId === payout.id}
                      onClick={() => setActionTarget({ payout, action: 'approve' })}
                      className="w-7 h-7 rounded-lg bg-[#e8f7ef] hover:bg-[#1a7a4a] flex items-center justify-center transition-colors group disabled:opacity-50"
                      title="Approve">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#1a7a4a] group-hover:text-white">
                        <path d="M5 13l4 4L19 7"/>
                      </svg>
                    </button>
                    <button
                      disabled={processingId === payout.id}
                      onClick={() => setActionTarget({ payout, action: 'reject' })}
                      className="w-7 h-7 rounded-lg bg-[#fdecea] hover:bg-[#a03030] flex items-center justify-center transition-colors group disabled:opacity-50"
                      title="Reject">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#a03030] group-hover:text-white">
                        <path d="M18 6L6 18M6 6l12 12"/>
                      </svg>
                    </button>
                  </>
                )}
                {payout.transaction_number && (
                  <span className="text-[9px] font-mono text-[#1a7a4a] bg-[#e8f7ef] px-1.5 py-0.5 rounded">
                    {payout.transaction_number}
                  </span>
                )}
              </div>
            </div>

            {/* Expanded detail */}
            {expandedId === payout.id && (
              <div className="px-4 py-3 bg-[#F8F9FC] border-b border-[#0D1B3E]/8 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Transaction No.</p>
                  <p className="font-mono font-semibold text-[#0D1B3E]">{payout.transaction_number || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Requested</p>
                  <p className="text-[#0D1B3E]">{fmtDate(payout.requested_at)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Processed</p>
                  <p className="text-[#0D1B3E]">{payout.processed_at ? fmtDate(payout.processed_at) : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Approved by</p>
                  <p className="text-[#0D1B3E]">{payout.approver?.full_name || '—'}</p>
                </div>
                {payout.notes && (
                  <div className="col-span-2 md:col-span-4">
                    <p className="text-[10px] text-gray-400 mb-0.5">Notes</p>
                    <p className="text-[#0D1B3E]">{payout.notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Pagination */}
        {meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#0D1B3E]/8">
            <p className="text-xs text-gray-400">{meta.total} requests</p>
            <div className="flex gap-1">
              <button disabled={page === 1} onClick={() => setPage(page - 1)}
                className="w-7 h-7 rounded-lg bg-[#F0F2F8] text-gray-500 text-xs hover:bg-[#0D1B3E] hover:text-white disabled:opacity-30 transition-colors">‹</button>
              <span className="w-7 h-7 flex items-center justify-center text-xs text-[#0D1B3E] font-medium">{page}</span>
              <button disabled={page === meta.totalPages} onClick={() => setPage(page + 1)}
                className="w-7 h-7 rounded-lg bg-[#F0F2F8] text-gray-500 text-xs hover:bg-[#0D1B3E] hover:text-white disabled:opacity-30 transition-colors">›</button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm action modal */}
      {actionTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${
              actionTarget.action === 'approve' ? 'bg-[#e8f7ef]' : 'bg-[#fdecea]'
            }`}>
              {actionTarget.action === 'approve' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a7a4a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a03030" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              )}
            </div>
            <h2 className="text-base font-semibold text-[#0D1B3E] text-center mb-1 capitalize">
              {actionTarget.action} Payout?
            </h2>
            <p className="text-xs text-gray-400 text-center mb-4">
              {fmt(Number(actionTarget.payout.amount))} for <span className="font-medium text-[#0D1B3E]">{actionTarget.payout.user.full_name}</span>
              {actionTarget.action === 'approve' && (
                <span className="block mt-1 text-[#1a7a4a]">A transaction number will be generated automatically.</span>
              )}
            </p>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note (optional)..."
              rows={2}
              className="w-full border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] mb-4 resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { setActionTarget(null); setNotes('') }}
                className="flex-1 py-2 rounded-lg border border-[#0D1B3E]/15 text-sm text-gray-500 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleAction} disabled={!!processingId}
                className={`flex-1 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 ${
                  actionTarget.action === 'approve' ? 'bg-[#1a7a4a] hover:bg-[#155f3a]' : 'bg-[#a03030] hover:bg-[#7e2424]'
                }`}>
                {processingId ? 'Processing...' : actionTarget.action === 'approve' ? 'Approve' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approval result modal with transaction number */}
      {resultModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-[#e8f7ef] rounded-full flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1a7a4a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <h2 className="text-base font-semibold text-[#0D1B3E] mb-1">Payout Approved!</h2>
            <p className="text-xs text-gray-400 mb-1">Amount: <span className="font-semibold text-[#0D1B3E]">{fmt(resultModal.amount)}</span></p>
            <p className="text-xs text-gray-400 mb-4">Transaction Number</p>
            <div className="bg-[#F0F2F8] rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3">
              <span className="font-mono text-sm font-bold text-[#0D1B3E] tracking-wider">{resultModal.txNumber}</span>
              <button onClick={() => navigator.clipboard.writeText(resultModal.txNumber)}
                className="text-[10px] text-[#C9A84C] hover:underline whitespace-nowrap">Copy</button>
            </div>
            <p className="text-[10px] text-gray-400 mb-4">Share this number with the reseller for reference</p>
            <button onClick={() => setResultModal(null)}
              className="w-full py-2 rounded-lg bg-[#0D1B3E] text-white text-sm font-medium hover:bg-[#162850]">
              Done
            </button>
          </div>
        </div>
      )}

    </div>
  )
}