'use client'

import { useState, useEffect, useCallback } from 'react'

interface PaymentMethod {
  id:             string
  type:           string
  account_name:   string
  account_number: string
  bank_name:      string | null
  status:         string
  created_at:     string
  user:           { full_name: string; username: string; role: string }
}

const TYPE_LABEL: Record<string, string> = {
  gcash:         'GCash',
  bank_transfer: 'Bank Transfer',
}

const STATUS_COLOR: Record<string, string> = {
  pending:  'bg-[#fef9ee] text-[#9a6f1e]',
  approved: 'bg-[#e8f7ef] text-[#1a7a4a]',
  rejected: 'bg-[#fdecea] text-[#a03030]',
}

const TYPE_ICON: Record<string, string> = {
  gcash:         '📱',
  bank_transfer: '🏦',
}

export default function AdminPaymentMethodsPage() {
  const [tab, setTab]           = useState<'own' | 'approvals'>('own')
  const [methods, setMethods]   = useState<PaymentMethod[]>([])
  const [loading, setLoading]   = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [acting, setActing]     = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Add method form
  const [showForm, setShowForm]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError]   = useState('')
  const [form, setForm] = useState({
    type:           'gcash',
    account_name:   '',
    account_number: '',
    bank_name:      '',
  })

  const fetchMethods = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      ...(tab === 'approvals' && statusFilter !== 'all' && { status: statusFilter }),
    })
    fetch(`/api/payment-methods?${params}`)
      .then((r) => r.json())
      .then((d) => {
        const all = d.methods || []
        if (tab === 'own') {
          // Only admin's own methods
          setMethods(all.filter((m: PaymentMethod) => m.user?.role === 'admin'))
        } else {
          // Distributor methods (non-admin)
          const dist = all.filter((m: PaymentMethod) => m.user?.role !== 'admin')
          setMethods(statusFilter === 'all' ? dist : dist.filter((m: PaymentMethod) => m.status === statusFilter))
        }
      })
      .finally(() => setLoading(false))
  }, [tab, statusFilter])

  useEffect(() => { fetchMethods() }, [fetchMethods])

  const handleAction = async (id: string, status: 'approved' | 'rejected') => {
    setActing(id)
    await fetch('/api/payment-methods', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id, status }),
    })
    setActing(null)
    fetchMethods()
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    await fetch('/api/payment-methods', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    })
    setDeleting(null)
    fetchMethods()
  }

  const handleSubmit = async () => {
    if (!form.account_name || !form.account_number) {
      setFormError('Please fill in all required fields.'); return
    }
    if (form.type === 'bank_transfer' && !form.bank_name) {
      setFormError('Bank name is required for bank transfer.'); return
    }
    setSubmitting(true); setFormError('')
    const res = await fetch('/api/payment-methods', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) {
      setForm({ type: 'gcash', account_name: '', account_number: '', bank_name: '' })
      setShowForm(false)
      fetchMethods()
    } else {
      setFormError(data.error || 'Something went wrong.')
    }
  }

  const pending  = methods.filter((m) => m.status === 'pending').length
  const approved = methods.filter((m) => m.status === 'approved').length
  const rejected = methods.filter((m) => m.status === 'rejected').length

  return (
    <div className="max-w-4xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Payment Methods</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage your own payment details and approve distributor requests</p>
        </div>
        {tab === 'own' && (
          <button onClick={() => { setShowForm(true); setFormError('') }}
            className="bg-[#C9A84C] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#b8963e] transition-colors font-medium">
            + Add Method
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white rounded-xl border border-[#0D1B3E]/8 p-1 w-fit">
        {([
          { key: 'own',       label: '💳 My Payment Methods' },
          { key: 'approvals', label: '✅ Distributor Approvals' },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setStatusFilter('all') }}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${tab === t.key ? 'bg-[#0D1B3E] text-white' : 'text-gray-400 hover:text-[#0D1B3E]'}`}>
            {t.label}
            {t.key === 'approvals' && pending > 0 && (
              <span className="ml-1.5 bg-[#9a6f1e] text-white text-[9px] px-1.5 py-0.5 rounded-full">{pending}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OWN METHODS TAB ── */}
      {tab === 'own' && (
        <>
          {loading ? (
            <div className="py-12 text-center">
              <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : methods.length === 0 ? (
            <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-12 text-center">
              <p className="text-2xl mb-2">💳</p>
              <p className="text-sm font-medium text-[#0D1B3E]">No payment methods yet</p>
              <p className="text-xs text-gray-400 mt-1">Add your GCash or bank details so distributors can pay you</p>
              <button onClick={() => setShowForm(true)}
                className="mt-4 bg-[#C9A84C] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#b8963e] transition-colors">
                + Add Method
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {methods.map((m) => (
                <div key={m.id} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#F0F2F8] flex items-center justify-center text-lg flex-shrink-0">
                        {TYPE_ICON[m.type]}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-semibold text-[#0D1B3E]">{TYPE_LABEL[m.type]}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLOR[m.status]}`}>
                            {m.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">{m.account_name}</p>
                        <p className="text-xs font-mono text-[#0D1B3E] mt-0.5">{m.account_number}</p>
                        {m.bank_name && <p className="text-xs text-gray-400 mt-0.5">{m.bank_name}</p>}
                      </div>
                    </div>
                    <button onClick={() => handleDelete(m.id)} disabled={deleting === m.id}
                      className="text-[10px] text-[#a03030] hover:underline disabled:opacity-50">
                      {deleting === m.id ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── APPROVALS TAB ── */}
      {tab === 'approvals' && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Pending Review', value: pending,  accent: '#9a6f1e' },
              { label: 'Approved',       value: approved, accent: '#1a7a4a' },
              { label: 'Rejected',       value: rejected, accent: '#e05252' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4"
                style={{ borderTop: `2px solid ${s.accent}` }}>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
                <p className="text-2xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Filter */}
          <div className="flex gap-2 mb-4">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`text-xs px-3 py-1.5 rounded-lg capitalize transition-colors ${
                  statusFilter === f ? 'bg-[#0D1B3E] text-white' : 'bg-white text-gray-400 border border-[#0D1B3E]/10 hover:text-[#0D1B3E]'
                }`}>
                {f}
                {f === 'pending' && pending > 0 && (
                  <span className="ml-1.5 bg-[#9a6f1e] text-white text-[9px] px-1.5 py-0.5 rounded-full">{pending}</span>
                )}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
            <div className="grid px-4 py-2 bg-[#F0F2F8]"
              style={{ gridTemplateColumns: '2fr 1fr 2fr 1fr 1fr' }}>
              {['Distributor', 'Type', 'Account Details', 'Status', 'Actions'].map((h) => (
                <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
              ))}
            </div>

            {loading ? (
              <div className="py-12 text-center">
                <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : methods.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10">No payment methods found.</p>
            ) : (
              methods.map((m) => (
                <div key={m.id} className="grid px-4 py-3 border-b border-[#0D1B3E]/5 items-center hover:bg-[#F0F2F8]/50"
                  style={{ gridTemplateColumns: '2fr 1fr 2fr 1fr 1fr' }}>
                  <div>
                    <p className="text-xs font-medium text-[#0D1B3E]">{m.user.full_name}</p>
                    <p className="text-[10px] text-gray-400">@{m.user.username}</p>
                    <p className="text-[10px] text-gray-300">
                      {new Date(m.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>{TYPE_ICON[m.type]}</span>
                    <span className="text-xs text-[#0D1B3E]">{TYPE_LABEL[m.type]}</span>
                  </div>
                  <div>
                    {m.bank_name && <p className="text-[10px] text-gray-400">{m.bank_name}</p>}
                    <p className="text-xs font-medium text-[#0D1B3E]">{m.account_name}</p>
                    <p className="text-xs font-mono text-gray-500">{m.account_number}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize w-fit ${STATUS_COLOR[m.status]}`}>
                    {m.status}
                  </span>
                  <div className="flex gap-1.5">
                    {m.status === 'pending' && (
                      <>
                        <button onClick={() => handleAction(m.id, 'approved')} disabled={acting === m.id}
                          className="text-[10px] bg-[#e8f7ef] text-[#1a7a4a] px-2.5 py-1.5 rounded-lg hover:bg-[#d4f0e0] disabled:opacity-50 font-medium">
                          ✓ Approve
                        </button>
                        <button onClick={() => handleAction(m.id, 'rejected')} disabled={acting === m.id}
                          className="text-[10px] bg-[#fdecea] text-[#a03030] px-2.5 py-1.5 rounded-lg hover:bg-[#fcd9d9] disabled:opacity-50 font-medium">
                          ✕ Reject
                        </button>
                      </>
                    )}
                    {m.status === 'approved' && (
                      <button onClick={() => handleAction(m.id, 'rejected')} disabled={acting === m.id}
                        className="text-[10px] bg-[#fdecea] text-[#a03030] px-2.5 py-1.5 rounded-lg hover:bg-[#fcd9d9] disabled:opacity-50">
                        Revoke
                      </button>
                    )}
                    {m.status === 'rejected' && (
                      <button onClick={() => handleAction(m.id, 'approved')} disabled={acting === m.id}
                        className="text-[10px] bg-[#e8f7ef] text-[#1a7a4a] px-2.5 py-1.5 rounded-lg hover:bg-[#d4f0e0] disabled:opacity-50">
                        Re-approve
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {/* ── ADD METHOD MODAL ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="bg-[#0D1B3E] px-5 py-4 rounded-t-2xl flex items-center justify-between">
              <h2 className="text-white font-semibold text-sm">Add Payment Method</h2>
              <button onClick={() => setShowForm(false)} className="text-white/50 hover:text-white text-lg">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {/* Type selector */}
              <div>
                <label className="block text-xs text-gray-400 mb-2">Payment Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: 'gcash',         label: 'GCash',         icon: '📱' },
                    { key: 'bank_transfer', label: 'Bank Transfer', icon: '🏦' },
                  ].map((t) => (
                    <button key={t.key} onClick={() => setForm({ ...form, type: t.key })}
                      className={`flex items-center gap-2 px-3 py-3 rounded-xl border-2 transition-colors text-sm ${
                        form.type === t.key
                          ? 'border-[#C9A84C] bg-[#fef9ee] text-[#0D1B3E]'
                          : 'border-[#0D1B3E]/10 text-gray-400 hover:border-[#0D1B3E]/30'
                      }`}>
                      <span>{t.icon}</span>
                      <span className="font-medium">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {form.type === 'bank_transfer' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Bank Name <span className="text-[#C9A84C]">*</span></label>
                  <input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                    placeholder="e.g. BDO, BPI, UnionBank"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-400 mb-1">Account Name <span className="text-[#C9A84C]">*</span></label>
                <input value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                  placeholder="Full name on account"
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  {form.type === 'gcash' ? 'GCash Number' : 'Account Number'} <span className="text-[#C9A84C]">*</span>
                </label>
                <input value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })}
                  placeholder={form.type === 'gcash' ? '09XX XXX XXXX' : 'Account number'}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
              </div>

              {formError && <p className="text-xs text-[#a03030]">{formError}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0]">
                  Cancel
                </button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex-1 bg-[#C9A84C] text-white text-sm rounded-lg py-2.5 hover:bg-[#b8963e] disabled:opacity-50 font-medium">
                  {submitting ? 'Adding...' : 'Add Method'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}