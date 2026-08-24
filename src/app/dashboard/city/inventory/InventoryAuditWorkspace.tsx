'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { datePresetOptions, getDateRangePreset, type DateRangePreset } from '@/app/lib/dateRangePresets'

type LedgerRow = {
  id: string; occurred_at: string; event_type: string; direction: 'in' | 'out' | 'neutral'
  product_name: string; quantity: number; unit_cost: number; total_value: number; reference: string
  actor: string; reason: string; balance_before: number | null; balance_after: number | null; source: 'recorded' | 'historical'; source_note: string
}
type AuditSummary = {
  id: string; reference_number: string; status: string; started_by: string; notes: string | null; started_at: string
  submitted_at: string | null; approved_at: string | null; approval_notes: string | null
  totals: { products: number; counted: number; variance_units: number; variance_value: number }
}
type AuditItem = {
  id: string; product_name_snapshot: string; expected_quantity: number; counted_quantity: number | null
  variance_quantity: number | null; unit_cost_snapshot: number; variance_value: number
  damaged_quantity: number; expired_quantity: number; missing_quantity: number; notes: string | null
}
type AuditDetail = AuditSummary & { items: AuditItem[] }
type AuditDialogKind = 'start' | 'submit' | 'cancel' | 'approve' | 'reject'

