'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

interface PinRequest {
  id:                  string
  quantity:            number
  total_amount:        number
  payment_method:      string
  payment_reference:   string | null
  payment_sender_name: string | null
  payment_datetime:    string | null
  payment_status:      string
  payment_due_at:      string | null
  payment_method_id:   string | null
  payment_destination_snapshot: PaymentMethod | null
  payment_evidence: Array<{ id: string; status: string; review_notes: string | null }>
  status:              string
  notes:               string | null
  created_at:          string
  package: { id: string; name: string; price: number } | null
}

interface Package {
  id:    string
  name:  string
  price: number
}

interface PaymentMethod {
  id:             string
  type:           string
  account_name:   string
  account_number: string
  bank_name:      string | null
}

interface PinTransfer {
  id: string
  reference_number: string
  quantity: number
  reference_value: number
  sale_value: number
  status: string
  created_at: string
  package: { id: string; name: string } | null
  sender: { full_name: string; username: string } | null
}

const PAGE_SIZE = 15

const STATUS_COLOR: Record<string, string> = {
  pending:  'bg-[#fef9ee] text-[#9a6f1e]',
  approved: 'bg-[#e8f7ef] text-[#1a7a4a]',
  rejected: 'bg-[#fdecea] text-[#a03030]',
  expired:  'bg-gray-100 text-gray-500',
}

const PAYMENT_LABEL: Record<string, string> = {
  cash_on_pickup: '💵 Cash on Pickup',
  gcash:          '📱 GCash',
  bank_transfer:  '🏦 Bank Transfer',
}

