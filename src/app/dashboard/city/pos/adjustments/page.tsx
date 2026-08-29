'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { listQueuedSales, PosQueuedSale } from '@/app/lib/posOfflineQueue'
import { loadPosDeviceSettings } from '@/app/lib/posDeviceSettings'

type Adjustment = {
  request_type: 'void' | 'refund'
  status: string
  reason: string
  requested_at: string
}

type Receipt = {
  id: string
  client_transaction_id?: string
  receipt_number: string
  transaction_type: string
  customer_name_snapshot: string | null
  payment_method_snapshot: string
  payment_reference?: string | null
  review_notes?: string | null
  total: number
  finalized_at: string | null
  server_received_at?: string | null
  status: string
  sync_status: 'pending_sync' | 'syncing' | 'synced' | 'needs_attention'
  sync_error?: string
  local_only?: boolean
  adjustment_requests?: Adjustment[]
  items: Array<{
    id: string
    product_name_snapshot: string
    quantity: number
    refundable_quantity: number
    unit_price: number
    subtotal: number
  }>
}


type ReceiptPrintIdentity = {
  name: string
  address: string
  cashierName: string
}
type OfflineReceiptSnapshot = {
  client_transaction_id: string
  receipt_number: string
  created_at: string
  customer_name: string
  customer_type: 'member' | 'non_member'
  payment_method: string
  payment_reference?: string | null
  total: number
  items: Array<{ product_id: string; name: string; quantity: number; unit_price: number; subtotal: number }>
}

type RequestRow = {
  id: string
  request_type: 'void' | 'refund'
  status: string
  reason: string
  review_notes?: string | null
  amount: number
  requested_at: string
  can_review: boolean
  requester: { full_name: string; username: string }
  transaction: Receipt & { cashier_id: string }
  items: Array<{
    quantity: number
    disposition: 'resellable' | 'damaged' | 'expired'
    transaction_item: { product_name_snapshot: string }
  }>
}

const peso = (value: number) => value.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })
const receiptTime = (value: string | null) => value ? new Date(value).toLocaleString('en-PH') : 'Awaiting final timestamp'
const receiptDateValue = (receipt: Receipt) => receipt.finalized_at || receipt.server_received_at || null

