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

const PAGE_SIZE = 15

const STATUS_COLOR: Record<string, string> = {
  pending:  'bg-[#fef9ee] text-[#9a6f1e]',
  approved: 'bg-[#e8f7ef] text-[#1a7a4a]',
  rejected: 'bg-[#fdecea] text-[#a03030]',
}

const PAYMENT_LABEL: Record<string, string> = {
  cash_on_pickup: '💵 Cash on Pickup',
  gcash:          '📱 GCash',
  bank_transfer:  '🏦 Bank Transfer',
}

export default function CityPinRequestsPage() {
  const [requests, setRequests]   = useState<PinRequest[]>([])
  const [packages, setPackages]   = useState<Package[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [meta, setMeta]           = useState<PaginationMeta>({ total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
  const [loading, setLoading]     = useState(true)
  const [summary, setSummary]     = useState({ total: 0, pending: 0, approved: 0, rejected: 0 })
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage]           = useState(1)
  const [showForm, setShowForm]   = useState(false)

  // Form
  const [form, setForm] = useState({
    package_id:          '',
    quantity:            1,
    payment_method:      'cash_on_pickup',
    payment_reference:   '',
    payment_sender_name: '',
    payment_datetime:    '',
    notes:               '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError]   = useState('')
  const [formSuccess, setFormSuccess] = useState('')

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
      setPackages(pkgData.packages || [])  // already filtered active on server
      // Get admin's approved payment methods for city dist to pay to
      const adminUser = pmData.methods?.find((m: any) => m.user?.role === 'admin')
      setPaymentMethods(pmData.methods?.filter((m: any) => m.user?.role === 'admin') || [])
    })
  }, [])

  const selectedPkg = packages.find((p) => p.id === form.package_id)
  const totalAmount = selectedPkg ? selectedPkg.price * form.quantity : 0

  const handleSubmit = async () => {
    if (!form.package_id) { setFormError('Please select a package.'); return }
    if (form.quantity < 1) { setFormError('Quantity must be at least 1.'); return }
    if (form.payment_method !== 'cash_on_pickup') {
      if (!form.payment_reference.trim()) { setFormError('Please enter payment reference.'); return }
      if (!form.payment_sender_name.trim()) { setFormError('Please enter sender name.'); return }
      if (!form.payment_datetime) { setFormError('Please enter payment date and time.'); return }
    }

    setSubmitting(true); setFormError('')
    const res = await fetch('/api/pin-requests', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        package_id:          form.package_id,
        quantity:            form.quantity,
        payment_method:      form.payment_method,
        payment_reference:   form.payment_reference.trim()   || null,
        payment_sender_name: form.payment_sender_name.trim() || null,
        payment_datetime:    form.payment_datetime           || null,
        notes:               form.notes.trim()               || null,
      }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) {
      setFormSuccess('PIN request submitted successfully!')
      fetchRequests()
      setTimeout(() => {
        setShowForm(false)
        setFormSuccess('')
        setForm({ package_id: '', quantity: 1, payment_method: 'cash_on_pickup', payment_reference: '', payment_sender_name: '', payment_datetime: '', notes: '' })
      }, 1500)
    } else {
      setFormError(data.error || 'Something went wrong.')
    }
  }

  return (
    <div className="max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">PIN Requests</h1>
          <p className="text-sm text-gray-400 mt-0.5">Request PINs from admin and track your orders</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors">
          + Request PINs
        </button>
      </div>

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
              className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${statusFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-[#F0F2F8] text-gray-400 hover:text-[#0D1B3E]'}`}>
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
            <button onClick={() => setShowForm(true)} className="text-xs text-[#C9A84C] hover:underline mt-1">
              Submit your first request →
            </button>
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
                  : <span className="text-[10px] text-[#9a6f1e]">⏳ Awaiting confirmation</span>}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full w-fit capitalize ${STATUS_COLOR[r.status]}`}>
                {r.status}
              </span>
              <p className="text-xs text-gray-400">
                {new Date(r.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          ))
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* Request Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="bg-[#0D1B3E] px-5 py-4 flex items-center justify-between">
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
                  <div onClick={() => setForm({ ...form, payment_method: 'cash_on_pickup', payment_reference: '', payment_sender_name: '', payment_datetime: '' })}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer ${form.payment_method === 'cash_on_pickup' ? 'border-[#C9A84C] bg-[#fef9ee]' : 'border-[#0D1B3E]/10 hover:border-[#0D1B3E]/20'}`}>
                    <span>💵</span>
                    <p className="text-xs font-medium text-[#0D1B3E] flex-1">Cash on Pickup</p>
                    {form.payment_method === 'cash_on_pickup' && <span className="text-[#C9A84C] text-xs">✓</span>}
                  </div>
                  {paymentMethods.map((pm) => (
                    <div key={pm.id} onClick={() => setForm({ ...form, payment_method: pm.type })}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer ${form.payment_method === pm.type ? 'border-[#C9A84C] bg-[#fef9ee]' : 'border-[#0D1B3E]/10 hover:border-[#0D1B3E]/20'}`}>
                      <span>{pm.type === 'gcash' ? '📱' : '🏦'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[#0D1B3E]">{pm.type === 'gcash' ? 'GCash' : 'Bank Transfer'}</p>
                        {pm.bank_name && <p className="text-[9px] text-gray-400">{pm.bank_name}</p>}
                        <p className="text-[9px] text-gray-400">{pm.account_name} · {pm.account_number}</p>
                      </div>
                      {form.payment_method === pm.type && <span className="text-[#C9A84C] text-xs flex-shrink-0">✓</span>}
                    </div>
                  ))}
                </div>
                {form.payment_method !== 'cash_on_pickup' && (
                  <div className="mt-2 space-y-1.5">
                    <input value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })}
                      placeholder="Reference number *"
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#C9A84C]" />
                    <input value={form.payment_sender_name} onChange={(e) => setForm({ ...form, payment_sender_name: e.target.value })}
                      placeholder="Sender name *"
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#C9A84C]" />
                    <input type="datetime-local" value={form.payment_datetime} onChange={(e) => setForm({ ...form, payment_datetime: e.target.value })}
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-[#C9A84C] text-gray-500" />
                  </div>
                )}
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

    </div>
  )
}