export default function CityPinRequestsPage() {
  const [clock, setClock] = useState(() => Date.now())
  const [requests, setRequests]   = useState<PinRequest[]>([])
  const [packages, setPackages]   = useState<Package[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [meta, setMeta]           = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]     = useState(true)
  const [summary, setSummary]     = useState({ total: 0, pending: 0, approved: 0, rejected: 0 })
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage]           = useState(1)
  const [showForm, setShowForm]   = useState(false)
  const [isBranch, setIsBranch]   = useState(false)
  const [transfers, setTransfers] = useState<PinTransfer[]>([])
  const [transferLoading, setTransferLoading] = useState(false)
  const [resolvingTransfer, setResolvingTransfer] = useState<string | null>(null)
  const [transferError, setTransferError] = useState('')

  // Form
  const [form, setForm] = useState({
    package_id:          '',
    quantity:            1,
    payment_method_id:   '',
    notes:               '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError]   = useState('')
  const [formSuccess, setFormSuccess] = useState('')
  const [payingRequest, setPayingRequest] = useState<PinRequest | null>(null)
  const [paymentForm, setPaymentForm] = useState({ sender_name: '', reference_number: '', paid_at: '', proof_data: '', proof_name: '' })

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const timeRemaining = (dueAt: string) => {
    const seconds = Math.max(0, Math.floor((new Date(dueAt).getTime() - clock) / 1000))
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainder = seconds % 60
    return `${hours}h ${minutes}m ${remainder}s remaining`
  }

  // Mark as seen when page is visited — clears the notification badge
  useEffect(() => {
    fetch('/api/pin-requests?status=approved&pageSize=1')
      .then((r) => r.json())
      .then((d) => {
        const total = d.summary?.approved || 0
        localStorage.setItem('pin_requests_last_seen', String(total))
      })
      .catch(() => {})
  }, [])

  const fetchTransfers = useCallback(() => {
    setTransferLoading(true)
    fetch('/api/pin-transfers?status=all&pageSize=50', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setTransfers(data.transfers || []))
      .finally(() => setTransferLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const branch = data.user?.distributor_profile?.dist_level === 'branch'
        setIsBranch(branch)
        if (branch) fetchTransfers()
      })
      .catch(() => {})
  }, [fetchTransfers])

  useEffect(() => { setPage(1) }, [statusFilter])

  const fetchRequests = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page:     String(page),
      pageSize: String(PAGE_SIZE),
      status:   statusFilter,
    })
    fetch(`/api/pin-requests?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setRequests(d.requests || [])
        setMeta(d.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
        if (d.summary) setSummary(d.summary)
      })
      .finally(() => setLoading(false))
  }, [page, statusFilter])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  useEffect(() => {
    // Fetch packages and admin payment methods
    Promise.all([
      fetch('/api/city/packages').then((r) => r.json()),
      fetch('/api/payment-methods?role=admin&status=approved').then((r) => r.json()),
    ]).then(([pkgData, pmData]) => {
      setPackages(pkgData.packages || [])
      setPaymentMethods(pmData.methods || [])
      console.log('[PIN REQUEST] payment methods loaded:', pmData.methods?.length, pmData.methods)
    })
  }, [])

  const selectedPkg = packages.find((p) => p.id === form.package_id)
  const totalAmount = selectedPkg ? selectedPkg.price * form.quantity : 0

  const handleSubmit = async () => {
    if (!form.package_id) { setFormError('Please select a package.'); return }
    if (form.quantity < 1) { setFormError('Quantity must be at least 1.'); return }
    if (!form.payment_method_id) { setFormError('Please select where you will send the payment.'); return }

    setSubmitting(true); setFormError('')
    const res = await fetch('/api/pin-requests', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        package_id:          form.package_id,
        quantity:            form.quantity,
        payment_method_id:   form.payment_method_id,
        notes:               form.notes.trim()               || null,
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) {
      setFormSuccess('PIN request reserved. Pay and upload proof within 48 hours.')
      fetchRequests()
      setTimeout(() => {
        setShowForm(false)
        setFormSuccess('')
        setForm({ package_id: '', quantity: 1, payment_method_id: '', notes: '' })
      }, 1500)
    } else {
      setFormError(data.error || 'Something went wrong.')
    }
  }

  const chooseProof = (file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setFormError('Use a valid JPEG, PNG, or WebP image up to 5 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setPaymentForm((current) => ({ ...current, proof_data: String(reader.result || ''), proof_name: file.name }))
    reader.readAsDataURL(file)
  }

  const submitPayment = async () => {
    if (!payingRequest) return
    setSubmitting(true); setFormError('')
    const response = await fetch(`/api/pin-requests/${payingRequest.id}/payment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paymentForm),
    })
    const data = await response.json()
    setSubmitting(false)
    if (!response.ok) { setFormError(data.error || 'Unable to submit payment proof.'); return }
    setPayingRequest(null)
    setPaymentForm({ sender_name: '', reference_number: '', paid_at: '', proof_data: '', proof_name: '' })
    fetchRequests()
  }

  const resolveTransfer = async (transfer: PinTransfer, action: 'received' | 'rejected') => {
    const reason = action === 'rejected'
      ? window.prompt(`Reason for rejecting ${transfer.reference_number}:`)?.trim() || ''
      : ''
    if (action === 'rejected' && reason.length < 3) return
    if (action === 'received' && !window.confirm(
      `Receive all ${transfer.quantity} PINs under ${transfer.reference_number}? This makes the complete batch usable by this Branch.`,
    )) return
    setResolvingTransfer(transfer.id)
    setTransferError('')
    const response = await fetch(`/api/pin-transfers/${transfer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason }),
    })
    const data = await response.json()
    setResolvingTransfer(null)
    if (!response.ok) {
      setTransferError(data.error || 'Unable to resolve PIN transfer.')
      return
    }
    fetchTransfers()
  }

  return (
    <div className="max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">PIN Requests</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {isBranch ? 'Receive zero-revenue PIN transfers from Hiroma Admin' : 'Request paid PINs from admin and track your orders'}
          </p>
        </div>
        {!isBranch && <button onClick={() => setShowForm(true)}
          className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors">
          + Request PINs
        </button>}
      </div>

      {isBranch && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-[#0D1B3E]/8">
            <h2 className="text-sm font-semibold text-[#0D1B3E]">Incoming PIN Transfers</h2>
            <p className="text-xs text-gray-400 mt-0.5">Internal transfer only: ₱0 sale. PINs stay unusable until the complete batch is received.</p>
          </div>
          {transferError && <p className="m-4 text-xs text-[#a03030] bg-[#fdecea] px-3 py-2 rounded-lg">{transferError}</p>}
          {transferLoading ? (
            <p className="px-4 py-8 text-sm text-gray-400 text-center">Loading transfers...</p>
          ) : transfers.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-400 text-center">No PIN transfers yet.</p>
          ) : transfers.map((transfer) => (
            <div key={transfer.id} className="grid grid-cols-[1.3fr_1fr_1fr_1.2fr] gap-3 px-4 py-3 border-b border-[#0D1B3E]/5 items-center">
              <div>
                <p className="text-xs font-semibold text-[#0D1B3E]">{transfer.reference_number}</p>
                <p className="text-[10px] text-gray-400">{transfer.package?.name || 'Package'} · {new Date(transfer.created_at).toLocaleString('en-PH')}</p>
              </div>
              <div>
                <p className="text-xs text-[#0D1B3E]">{transfer.quantity} PINs</p>
                <p className="text-[10px] text-gray-400">Reference ₱{Number(transfer.reference_value).toLocaleString()} · Sale ₱0</p>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full w-fit ${transfer.status === 'received' ? 'bg-[#e8f7ef] text-[#1a7a4a]' : transfer.status === 'rejected' ? 'bg-[#fdecea] text-[#a03030]' : 'bg-[#fef9ee] text-[#9a6f1e]'}`}>
                {transfer.status.replace('_', ' ')}
              </span>
              <div className="flex gap-1.5 justify-end">
                {transfer.status === 'in_transit' && (
                  <>
                    <button onClick={() => resolveTransfer(transfer, 'received')} disabled={resolvingTransfer === transfer.id}
                      className="text-[10px] bg-[#010521] text-white px-2 py-1.5 rounded-lg disabled:opacity-50">Receive all</button>
                    <button onClick={() => resolveTransfer(transfer, 'rejected')} disabled={resolvingTransfer === transfer.id}
                      className="text-[10px] bg-[#fdecea] text-[#a03030] px-2 py-1.5 rounded-lg disabled:opacity-50">Reject</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',    value: summary.total,    accent: '#0D1B3E' },
          { label: 'Pending',  value: summary.pending,  accent: '#9a6f1e' },
          { label: 'Approved', value: summary.approved, accent: '#1a7a4a' },
          { label: 'Rejected', value: summary.rejected, accent: '#e05252' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
            style={{ borderTop: `2px solid ${s.accent}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8">

        {/* Filters */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#0D1B3E]/8">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${statusFilter === f ? 'bg-[#010521] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'}`}>
              {f}
            </button>
          ))}
        </div>

        {/* Header */}
        <div className="grid grid-cols-5 px-4 py-2 bg-[#F0F2F8]">
          {['Package', 'Qty / Amount', 'Payment', 'Status', 'Date'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {/* Rows */}
        {loading ? (
          <div className="py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : requests.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-gray-400 text-sm">No PIN requests yet.</p>
            {!isBranch && <button onClick={() => setShowForm(true)} className="text-xs text-[#C9A84C] hover:underline mt-1">
              Submit your first request →
            </button>}
          </div>
        ) : (
          requests.map((r) => (
            <div key={r.id} className="grid grid-cols-5 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 items-center">
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{r.package?.name || '—'}</p>
                <p className="text-[10px] text-gray-400">₱{Number(r.package?.price || 0).toLocaleString()} / PIN</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#0D1B3E]">{r.quantity} PINs</p>
                <p className="text-xs text-[#C9A84C]">₱{Number(r.total_amount).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500">{PAYMENT_LABEL[r.payment_method] || r.payment_method}</p>
                {r.payment_reference    && <p className="text-[10px] text-gray-400">Ref: {r.payment_reference}</p>}
                {r.payment_sender_name  && <p className="text-[10px] text-gray-400">Sender: {r.payment_sender_name}</p>}
                {r.payment_datetime     && <p className="text-[10px] text-gray-400">{new Date(r.payment_datetime).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
                {r.payment_status === 'paid'
                  ? <span className="text-[10px] text-[#1a7a4a] font-medium">✓ Paid</span>
                  : r.payment_method === 'cash_on_pickup'
                  ? <span className="text-[10px] text-gray-400">Pay on pickup</span>
                  : <span className="text-[10px] text-[#9a6f1e]">⏳ Awaiting payment confirmation</span>}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full w-fit capitalize ${STATUS_COLOR[r.status]}`}>
                {r.status}
              </span>
              <div><p className="text-xs text-gray-400">
                {new Date(r.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              {r.status === 'pending' && ['awaiting_payment', 'payment_rejected'].includes(r.payment_status) && r.payment_due_at && (
                <div>
                  <p className="mt-1 text-[10px] font-medium text-amber-700">{timeRemaining(r.payment_due_at)}</p>
                  <p className="text-[9px] text-gray-400">Due {new Date(r.payment_due_at).toLocaleString('en-PH')}</p>
                  <button onClick={() => { setFormError(''); setPayingRequest(r) }} className="mt-1 rounded bg-[#010521] px-2 py-1 text-[10px] font-semibold text-white">Pay now / Upload proof</button>
                </div>
              )}
              </div>
            </div>
          ))
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* Request Modal */}
      {showForm && !isBranch && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="bg-[#010521] px-5 py-4 flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">Request PINs</h2>
              <button onClick={() => setShowForm(false)} className="text-white/50 hover:text-white text-lg">✕</button>
            </div>
            <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">

              {/* Package */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Package <span className="text-[#C9A84C]">*</span></label>
                <select value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
                  <option value="">Select package</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — ₱{Number(p.price).toLocaleString()}</option>
                  ))}
                </select>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Quantity <span className="text-[#C9A84C]">*</span></label>
                <input type="number" min={1} value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
              </div>

              {/* Total */}
              {totalAmount > 0 && (
                <div className="bg-[#fef9ee] border border-[#C9A84C]/20 rounded-xl px-4 py-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">{form.quantity} PINs × ₱{Number(selectedPkg?.price || 0).toLocaleString()}</span>
                    <span className="font-bold text-[#C9A84C]">₱{totalAmount.toLocaleString()}</span>
                  </div>
                </div>
              )}

              {/* Payment method */}
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Payment Method</p>
                <div className="space-y-1.5">
                  {paymentMethods.map((pm) => (
                    <div key={pm.id} onClick={() => setForm({ ...form, payment_method_id: pm.id })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer ${form.payment_method_id === pm.id ? 'border-[#C9A84C] bg-[#fef9ee]' : 'border-[#0D1B3E]/10 hover:border-[#0D1B3E]/20'}`}>
                      <span>{pm.type === 'gcash' ? '📱' : '🏦'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#0D1B3E]">{pm.type === 'gcash' ? 'GCash' : 'Bank Transfer'}</p>
                        {pm.bank_name && <p className="text-[9px] text-gray-400">{pm.bank_name}</p>}
                        <p className="text-[9px] text-gray-400">{pm.account_name} · {pm.account_number}</p>
                      </div>
                      {form.payment_method_id === pm.id && <span className="text-[#C9A84C] text-xs flex-shrink-0">✓</span>}
                    </div>
                  ))}
                </div>
                {paymentMethods.length === 0 && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">No active Hiroma payment destination is available. Please contact Admin.</p>}
                <p className="mt-2 text-[10px] text-gray-500">Your 48-hour payment window starts after the request is created.</p>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Notes (optional)</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2} placeholder="Any special instructions..."
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-xs outline-none focus:border-[#C9A84C] resize-none" />
              </div>

              {formError   && <p className="text-xs text-[#a03030] bg-[#fdecea] px-3 py-2 rounded-lg">{formError}</p>}
              {formSuccess && <p className="text-xs text-[#1a7a4a] bg-[#e8f7ef] px-3 py-2 rounded-lg">✓ {formSuccess}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0]">
                  Cancel
                </button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] disabled:opacity-50">
                  {submitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {payingRequest && !isBranch && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-base font-semibold text-[#0D1B3E]">Submit payment proof</h2>
            <p className="mt-1 text-xs text-gray-500">Request expires {payingRequest.payment_due_at ? new Date(payingRequest.payment_due_at).toLocaleString('en-PH') : 'after 48 hours'}.</p>
            {payingRequest.payment_destination_snapshot && <div className="mt-3 rounded-xl border border-[#C9A84C]/30 bg-[#fffaf0] p-3 text-xs"><b>{payingRequest.payment_destination_snapshot.type === 'gcash' ? 'GCash' : payingRequest.payment_destination_snapshot.bank_name || 'Bank transfer'}</b><p>{payingRequest.payment_destination_snapshot.account_name}</p><p className="font-mono font-semibold">{payingRequest.payment_destination_snapshot.account_number}</p><p className="mt-1 font-bold">Amount: ₱{Number(payingRequest.total_amount).toLocaleString()}</p></div>}
            <div className="mt-4 space-y-2">
              <input value={paymentForm.sender_name} onChange={(e) => setPaymentForm({ ...paymentForm, sender_name: e.target.value })} placeholder="Sender name" maxLength={160} className="w-full rounded-lg border px-3 py-2 text-sm" />
              <input value={paymentForm.reference_number} onChange={(e) => setPaymentForm({ ...paymentForm, reference_number: e.target.value })} placeholder="Transaction reference number" maxLength={160} className="w-full rounded-lg border px-3 py-2 text-sm" />
              <input type="datetime-local" value={paymentForm.paid_at} onChange={(e) => setPaymentForm({ ...paymentForm, paid_at: e.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" />
              <label className="block rounded-lg border border-dashed border-[#C9A84C] p-3 text-xs"><span>Payment proof · JPEG, PNG, or WebP · max 5 MB</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => chooseProof(e.target.files?.[0])} className="mt-2 block w-full" />{paymentForm.proof_name && <b className="mt-1 block text-green-700">✓ {paymentForm.proof_name}</b>}</label>
            </div>
            {formError && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{formError}</p>}
            <div className="mt-4 flex gap-2"><button onClick={() => setPayingRequest(null)} className="flex-1 rounded-lg border py-2 text-sm">Cancel</button><button disabled={submitting || !paymentForm.proof_data} onClick={submitPayment} className="flex-1 rounded-lg bg-[#C9A84C] py-2 text-sm font-semibold disabled:opacity-40">{submitting ? 'Submitting…' : 'Submit proof'}</button></div>
          </div>
        </div>
      )}

    </div>
  )
}