function receiptDayKey(value: string | null) {
  if (!value) return 'unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function receiptDayLabel(value: string | null) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Date unavailable'
  const today = new Date()
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const receiptDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const difference = Math.round((currentDay.getTime() - receiptDay.getTime()) / 86_400_000)
  const formatted = new Intl.DateTimeFormat('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)

  if (difference === 0) return `Today — ${formatted}`
  if (difference === 1) return `Yesterday — ${formatted}`
  return formatted
}
function escapeReceiptHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatReceiptMoney(value: number) {
  return new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function reprintReceipt(receipt: Receipt, identity: ReceiptPrintIdentity) {
  const deviceSettings = loadPosDeviceSettings()
  const paperWidth = deviceSettings.paperWidth === '58' ? 58 : 80
  const contentWidth = paperWidth - 4
  const frame = document.createElement('iframe')
  frame.title = 'Hiroma receipt reprint'
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0', opacity: '0', pointerEvents: 'none' })
  document.body.appendChild(frame)

  const printWindow = frame.contentWindow
  const printDocument = frame.contentDocument
  if (!printWindow || !printDocument) {
    frame.remove()
    return
  }

  const itemRows = receipt.items.map((item) => `
    <div class="item">
      <div class="item-name">${escapeReceiptHtml(item.product_name_snapshot)}</div>
      <div class="item-line"><span>${item.quantity} x PHP ${formatReceiptMoney(item.unit_price)}</span><strong>PHP ${formatReceiptMoney(item.subtotal)}</strong></div>
    </div>`).join('')
  const originalDate = receipt.finalized_at || receipt.server_received_at

  printDocument.open()
  printDocument.write(`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeReceiptHtml(receipt.receipt_number)} - Reprint</title><style>
    @page{size:${paperWidth}mm auto;margin:2mm}*{box-sizing:border-box}html,body{margin:0;padding:0;width:${contentWidth}mm;background:#fff;color:#000}body{font-family:Arial,Helvetica,sans-serif;font-size:${paperWidth === 58 ? '10px' : '11px'};line-height:1.35}.receipt{width:${contentWidth}mm;padding:2mm}.center{text-align:center}.brand{font-size:16px;font-weight:800;letter-spacing:.12em}.subtitle{margin-top:1mm;font-size:10px;font-weight:700}.muted{color:#333;font-size:9px}.rule{border-top:1px dashed #000;margin:3mm 0}.row,.item-line{display:flex;justify-content:space-between;gap:3mm}.row{margin:1.2mm 0}.row strong,.item-line strong{text-align:right}.item{margin:2mm 0}.item-name{font-weight:700}.item-line{margin-top:.5mm;font-size:10px}.total{font-size:14px;font-weight:800}.notice{margin:3mm 0;border:2px solid #000;padding:2mm;font-size:10px;font-weight:800;text-align:center}.footer{margin-top:4mm;text-align:center;font-size:9px}
  </style></head><body><main class="receipt"><header class="center"><div class="brand">HIROMA</div><div class="subtitle">${escapeReceiptHtml(identity.name || 'POINT OF SALE')}</div>${identity.address ? `<div class="muted">${escapeReceiptHtml(identity.address)}</div>` : ''}<div class="muted">OFFICIAL SALES RECEIPT</div></header><div class="notice">REPRINT COPY<br />Original transaction remains unchanged</div><div class="rule"></div><div class="row"><span>Receipt</span><strong>${escapeReceiptHtml(receipt.receipt_number)}</strong></div><div class="row"><span>Original date</span><strong>${escapeReceiptHtml(originalDate ? new Date(originalDate).toLocaleString('en-PH') : 'Unavailable')}</strong></div><div class="row"><span>Reprinted</span><strong>${escapeReceiptHtml(new Date().toLocaleString('en-PH'))}</strong></div><div class="row"><span>Customer</span><strong>${escapeReceiptHtml(receipt.customer_name_snapshot || 'Walk-in Customer')}</strong></div><div class="row"><span>Cashier</span><strong>${escapeReceiptHtml(identity.cashierName || 'POS Cashier')}</strong></div><div class="rule"></div>${itemRows}<div class="rule"></div><div class="row total"><span>TOTAL</span><strong>PHP ${formatReceiptMoney(receipt.total)}</strong></div><div class="row"><span>Payment</span><strong>${escapeReceiptHtml(receipt.payment_method_snapshot)}</strong></div>${receipt.payment_reference ? `<div class="row"><span>Reference</span><strong>${escapeReceiptHtml(receipt.payment_reference)}</strong></div>` : ''}<footer class="footer">Thank you for choosing Hiroma.<br />Keep this receipt for your records.</footer></main></body></html>`)
  printDocument.close()

  let removed = false
  const cleanup = () => {
    if (!removed) {
      removed = true
      frame.remove()
    }
  }
  printWindow.addEventListener('afterprint', cleanup, { once: true })
  window.setTimeout(() => {
    printWindow.focus()
    printWindow.print()
  }, 150)
  window.setTimeout(cleanup, 60_000)
}
const syncLabel = {
  pending_sync: 'Pending sync',
  syncing: 'Syncing',
  synced: 'Synced',
  needs_attention: 'Needs attention',
} as const
const syncStyle = {
  pending_sync: 'bg-amber-100 text-amber-800',
  syncing: 'bg-blue-100 text-blue-800',
  synced: 'bg-emerald-100 text-emerald-800',
  needs_attention: 'bg-red-100 text-red-700',
} as const

function queuedReceipt(sale: PosQueuedSale): Receipt {
  const snapshot = sale.receipt as unknown as OfflineReceiptSnapshot
  return {
    id: `local:${sale.client_transaction_id}`,
    client_transaction_id: sale.client_transaction_id,
    receipt_number: sale.receipt_number,
    transaction_type: snapshot.customer_type === 'member' ? 'member_sale' : 'non_member_sale',
    customer_name_snapshot: snapshot.customer_name || 'Walk-in Customer',
    payment_method_snapshot: snapshot.payment_method || 'Cash',
    payment_reference: snapshot.payment_reference || null,
    total: Number(snapshot.total || 0),
    finalized_at: snapshot.created_at || sale.created_at,
    status: 'pending_sync',
    sync_status: sale.status === 'saved_offline' ? 'pending_sync' : sale.status,
    sync_error: sale.error,
    local_only: true,
    adjustment_requests: [],
    items: (snapshot.items || []).map((item) => ({
      id: `local:${sale.client_transaction_id}:${item.product_id}`,
      product_name_snapshot: item.name,
      quantity: item.quantity,
      refundable_quantity: 0,
      unit_price: Number(item.unit_price),
      subtotal: Number(item.subtotal),
    })),
  }
}


export default function PosAdjustmentsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [queuedSales, setQueuedSales] = useState<PosQueuedSale[]>([])
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [canApprove, setCanApprove] = useState(false)
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null)
  const [selectedRequest, setSelectedRequest] = useState<RequestRow | null>(null)
  const [showCorrectionForm, setShowCorrectionForm] = useState(false)
  const [requestType, setRequestType] = useState<'void' | 'refund'>('void')
  const [helpType, setHelpType] = useState<'void' | 'refund' | null>(null)
  const [refundLines, setRefundLines] = useState<Record<string, { quantity: string; disposition: 'resellable' | 'damaged' | 'expired' }>>({})
  const [reason, setReason] = useState('')
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [correctionReference, setCorrectionReference] = useState('')
  const [correctionSaving, setCorrectionSaving] = useState(false)
  const [printIdentity, setPrintIdentity] = useState<ReceiptPrintIdentity>({ name: 'Hiroma Point of Sale', address: '', cashierName: 'POS Cashier' })

  useEffect(() => {
    let active = true
    fetch('/api/auth/me', { cache: 'no-store', credentials: 'include' })
      .then((response) => response.json())
      .then((data) => {
        if (!active || !data.user) return
        setPrintIdentity({
          name: data.user.pos_receipt_identity?.name || data.user.full_name || 'Hiroma Point of Sale',
          address: data.user.pos_receipt_identity?.address || '',
          cashierName: data.user.full_name || data.user.username || 'POS Cashier',
        })
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const localRows = (await listQueuedSales()).sort((a, b) => b.created_at.localeCompare(a.created_at))
      setQueuedSales(localRows)
      setOnline(navigator.onLine)
      if (!navigator.onLine) {
        setError('')
        return
      }
      const response = await fetch('/api/city/pos/adjustments', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to load receipts.')
      setReceipts((result.eligible_receipts || []).map((receipt: Receipt) => ({ ...receipt, sync_status: 'synced' as const })))
      setRequests(result.requests || [])
      setCanApprove(result.access?.can_approve === true)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load receipts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    const updateConnection = () => {
      setOnline(navigator.onLine)
      void load()
    }
    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('online', updateConnection)
      window.removeEventListener('offline', updateConnection)
    }
  }, [load])

  const visibleReceipts = useMemo(() => {
    const localReceipts = queuedSales.map(queuedReceipt)
    const localIds = new Set(localReceipts.map((receipt) => receipt.client_transaction_id))
    const combined = [...localReceipts, ...receipts.filter((receipt) => !localIds.has(receipt.client_transaction_id))]
      .sort((a, b) => String(b.finalized_at || '').localeCompare(String(a.finalized_at || '')))
    const query = search.trim().toLowerCase()
    if (!query) return combined
    return combined.filter((receipt) =>
      [receipt.receipt_number, receipt.customer_name_snapshot, receipt.payment_method_snapshot, receipt.payment_reference, syncLabel[receipt.sync_status]]
        .some((value) => value?.toLowerCase().includes(query))
    )
  }, [queuedSales, receipts, search])
  const groupedReceipts = useMemo(() => {
    const groups: Array<{ key: string; label: string; receipts: Receipt[] }> = []
    for (const receipt of visibleReceipts) {
      const dateValue = receiptDateValue(receipt)
      const key = receiptDayKey(dateValue)
      const previous = groups[groups.length - 1]
      if (previous?.key === key) previous.receipts.push(receipt)
      else groups.push({ key, label: receiptDayLabel(dateValue), receipts: [receipt] })
    }
    return groups
  }, [visibleReceipts])
  function openReceipt(receipt: Receipt) {
    setSelectedReceipt(receipt)
    setShowCorrectionForm(false)
    setReason('')
    setRequestType('void')
    setCorrectionReference(receipt.payment_reference || '')
    setRefundLines(Object.fromEntries(receipt.items.map((item) => [item.id, { quantity: '', disposition: 'resellable' as const }])))
  }

  async function resubmitPaymentCorrection() {
    if (!selectedReceipt || correctionReference.trim().length < 3) return
    setCorrectionSaving(true)
    setError('')
    try {
      const response = await fetch('/api/city/pos/approvals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: selectedReceipt.id, payment_reference: correctionReference }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to resubmit the corrected payment.')
      setNotice(`${selectedReceipt.receipt_number} was corrected and resubmitted for independent review.`)
      setSelectedReceipt(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to resubmit the corrected payment.')
    } finally {
      setCorrectionSaving(false)
    }
  }

  async function submitRequest() {
    if (!selectedReceipt || reason.trim().length < 10) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/city/pos/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: selectedReceipt.id,
          request_type: requestType,
          reason,
          items: requestType === 'refund' ? selectedReceipt.items
            .map((item) => ({ item_id: item.id, quantity: Number(refundLines[item.id]?.quantity || 0), disposition: refundLines[item.id]?.disposition }))
            .filter((item) => item.quantity > 0) : [],
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to submit request.')
      setNotice(`${selectedReceipt.receipt_number} was submitted for independent ${requestType} review.`)
      setSelectedReceipt(null)
      setShowCorrectionForm(false)
      setReason('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit request.')
    } finally {
      setSaving(false)
    }
  }

  async function submitDecision() {
    if (!selectedRequest || notes.trim().length < 5) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/city/pos/adjustments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: selectedRequest.id, action: decision, notes }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to save decision.')
      setNotice(`${selectedRequest.transaction.receipt_number} request was ${decision === 'approve' ? 'approved' : 'rejected'}.`)
      setSelectedRequest(null)
      setNotes('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save decision.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-full bg-[#f4f6fb] p-4 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col justify-between gap-4 rounded-2xl bg-[#071638] p-6 text-white sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-[#d4af45]">{canApprove ? 'Maker-approver control' : 'Sales history'}</p>
            <h1 className="mt-2 text-2xl font-bold">{canApprove ? 'Void & Refund Review' : 'Receipts'}</h1>
            <p className="mt-1 text-sm text-white/65">{canApprove ? 'Independently review cashier correction requests.' : 'Open any transaction to review its receipt and available actions.'}</p>
          </div>
          <Link href="/dashboard/city/pos" className="rounded-xl bg-[#d4af45] px-4 py-3 text-center text-sm font-bold text-[#071638]">Return to Sales</Link>
        </header>

        {error && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}
        {notice && <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-semibold text-green-800">{notice}</p>}

        {canApprove ? (
          <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
            <div className="border-b p-5">
              <h2 className="font-bold text-[#071638]">Pending independent review</h2>
              <p className="mt-1 text-xs text-gray-500">The requester cannot approve their own correction.</p>
            </div>
            {loading ? <p className="p-10 text-center text-sm text-gray-400">Loading...</p> : requests.length ? (
              <div className="divide-y">
                {requests.map((row) => (
                  <article key={row.id} className="p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row">
                      <div>
                        <b className="text-[#071638]">{row.transaction.receipt_number}</b>
                        <p className="mt-1 text-xs text-gray-500">Requested by {row.requester.full_name || row.requester.username} on {new Date(row.requested_at).toLocaleString('en-PH')}</p>
                        <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs"><b>{row.request_type.toUpperCase()} reason:</b> {row.reason}</p>
                      </div>
                      <div className="sm:text-right"><b className="text-xl">{peso(row.amount)}</b><p className="mt-1 text-xs">{row.transaction.payment_method_snapshot}</p></div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      {row.can_review ? <button onClick={() => { setSelectedRequest(row); setDecision('approve'); setNotes('') }} className="rounded-xl bg-[#071638] px-4 py-2.5 text-xs font-bold text-white">Review request</button> : <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">A different authorized approver must review this request.</p>}
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="p-10 text-center text-sm text-gray-400">No void or refund requests are waiting for review.</p>}
          </section>
        ) : (
          <>
            {(!online || queuedSales.length > 0) && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><b>{online ? `${queuedSales.length} receipt${queuedSales.length === 1 ? '' : 's'} awaiting synchronization.` : 'This POS is offline.'}</b> Pending receipts are stored on this device and are not yet visible to the manager. They will sync when the connection returns.</div>}
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><b>Receipt policy:</b> Original receipts remain permanent. Void and refund requests apply only to finalized non-member/SRP receipts and require an independent decision.</div>
            <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
              <div className="border-b p-5">
                <h2 className="font-bold text-[#071638]">Transaction receipts</h2>
                <p className="mt-1 text-xs text-gray-500">Newest first. Select a receipt to view products, payment details, status, and available correction actions.</p>
                <label className="mt-4 block">
                  <span className="sr-only">Search receipts</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search receipt number, customer, payment, or reference..." className="w-full rounded-xl border bg-[#fafbfe] px-4 py-3 text-sm outline-none focus:border-[#d4af45]" />
                </label>
              </div>
              {loading ? <p className="p-10 text-center text-sm text-gray-400">Loading receipts...</p> : visibleReceipts.length ? (
                <div>
                  {groupedReceipts.map((group) => (
                    <section key={group.key} aria-labelledby={`receipt-day-${group.key}`}>
                      <div className="border-b bg-[#f7f8fb] px-5 py-3">
                        <h3 id={`receipt-day-${group.key}`} className="text-xs font-bold text-[#8a6112]">{group.label}</h3>
                        <p className="mt-0.5 text-[10px] text-gray-500">{group.receipts.length} receipt{group.receipts.length === 1 ? '' : 's'}</p>
                      </div>
                      <div className="divide-y">
                        {group.receipts.map((receipt) => (
                          <button key={receipt.id} type="button" onClick={() => openReceipt(receipt)} className="flex w-full items-center justify-between gap-4 p-5 text-left transition hover:bg-[#f8f9fc]">
                            <span>
                              <b className="block text-sm text-[#071638]">{receipt.receipt_number}</b>
                              <span className="mt-1 block text-xs text-gray-500">{receiptTime(receipt.finalized_at)} &middot; {receipt.customer_name_snapshot || 'Walk-in customer'}</span>
                              <span className="mt-1 block text-xs capitalize text-gray-400">{receipt.payment_method_snapshot} &middot; {receipt.status.replaceAll('_', ' ')}</span>
                            </span>
                            <span className="text-right">
                              <b className="block text-base text-[#071638]">{peso(receipt.total)}</b>
                              <span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ${syncStyle[receipt.sync_status]}`}>{syncLabel[receipt.sync_status]}</span>
                              <span className="mt-1 block text-[10px] text-gray-400">{receipt.sync_status === 'synced' ? 'Visible to manager' : receipt.sync_status === 'needs_attention' ? 'Open Sync Center' : 'Saved on this device'}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : <p className="p-10 text-center text-sm text-gray-400">{search ? 'No receipts match your search.' : 'No completed transaction receipts yet.'}</p>}
            </section>
          </>
        )}
      </div>

      {selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#071638]/70 p-4" role="dialog" aria-modal="true" aria-labelledby="receipt-details-title" onMouseDown={() => setSelectedReceipt(null)}>
          <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 bg-[#071638] p-6 text-white">
              <div><p className="text-xs font-bold uppercase tracking-[.18em] text-[#d4af45]">Transaction receipt</p><h2 id="receipt-details-title" className="mt-2 text-xl font-bold">{selectedReceipt.receipt_number}</h2><p className="mt-1 text-xs text-white/60">{receiptTime(selectedReceipt.finalized_at)}</p></div>
              <div className="flex flex-wrap justify-end gap-2">
                 <button type="button" onClick={() => reprintReceipt(selectedReceipt, printIdentity)} className="rounded-lg bg-[#d4af45] px-3 py-2 text-xs font-bold text-[#071638]">Reprint receipt</button>
                 <button type="button" onClick={() => setSelectedReceipt(null)} className="rounded-lg border border-white/20 px-3 py-2 text-xs font-bold">Close</button>
               </div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-[#f7f8fb] p-4"><p className="text-[10px] font-bold uppercase text-gray-400">Customer</p><b className="mt-1 block text-sm text-[#071638]">{selectedReceipt.customer_name_snapshot || 'Walk-in customer'}</b><p className="mt-1 text-xs capitalize text-gray-500">{selectedReceipt.transaction_type.replaceAll('_', ' ')}</p></div>
                <div className="rounded-xl bg-[#f7f8fb] p-4"><p className="text-[10px] font-bold uppercase text-gray-400">Payment</p><b className="mt-1 block text-sm text-[#071638]">{selectedReceipt.payment_method_snapshot}</b><p className="mt-1 text-xs text-gray-500">{selectedReceipt.payment_reference ? `Reference: ${selectedReceipt.payment_reference}` : 'No external reference'}</p></div>
              </div>
              <div className="mt-4 overflow-hidden rounded-xl border">
                <div className="grid grid-cols-[1fr_55px_90px] bg-[#f7f8fb] px-4 py-3 text-[10px] font-bold uppercase text-gray-500"><span>Product</span><span className="text-center">Qty</span><span className="text-right">Amount</span></div>
                <div className="divide-y">{selectedReceipt.items.map((item, index) => <div key={`${item.product_name_snapshot}-${index}`} className="grid grid-cols-[1fr_55px_90px] items-center px-4 py-3 text-sm"><span><b className="block text-[#071638]">{item.product_name_snapshot}</b><small className="text-gray-400">{peso(item.unit_price)} each</small></span><span className="text-center">{item.quantity}</span><b className="text-right">{peso(item.subtotal)}</b></div>)}</div>
                <div className="flex justify-between border-t bg-[#fffaf0] px-4 py-4"><b>Total</b><b className="text-lg text-[#071638]">{peso(selectedReceipt.total)}</b></div>
              </div>
              <div className="mt-4 rounded-xl border p-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b className="capitalize text-[#071638]">Transaction: {selectedReceipt.status.replaceAll('_', ' ')}</b>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${syncStyle[selectedReceipt.sync_status]}`}>{syncLabel[selectedReceipt.sync_status]}</span>
                </div>
                <p className="mt-2 text-gray-500">{selectedReceipt.sync_status === 'synced' ? 'This receipt was received by Hiroma and is visible to the manager.' : selectedReceipt.sync_status === 'needs_attention' ? 'This receipt is still on this device. Open Sync Center to review the error and retry.' : 'This receipt is protected on this device but is not yet visible to the manager.'}</p>
                {selectedReceipt.sync_error && <p className="mt-2 font-semibold text-red-700">{selectedReceipt.sync_error}</p>}
                {selectedReceipt.adjustment_requests?.[0] && <p className="mt-2 text-amber-800">{selectedReceipt.adjustment_requests[0].request_type.toUpperCase()} request is {selectedReceipt.adjustment_requests[0].status}. Reason: {selectedReceipt.adjustment_requests[0].reason}</p>}
              </div>

              {selectedReceipt.status === 'needs_correction' && (
                <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
                  <h3 className="font-bold">Payment returned for correction</h3>
                  <p className="mt-1 text-xs leading-5"><b>Manager note:</b> {selectedReceipt.review_notes || 'Review the official payment record and correct the reference.'}</p>
                  <label className="mt-3 block text-xs font-bold">
                    Correct payment reference
                    <input value={correctionReference} onChange={(event) => setCorrectionReference(event.target.value)} maxLength={160} className="mt-1 w-full rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-sm text-[#071638] outline-none focus:border-[#d4af45]" placeholder="Enter the verified GCash, e-wallet, or bank reference" />
                  </label>
                  <p className="mt-2 text-[11px] leading-4">Confirm this against the official receiving account. Resubmitting sends it back to an independent manager; it does not create a second sale.</p>
                  <button type="button" disabled={correctionSaving || correctionReference.trim().length < 3} onClick={resubmitPaymentCorrection} className="mt-3 w-full rounded-xl bg-[#d4af45] px-4 py-3 text-sm font-bold text-[#071638] disabled:opacity-40">{correctionSaving ? 'Resubmitting...' : 'Resubmit for manager review'}</button>
                </div>
              )}

              {selectedReceipt.local_only ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><b>Correction requests become available after synchronization.</b> The manager cannot review this receipt yet. <Link href="/dashboard/city/pos/sync" className="font-bold underline">Open Sync Center</Link>.</div>
              ) : selectedReceipt.transaction_type === 'member_sale' ? (
                <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-5 text-amber-800"><b>Member/Reseller sale · Not eligible for void or refund.</b> This purchase may include PU, rewards, commissions, rank progress, or wallet credits.</p>
              ) : selectedReceipt.status !== 'finalized' ? null : !showCorrectionForm ? (
                <button type="button" onClick={() => setShowCorrectionForm(true)} className="mt-5 w-full rounded-xl border border-red-200 px-4 py-3 text-sm font-bold text-red-700">Request Void or Refund</button>
              ) : (
                <div className="mt-5 rounded-xl border border-red-200 bg-red-50/40 p-4">
                  <h3 className="font-bold text-[#071638]">Request receipt correction</h3>
                  <p className="mt-1 text-xs leading-5 text-gray-600">Choose Void or Refund. Tap the question mark if you need an explanation.</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="relative">
                      <button type="button" onClick={() => setRequestType('void')} className={`w-full rounded-xl border p-3 text-sm font-bold ${requestType === 'void' ? 'border-[#071638] bg-[#071638] text-white' : 'bg-white'}`}>Void</button>
                      <button type="button" aria-label="What is Void?" onClick={() => setHelpType('void')} className={`absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border text-xs font-black ${requestType === 'void' ? 'border-white/40 text-white' : 'border-gray-300 text-[#071638]'}`}>?</button>
                    </div>
                    <div className="relative">
                      <button type="button" onClick={() => setRequestType('refund')} className={`w-full rounded-xl border p-3 text-sm font-bold ${requestType === 'refund' ? 'border-[#071638] bg-[#071638] text-white' : 'bg-white'}`}>Refund</button>
                      <button type="button" aria-label="What is Refund?" onClick={() => setHelpType('refund')} className={`absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border text-xs font-black ${requestType === 'refund' ? 'border-white/40 text-white' : 'border-gray-300 text-[#071638]'}`}>?</button>
                    </div>
                  </div>
                  {requestType === 'refund' && <div className="mt-3 overflow-hidden rounded-xl border bg-white"><div className="border-b bg-[#f7f8fb] px-3 py-2 text-xs font-bold text-[#071638]">Select returned products and quantities</div><div className="divide-y">{selectedReceipt.items.map((item) => { const line = refundLines[item.id] || { quantity: '', disposition: 'resellable' as const }; return <div key={item.id} className="grid gap-2 p-3 sm:grid-cols-[1fr_90px_140px] sm:items-end"><div><b className="text-sm text-[#071638]">{item.product_name_snapshot}</b><p className="text-xs text-gray-500">Purchased: {item.quantity}; available to refund: {item.refundable_quantity} at {peso(item.unit_price)} each</p></div><label className="text-[10px] font-bold uppercase text-gray-500">Refund qty<input type="number" min="0" max={item.refundable_quantity} step="1" disabled={item.refundable_quantity === 0} value={line.quantity} onChange={(event) => setRefundLines((current) => ({ ...current, [item.id]: { ...line, quantity: event.target.value } }))} className="mt-1 w-full rounded-lg border px-2 py-2 text-center text-sm" /></label><label className="text-[10px] font-bold uppercase text-gray-500">Condition<select value={line.disposition} onChange={(event) => setRefundLines((current) => ({ ...current, [item.id]: { ...line, disposition: event.target.value as 'resellable' | 'damaged' | 'expired' } }))} className="mt-1 w-full rounded-lg border px-2 py-2 text-sm"><option value="resellable">Resellable</option><option value="damaged">Damaged</option><option value="expired">Expired</option></select></label></div> })}</div></div>}
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} maxLength={500} placeholder="Explain the exact error or customer return (required)" className="mt-3 w-full rounded-xl border bg-white p-3 text-sm outline-none focus:border-[#d4af45]" />
                  {reason.length > 0 && reason.trim().length < 10 && <p className="mt-1 text-xs text-red-600">Enter at least 10 characters.</p>}
                  <div className="mt-4 flex justify-end gap-2"><button onClick={() => setShowCorrectionForm(false)} className="rounded-xl border bg-white px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={saving || reason.trim().length < 10 || (requestType === 'refund' && !selectedReceipt.items.some((item) => Number(refundLines[item.id]?.quantity || 0) > 0 && Number(refundLines[item.id]?.quantity) <= item.refundable_quantity))} onClick={submitRequest} className="rounded-xl bg-[#d4af45] px-4 py-2.5 text-sm font-bold text-[#071638] disabled:opacity-40">Submit for Approval</button></div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {helpType && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#071638]/70 p-4" role="dialog" aria-modal="true" aria-labelledby="correction-help-title" onMouseDown={() => setHelpType(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[#9a6f1e]">Receipt correction guide</p>
            <h2 id="correction-help-title" className="mt-2 text-xl font-bold text-[#071638]">What is {helpType === 'void' ? 'Void' : 'Refund'}?</h2>
            {helpType === 'void' ? (
              <div className="mt-3 space-y-3 text-sm leading-6 text-gray-600">
                <p><b className="text-[#071638]">Void cancels the entire receipt.</b> Use it when a completed transaction was entered by mistake and the whole sale should not exist.</p>
                <p>After independent approval, the full transaction is reversed and every item returns to inventory. Use Refund instead when only selected products are returned.</p>
              </div>
            ) : (
              <div className="mt-3 space-y-3 text-sm leading-6 text-gray-600">
                <p><b className="text-[#071638]">Refund records a customer return.</b> Use it after a valid sale when one or more products are returned.</p>
                <p>Select the exact product, quantity, and condition. Resellable items return to sellable stock; damaged or expired items are recorded but kept out of sellable inventory.</p>
              </div>
            )}
            <button type="button" onClick={() => setHelpType(null)} className="mt-5 w-full rounded-xl bg-[#071638] px-4 py-3 text-sm font-bold text-white">Got it</button>
          </div>
        </div>
      )}

      {selectedRequest && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#071638]/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6">
            <h2 className="text-xl font-bold text-[#071638]">Review {selectedRequest.request_type} request</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">Confirm the exact returned products below. Only resellable items return to sellable inventory; damaged and expired items remain excluded and audited.</p>
            {selectedRequest.request_type === 'refund' && (
              <div className="mt-4 overflow-hidden rounded-xl border">
                <div className="grid grid-cols-[1fr_55px_110px] bg-[#f7f8fb] px-3 py-2 text-[10px] font-bold uppercase text-gray-500"><span>Product</span><span className="text-center">Qty</span><span>Condition</span></div>
                <div className="divide-y">{selectedRequest.items.map((item, index) => <div key={index} className="grid grid-cols-[1fr_55px_110px] px-3 py-3 text-xs"><b>{item.transaction_item.product_name_snapshot}</b><span className="text-center">{item.quantity}</span><span className="capitalize">{item.disposition}</span></div>)}</div>
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => setDecision('approve')} className={`rounded-xl border p-3 text-sm font-bold ${decision === 'approve' ? 'bg-emerald-700 text-white' : ''}`}>Approve</button><button onClick={() => setDecision('reject')} className={`rounded-xl border p-3 text-sm font-bold ${decision === 'reject' ? 'bg-red-600 text-white' : ''}`}>Reject</button></div>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} maxLength={500} placeholder="Independent review note (required)" className="mt-4 w-full rounded-xl border p-3 text-sm outline-none focus:border-[#d4af45]" />
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setSelectedRequest(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Go Back</button><button disabled={saving || notes.trim().length < 5} onClick={submitDecision} className="rounded-xl bg-[#071638] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40">Confirm Decision</button></div>
          </div>
        </div>
      )}
    </main>
  )
}