const money = (value: number) => `₱${Math.abs(Number(value || 0)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const eventLabel = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

export function InventoryMovementLedger() {
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all_time')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [summary, setSummary] = useState({ stock_in_units: 0, stock_out_units: 0, adjustment_units: 0, net_movement_units: 0, total_movement_value: 0, movement_count: 0, pending_approval: 0, latest_approved_audit: null as null | { reference_number: string; approved_at: string } })

  const load = useCallback(async () => {
    setLoading(true); setError('')
    const params = new URLSearchParams({ pageSize: '100', type })
    if (search) params.set('search', search)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    try {
      const response = await fetch(`/api/city/inventory/audit-ledger?${params}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load ledger.')
      setRows(data.rows || []); setSummary(data.summary || {})
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load ledger.') }
    finally { setLoading(false) }
  }, [from, search, to, type])
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer) }, [load])

  const chooseDatePreset = (preset: DateRangePreset) => {
    setDatePreset(preset)
    if (preset === 'custom') {
      if (!from || !to) {
        const range = getDateRangePreset('today')
        setFrom(range.from); setTo(range.to)
      }
      return
    }
    if (preset === 'all_time') { setFrom(''); setTo(''); return }
    const range = getDateRangePreset(preset)
    setFrom(range.from); setTo(range.to)
  }
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        ['Stock In', summary.stock_in_units, '#0D1B3E', 'Received/accepted units'],
        ['Stock Out', summary.stock_out_units, '#0D1B3E', 'Sales and package releases'],
        ['Adjusted Units', summary.adjustment_units, '#0D1B3E', 'Approved count corrections'],
        ['Pending Approval', summary.pending_approval, '#0D1B3E', summary.latest_approved_audit ? `Last: ${summary.latest_approved_audit.reference_number}` : 'No approved audit yet'],
      ].map(([label, value, color, sub]) => <div key={String(label)} className="rounded-xl p-4 text-white shadow-sm" style={{ background: String(color) }}>
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/90">{label}</p><p className="mt-1 text-2xl font-extrabold">{value}</p><p className="mt-1 text-[11px] font-medium text-white/80">{sub}</p>
      </div>)}
    </div>
    <div className="overflow-hidden rounded-2xl border border-[#0D1B3E]/10 bg-white">
      <div className="border-b border-[#0D1B3E]/8 p-4">
        <div className={`grid gap-3 xl:items-end ${datePreset === 'custom' ? 'xl:grid-cols-[minmax(260px,1fr)_170px_150px_150px_150px]' : 'xl:grid-cols-[minmax(260px,1fr)_190px_190px]'}`}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, reference, actor, or reason…" className="min-h-10 flex-1 rounded-lg border border-[#0D1B3E]/10 bg-[#f8f9fc] px-3 text-sm outline-none focus:border-[#C9A84C]" />
          <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#53627e]">Movement type<select value={type} onChange={(event) => setType(event.target.value)} className="min-h-10 rounded-lg border border-[#0D1B3E]/10 bg-white px-3 text-xs font-semibold normal-case"><option value="all">All movements</option><option value="in">All stock in</option><option value="out">All stock out</option><option value="reseller_repeat_order">Reseller repeat orders</option><option value="non_member_srp_sale">Non-member / SRP sales</option><option value="registration_package_release">New reseller registrations</option><option value="upgrade_package_release">Package upgrades</option><option value="audit">Physical audits</option></select></label>
          <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#53627e]">Date range<select value={datePreset} onChange={(event) => chooseDatePreset(event.target.value as DateRangePreset)} className="min-h-10 rounded-lg border border-[#0D1B3E]/10 bg-white px-3 text-xs font-semibold normal-case">{datePresetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          {datePreset === 'custom' && <><label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#53627e]">From date<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className="min-h-10 rounded-lg border border-[#0D1B3E]/10 px-3 text-xs font-medium normal-case" /></label>
          <label className="grid gap-1 text-[11px] font-bold uppercase tracking-wide text-[#53627e]">To date<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className="min-h-10 rounded-lg border border-[#0D1B3E]/10 px-3 text-xs font-medium normal-case" /></label></>}
        </div>
        <div className="mt-3 flex flex-col gap-2 text-[11px] text-gray-500 sm:flex-row sm:items-center sm:justify-between"><p><strong className="text-green-700">Recorded event</strong> = immutable transaction snapshot. <strong className="text-amber-700">Historical reconstruction</strong> = legacy row rebuilt from its completed order or package record because no original inventory event exists.</p>{datePreset !== 'all_time' && <button type="button" onClick={() => chooseDatePreset('all_time')} className="shrink-0 font-bold text-red-600 hover:underline">Clear date range</button>}</div>
      </div>
      {error ? <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : loading ? <div className="py-16 text-center text-sm text-gray-400">Loading movement ledger…</div> : rows.length === 0 ? <div className="py-16 text-center text-sm text-gray-400">No movements match these filters.</div> : <>
        <div className="hidden grid-cols-[1.05fr_1.15fr_.55fr_.55fr_.55fr_.75fr_1fr_1.1fr] bg-[#f8f9fc] px-4 py-3 lg:grid">{['Date / Type', 'Product', 'Stock Before', 'Movement', 'Stock After', 'Value', 'Reference', 'Actor / Reason'].map((head) => <p key={head} className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{head}</p>)}</div>
        <div className="divide-y divide-[#0D1B3E]/6">{rows.map((row) => <div key={row.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[1.05fr_1.15fr_.55fr_.55fr_.55fr_.75fr_1fr_1.1fr] lg:items-center lg:gap-2">
          <div><p className="text-xs font-semibold text-[#0D1B3E]">{new Date(row.occurred_at).toLocaleString('en-PH')}</p><span className="mt-1 inline-flex rounded-full bg-[#eef0f8] px-2 py-0.5 text-[9px] font-bold text-[#0D1B3E]">{eventLabel(row.event_type)}</span></div>
          <div><p className="text-xs font-semibold text-[#0D1B3E]">{row.product_name}</p><p title={row.source_note} className={`text-[10px] font-semibold ${row.source === 'recorded' ? 'text-green-700' : 'text-amber-700'}`}>{row.source === 'recorded' ? '✓ Recorded event' : '⚠ Historical reconstruction'}</p><p className="mt-0.5 line-clamp-2 text-[9px] leading-relaxed text-gray-400">{row.source_note}</p></div>
          <div className="rounded-lg bg-[#f8f9fc] px-2.5 py-2 lg:bg-transparent lg:p-0"><p className="text-[9px] font-bold uppercase tracking-wide text-gray-400 lg:hidden">Stock before</p><p className={`text-sm font-extrabold ${row.balance_before === null ? 'text-amber-700' : 'text-[#0D1B3E]'}`}>{row.balance_before === null ? 'Not captured' : row.balance_before}</p></div>
          <div className="rounded-lg bg-[#f8f9fc] px-2.5 py-2 lg:bg-transparent lg:p-0"><p className="text-[9px] font-bold uppercase tracking-wide text-gray-400 lg:hidden">Movement</p><p className={`text-sm font-extrabold ${row.direction === 'in' ? 'text-blue-600' : row.direction === 'out' ? 'text-amber-700' : 'text-gray-500'}`}>{row.direction === 'in' ? '+' : row.direction === 'out' ? '−' : ''}{row.quantity}</p></div>
          <div className="rounded-lg bg-[#f8f9fc] px-2.5 py-2 lg:bg-transparent lg:p-0"><p className="text-[9px] font-bold uppercase tracking-wide text-gray-400 lg:hidden">Stock after</p><p className={`text-sm font-extrabold ${row.balance_after === null ? 'text-amber-700' : 'text-[#0D1B3E]'}`}>{row.balance_after === null ? 'Not captured' : row.balance_after}</p></div>
          <div><p className="text-[9px] font-bold uppercase tracking-wide text-gray-400 lg:hidden">Movement value</p><p className="text-xs font-bold text-[#0D1B3E]">{money(row.total_value)}</p><p className="text-[9px] text-gray-400">{money(row.unit_cost)} per unit</p></div>
          <div><p className="break-all text-[11px] font-bold text-[#0D1B3E]">{row.reference}</p><p className="mt-0.5 text-[9px] text-gray-400">{row.event_type.includes('registration') || row.event_type.includes('upgrade') ? 'PIN reference' : row.event_type.includes('sale') || row.event_type.includes('order') ? 'Order reference' : 'Audit / transfer reference'}</p></div>
          <div><p className="text-xs font-semibold text-[#0D1B3E]">{row.actor}</p><p className="line-clamp-2 text-[10px] text-gray-500">{row.reason}</p></div>
        </div>)}</div>
        <div className="border-t-2 border-[#0D1B3E]/10 bg-[#f8f9fc] px-4 py-4">
          <div className="grid gap-3 lg:grid-cols-[1.05fr_1.15fr_.55fr_.55fr_.55fr_.75fr_1fr_1.1fr] lg:items-center lg:gap-2">
            <div><p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Filtered totals</p><p className="text-xs font-extrabold text-[#0D1B3E]">{summary.movement_count.toLocaleString('en-PH')} movement{summary.movement_count === 1 ? '' : 's'}</p></div>
            <div><p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Units moved</p><p className="text-xs font-bold text-[#0D1B3E]"><span className="text-blue-600">+{summary.stock_in_units.toLocaleString('en-PH')} in</span> · <span className="text-amber-700">−{summary.stock_out_units.toLocaleString('en-PH')} out</span></p></div>
            <div className="hidden lg:block" aria-hidden="true">—</div>
            <div><p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 lg:hidden">Net movement</p><p className={`text-base font-extrabold ${summary.net_movement_units > 0 ? 'text-blue-600' : summary.net_movement_units < 0 ? 'text-amber-700' : 'text-gray-500'}`}>{summary.net_movement_units > 0 ? '+' : summary.net_movement_units < 0 ? '−' : ''}{Math.abs(summary.net_movement_units).toLocaleString('en-PH')}</p></div>
            <div className="hidden lg:block" aria-hidden="true">—</div>
            <div><p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 lg:hidden">Total movement value</p><p className="text-sm font-extrabold text-[#0D1B3E]">{money(summary.total_movement_value)}</p></div>
            <div className="lg:col-span-2"><p className="text-[10px] leading-relaxed text-gray-500">Totals include all records matching the current search, movement type, and date filters.</p></div>
          </div>
        </div>
      </>}
    </div>
  </div>
}

export function InventoryPhysicalAudits() {
  const [sessions, setSessions] = useState<AuditSummary[]>([])
  const [selected, setSelected] = useState<AuditDetail | null>(null)
  const [canApprove, setCanApprove] = useState(false)
  const [canCount, setCanCount] = useState(false)
  const [areaManagerAudit, setAreaManagerAudit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<AuditDialogKind | null>(null)
  const [dialogNotes, setDialogNotes] = useState('')
  const [countDraft, setCountDraft] = useState<Record<string, { counted: string; damaged: string; expired: string; notes: string }>>({})

  const loadSessions = useCallback(async () => {
    setLoading(true); setError('')
    try { const response = await fetch('/api/city/inventory/audits', { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setSessions(data.sessions || []); setCanApprove(Boolean(data.can_approve)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to load audits.') } finally { setLoading(false) }
  }, [])
  // Initial remote synchronization is intentionally performed once on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadSessions() }, [loadSessions])

  const openSession = async (id: string) => {
    setError(''); const response = await fetch(`/api/city/inventory/audits/${id}`, { cache: 'no-store' }); const data = await response.json()
    if (!response.ok) { setError(data.error || 'Unable to load audit.'); return }
    setSelected(data.session); setCanApprove(Boolean(data.can_approve)); setCanCount(Boolean(data.can_count)); setAreaManagerAudit(Boolean(data.is_area_manager_audit))
    setCountDraft(Object.fromEntries((data.session.items as AuditItem[]).map((item) => [item.id, { counted: item.counted_quantity?.toString() ?? '', damaged: String(item.damaged_quantity || 0), expired: String(item.expired_quantity || 0), notes: item.notes || '' }])))
  }

  const startAudit = async () => {
    setBusy(true); setError(''); setNotice('')
    const response = await fetch('/api/city/inventory/audits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'Surprise/full physical inventory count' }) }); const data = await response.json()
    setBusy(false)
    if (!response.ok) { setError(data.error || 'Unable to start count.'); if (data.session_id) await openSession(data.session_id); return }
    setNotice(`Audit ${data.reference_number} started.`); await loadSessions(); await openSession(data.session_id)
  }

  const submitCounts = async (action: 'save_counts' | 'submit') => {
    if (!selected) return
    setBusy(true); setError(''); setNotice('')
    const items = selected.items.map((item) => ({ id: item.id, counted_quantity: countDraft[item.id]?.counted, damaged_quantity: countDraft[item.id]?.damaged || 0, expired_quantity: countDraft[item.id]?.expired || 0, notes: countDraft[item.id]?.notes || '' }))
    const response = await fetch(`/api/city/inventory/audits/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, items }) }); const data = await response.json(); setBusy(false)
    if (!response.ok) { setError(data.error || 'Unable to save count.'); return }
    setNotice(action === 'submit' ? 'Count submitted for owner approval.' : 'Count draft saved.'); await loadSessions(); await openSession(selected.id)
  }

  const decide = async (action: 'approve' | 'reject', notes: string) => {
    if (!selected) return
    setBusy(true); setError(''); setNotice('')
    const response = await fetch(`/api/city/inventory/audits/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, notes }) }); const data = await response.json(); setBusy(false)
    if (!response.ok) { setError(data.error || 'Unable to complete approval.'); return }
    setNotice(action === 'approve' ? 'Count approved and inventory reconciled.' : 'Count rejected.'); await loadSessions(); await openSession(selected.id)
  }

  const cancelAudit = async () => {
    if (!selected || selected.status !== 'counting') return
    setBusy(true); setError(''); setNotice('')
    const response = await fetch(`/api/city/inventory/audits/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) })
    const data = await response.json(); setBusy(false)
    if (!response.ok) { setError(data.error || 'Unable to cancel this count.'); return }
    setNotice(`Audit ${selected.reference_number} cancelled. You can now start a new full count.`); await loadSessions(); await openSession(selected.id)
  }

  const draftTotals = useMemo(() => selected?.items.reduce((totals, item) => {
    const draft = countDraft[item.id]; if (draft?.counted === undefined || draft.counted === '') return totals
    const counted = Number(draft.counted); const damaged = Number(draft.damaged || 0); const expired = Number(draft.expired || 0)
    if (!Number.isFinite(counted)) return totals
    const variance = counted - damaged - expired - item.expected_quantity
    totals.units += Math.abs(variance); totals.value += Math.abs(variance * item.unit_cost_snapshot); return totals
  }, { units: 0, value: 0 }) || { units: 0, value: 0 }, [countDraft, selected])

  const openDialog = (kind: AuditDialogKind) => { setDialogNotes(''); setDialog(kind) }
  const dialogCopy = dialog ? {
    start: { title: 'Start Full Count?', description: 'This will freeze the current expected quantities and open a new physical-count session.', confirm: 'Start Full Count' },
    submit: { title: 'Submit for Approval?', description: 'The completed counts will be locked and sent to the City Distributor or Branch owner for review.', confirm: 'Submit Count' },
    cancel: { title: 'Cancel This Audit?', description: 'No inventory quantities will change. The session will remain in the history as cancelled.', confirm: 'Cancel Audit' },
    approve: { title: 'Approve & Reconcile?', description: 'Verified variances will update the official inventory and create permanent movement records.', confirm: 'Approve & Reconcile' },
    reject: { title: 'Reject for Recount?', description: 'The submitted count will be rejected without changing inventory. Add a clear reason for the recount.', confirm: 'Reject Count' },
  }[dialog] : null
  const confirmDialog = async () => {
    if (!dialog || (dialog === 'reject' && dialogNotes.trim().length < 5)) return
    const action = dialog; const notes = dialogNotes.trim(); setDialog(null)
    if (action === 'start') await startAudit()
    else if (action === 'submit') await submitCounts('submit')
    else if (action === 'cancel') await cancelAudit()
    else await decide(action, notes)
  }

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 rounded-2xl border border-[#d7ab42]/40 bg-[#fffaf0] p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-sm font-bold text-[#0D1B3E]">Physical Count & Surprise Audit</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-gray-600">Freeze expected stock, count every physical unit, separate damaged/expired goods, calculate shortages or overages, and require owner approval before inventory changes.</p></div><button onClick={() => openDialog('start')} disabled={busy} className="rounded-xl bg-[#0D1B3E] px-5 py-3 text-xs font-bold text-white disabled:opacity-50">+ Start Full Count</button></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}{notice && <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">{notice}</div>}
    <div className="grid gap-4 xl:grid-cols-[.8fr_1.7fr]">
      <div className="overflow-hidden rounded-2xl border border-[#0D1B3E]/10 bg-white"><div className="border-b border-[#0D1B3E]/8 p-4"><h3 className="text-sm font-bold text-[#0D1B3E]">Audit Sessions</h3><p className="text-[11px] text-gray-500">Permanent count history</p></div>{loading ? <p className="p-8 text-center text-sm text-gray-400">Loading…</p> : sessions.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">No physical counts yet.</p> : <div className="divide-y divide-[#0D1B3E]/6">{sessions.map((session) => <button key={session.id} onClick={() => openSession(session.id)} className={`w-full p-4 text-left hover:bg-[#f8f9fc] ${selected?.id === session.id ? 'bg-[#eef3ff]' : ''}`}><div className="flex items-center justify-between gap-2"><p className="text-xs font-bold text-[#0D1B3E]">{session.reference_number}</p><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${session.status === 'approved' ? 'bg-green-100 text-green-700' : session.status === 'submitted' ? 'bg-amber-100 text-amber-700' : session.status === 'rejected' ? 'bg-red-100 text-red-700' : session.status === 'cancelled' ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'}`}>{session.status}</span></div><p className="mt-1 text-[10px] text-gray-500">{new Date(session.started_at).toLocaleString('en-PH')} · {session.started_by}</p><p className="mt-2 text-[10px] font-semibold text-[#0D1B3E]">{session.totals.counted}/{session.totals.products} counted · Variance {session.totals.variance_units} · {money(session.totals.variance_value)}</p></button>)}</div>}</div>
      <div className="overflow-hidden rounded-2xl border border-[#0D1B3E]/10 bg-white">{!selected ? <div className="py-24 text-center"><p className="text-3xl">📋</p><p className="mt-2 text-sm font-semibold text-[#0D1B3E]">Select or start an audit session</p></div> : <><div className="border-b border-[#0D1B3E]/8 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold text-[#0D1B3E]">{selected.reference_number}</h3><p className="text-[11px] text-gray-500">Expected quantities are the frozen system snapshot. Saleable count = physical − damaged − expired.</p></div><div className="text-right"><p className="text-xs font-bold text-[#b9383e]">Draft variance: {draftTotals.units} units</p><p className="text-[10px] text-gray-500">Value impact {money(draftTotals.value)}</p></div></div></div>
        <div className="hidden grid-cols-[1.4fr_.55fr_.65fr_.65fr_.65fr_.75fr] bg-[#f8f9fc] px-4 py-3 lg:grid">{['Product', 'Expected', 'Physical', 'Damaged', 'Expired', 'Variance'].map((head) => <p key={head} className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{head}</p>)}</div>
        <div className="divide-y divide-[#0D1B3E]/6">{selected.items.map((item) => { const draft = countDraft[item.id]; const hasCount = draft?.counted !== undefined && draft.counted !== ''; const counted = hasCount ? Number(draft.counted) : null; const variance = counted === null ? null : counted - Number(draft?.damaged || 0) - Number(draft?.expired || 0) - item.expected_quantity; return <div key={item.id} className="grid gap-3 p-4 lg:grid-cols-[1.4fr_.55fr_.65fr_.65fr_.65fr_.75fr] lg:items-center"><div><p className="text-xs font-bold text-[#0D1B3E]">{item.product_name_snapshot}</p><input disabled={selected.status !== 'counting' || !canCount} value={draft?.notes || ''} onChange={(event) => setCountDraft((current) => ({ ...current, [item.id]: { ...current[item.id], notes: event.target.value } }))} placeholder="Notes / shelf / explanation" className="mt-1 w-full rounded border border-[#0D1B3E]/10 px-2 py-1 text-[10px] disabled:bg-gray-50" /></div><p className="text-sm font-bold text-[#0D1B3E]">{item.expected_quantity}</p>{(['counted', 'damaged', 'expired'] as const).map((field) => <input key={field} type="number" min="0" disabled={selected.status !== 'counting' || !canCount} value={draft?.[field] || ''} onChange={(event) => setCountDraft((current) => ({ ...current, [item.id]: { ...current[item.id], [field]: event.target.value } }))} className="w-full rounded-lg border border-[#0D1B3E]/15 px-2 py-2 text-center text-xs disabled:bg-gray-50" aria-label={`${field} ${item.product_name_snapshot}`} />)}<div><p className={`text-sm font-extrabold ${variance === 0 ? 'text-green-700' : variance === null ? 'text-gray-400' : 'text-red-600'}`}>{variance === null ? '—' : variance > 0 ? `+${variance}` : variance}</p>{variance !== null && <p className="text-[9px] text-gray-500">{money(variance * item.unit_cost_snapshot)}</p>}</div></div>})}</div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-[#0D1B3E]/8 p-4">{selected.status === 'counting' && <>{!areaManagerAudit && <button onClick={() => openDialog('cancel')} disabled={busy} className="mr-auto rounded-lg border border-red-200 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Cancel Audit</button>}{canCount ? <><button onClick={() => submitCounts('save_counts')} disabled={busy} className="rounded-lg border border-[#0D1B3E]/15 px-4 py-2 text-xs font-semibold text-[#0D1B3E]">Save Draft</button><button onClick={() => openDialog('submit')} disabled={busy} className="rounded-lg bg-[#C9A84C] px-4 py-2 text-xs font-bold text-[#0D1B3E]">Submit for Approval</button></> : <p className="text-xs font-semibold text-amber-700">{areaManagerAudit ? 'Area Manager surprise count in progress. Local entries are read-only.' : 'Assign an inventory staff member to count and submit; the owner/manager remains the approver.'}</p>}</>}{selected.status === 'submitted' && canApprove && <><button onClick={() => openDialog('reject')} disabled={busy} className="rounded-lg border border-red-200 px-4 py-2 text-xs font-semibold text-red-700">Reject / Recount</button><button onClick={() => openDialog('approve')} disabled={busy} className="rounded-lg bg-[#187443] px-4 py-2 text-xs font-bold text-white">Approve & Reconcile</button></>}{selected.status === 'submitted' && !canApprove && <p className="text-xs font-semibold text-amber-700">Waiting for a different authorized local owner/manager to review.</p>}{['approved', 'rejected', 'cancelled'].includes(selected.status) && <p className="text-xs font-semibold text-gray-500">This audit is permanently {selected.status}. {selected.approval_notes || ''}</p>}</div></>}</div>
    </div>
    {dialog && dialogCopy && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#020817]/60 p-4 backdrop-blur-[2px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(null) }}>
      <div role="dialog" aria-modal="true" aria-labelledby="audit-dialog-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
        <div className="border-b border-[#0D1B3E]/10 px-5 py-4"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#C09A38]">Physical Count</p><h3 id="audit-dialog-title" className="mt-1 text-lg font-extrabold text-[#0D1B3E]">{dialogCopy.title}</h3></div><button type="button" onClick={() => setDialog(null)} disabled={busy} aria-label="Close dialog" className="rounded-lg px-2 py-1 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-[#0D1B3E]">×</button></div></div>
        <div className="space-y-4 px-5 py-5"><p className="text-sm leading-relaxed text-gray-600">{dialogCopy.description}</p>{(dialog === 'approve' || dialog === 'reject') && <label className="grid gap-1.5 text-xs font-bold text-[#53627e]">{dialog === 'reject' ? 'Reason for rejection (required)' : 'Approval notes (optional)'}<textarea autoFocus value={dialogNotes} onChange={(event) => setDialogNotes(event.target.value)} rows={3} placeholder={dialog === 'reject' ? 'Explain what needs to be recounted…' : 'Add an optional approval note…'} className="resize-none rounded-xl border border-[#0D1B3E]/15 px-3 py-2.5 text-sm font-normal text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />{dialog === 'reject' && dialogNotes.trim().length > 0 && dialogNotes.trim().length < 5 && <span className="font-normal text-red-600">Please enter at least 5 characters.</span>}</label>}</div>
        <div className="flex justify-end gap-2 border-t border-[#0D1B3E]/10 bg-[#f8f9fc] px-5 py-4"><button type="button" onClick={() => setDialog(null)} disabled={busy} className="rounded-lg border border-[#0D1B3E]/15 bg-white px-4 py-2 text-xs font-bold text-[#0D1B3E]">Go Back</button><button type="button" onClick={confirmDialog} disabled={busy || (dialog === 'reject' && dialogNotes.trim().length < 5)} className={`rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-40 ${dialog === 'cancel' || dialog === 'reject' ? 'bg-red-600' : dialog === 'approve' ? 'bg-[#187443]' : 'bg-[#0D1B3E]'}`}>{busy ? 'Please wait…' : dialogCopy.confirm}</button></div>
      </div>
    </div>}
  </div>
}
