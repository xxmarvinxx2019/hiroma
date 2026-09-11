'use client'

import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'

type Batch = { batch_id: string; count: number; amount: number }
type PreviewRow = { row_number: number; payout_id: string; result: string; external_reference: string; ready: boolean; errors: string[] }

const peso = (value: number) => `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
const key = (value: unknown) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

export default function PayoutBatchTools({ onReleased }: { onReleased: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [batchId, setBatchId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pinPrompt, setPinPrompt] = useState<'export' | 'commit' | null>(null)
  const [pin, setPin] = useState('')
  const [uploadedRows, setUploadedRows] = useState<Record<string, unknown>[]>([])
  const [preview, setPreview] = useState<PreviewRow[]>([])

  const loadBatches = () => fetch('/api/admin/payouts/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) })
    .then(response => response.json()).then(data => { const next = data.batches || []; setBatches(next); setBatchId(current => current || next[0]?.batch_id || '') })
  useEffect(() => { void loadBatches() }, [])

  const securedExport = async () => {
    if (!batchId || pin.length !== 6) return
    setBusy(true); setError('')
    const response = await fetch('/api/admin/payouts/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'export', batch_id: batchId, security_pin: pin }) })
    const data = await response.json(); setBusy(false)
    if (!response.ok) { setError(data.error || 'Unable to export maker file.'); return }
    const sheet = XLSX.utils.json_to_sheet(data.rows)
    sheet['!cols'] = [{wch:22},{wch:38},{wch:25},{wch:30},{wch:20},{wch:18},{wch:18},{wch:26},{wch:18},{wch:36},{wch:18},{wch:22},{wch:22},{wch:22},{wch:14},{wch:30}]
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Payout Maker File')
    XLSX.writeFile(workbook, `hiroma-payout-maker-${batchId}.xlsx`)
    setPin(''); setPinPrompt(null)
  }

  const readUpload = async (file?: File) => {
    if (!file) return
    setBusy(true); setError(''); setPreview([])
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: '' })
      const rows = raw.map(row => Object.fromEntries(Object.entries(row).map(([heading, value]) => [key(heading), value instanceof Date ? value.toISOString() : value])))
      const response = await fetch('/api/admin/payouts/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', batch_id: batchId, rows }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to validate file.')
      setUploadedRows(rows); setPreview(data.rows || [])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid spreadsheet.') }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = '' }
  }

  const commit = async () => {
    if (pin.length !== 6 || !preview.length) return
    setBusy(true); setError('')
    const response = await fetch('/api/admin/payouts/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'commit', batch_id: batchId, rows: uploadedRows, security_pin: pin }) })
    const data = await response.json(); setBusy(false)
    if (!response.ok) { setError(data.error || 'Unable to release payout batch.'); if (data.rows) setPreview(data.rows); return }
    setPin(''); setPinPrompt(null); setPreview([]); setUploadedRows([]); await loadBatches(); onReleased()
  }

  const invalid = preview.filter(row => row.errors.length).length
  const ready = preview.filter(row => row.ready).length
  return <section className="mb-5 rounded-2xl border border-[#0D1B3E]/10 bg-white p-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-[260px] flex-1"><span className="mb-1 block text-xs font-bold text-[#0D1B3E]">Approved payout batch</span><select value={batchId} onChange={event => { setBatchId(event.target.value); setPreview([]) }} className="w-full rounded-xl border px-3 py-2.5 text-sm"><option value="">No approved batch</option>{batches.map(batch => <option key={batch.batch_id} value={batch.batch_id}>{batch.batch_id} · {batch.count} payouts · {peso(batch.amount)}</option>)}</select></label>
      <button disabled={!batchId || busy} onClick={() => setPinPrompt('export')} className="rounded-xl bg-[#0D1B3E] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-40">Download secured maker Excel</button>
      <label className={`rounded-xl border border-[#0D1B3E]/15 px-4 py-2.5 text-xs font-bold ${!batchId || busy ? 'pointer-events-none opacity-40' : 'cursor-pointer hover:border-[#C9A84C]'}`}>Upload completed Excel<input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={event => void readUpload(event.target.files?.[0])}/></label>
    </div>
    <p className="mt-2 text-[11px] leading-5 text-amber-700">Contains complete payout destinations and is restricted to the Admin owner with Security PIN. Store it securely and upload it only through this page. PDF is for audit copies, not release import.</p>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
    {preview.length > 0 && <div className="mt-4 overflow-hidden rounded-xl border"><div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3"><p className="text-xs font-bold">Validation preview: <span className="text-green-700">{ready} ready</span> · <span className="text-amber-700">{preview.length-ready-invalid} unchanged</span> · <span className="text-red-700">{invalid} invalid</span></p><button disabled={invalid > 0 || ready < 1 || busy} onClick={() => setPinPrompt('commit')} className="rounded-lg bg-green-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Confirm successful releases</button></div><div className="max-h-64 overflow-auto divide-y">{preview.map(row => <div key={`${row.row_number}-${row.payout_id}`} className="grid grid-cols-[65px_1fr_100px_1.3fr] gap-2 px-3 py-2 text-[11px]"><span>Row {row.row_number}</span><span className="font-mono">{row.payout_id}</span><span className="capitalize">{row.result || '—'}</span><span className={row.errors.length ? 'text-red-700' : row.ready ? 'text-green-700' : 'text-amber-700'}>{row.errors.join('; ') || (row.ready ? `Ready · ${row.external_reference}` : 'No release; retained for next review')}</span></div>)}</div></div>}
    {pinPrompt && <div className="fixed inset-0 z-[140] flex items-center justify-center bg-[#010521]/70 p-4" onMouseDown={event => event.target === event.currentTarget && setPinPrompt(null)}><section role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5"><h2 className="text-lg font-extrabold">Admin owner confirmation</h2><p className="mt-1 text-xs leading-5 text-gray-500">{pinPrompt === 'export' ? 'This export reveals complete financial destinations. The download will be audit-logged.' : `Release ${ready} externally successful payouts. This cannot be undone.`}</p><input autoFocus type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0,6))} placeholder="6-digit Security PIN" className="mt-4 w-full rounded-xl border px-3 py-2.5 text-sm"/><div className="mt-4 flex justify-end gap-2"><button onClick={() => { setPinPrompt(null); setPin('') }} className="rounded-xl border px-4 py-2 text-sm">Cancel</button><button disabled={pin.length !== 6 || busy} onClick={() => void (pinPrompt === 'export' ? securedExport() : commit())} className="rounded-xl bg-[#0D1B3E] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? 'Verifying…' : pinPrompt === 'export' ? 'Download' : 'Confirm release'}</button></div></section></div>}
  </section>
}
