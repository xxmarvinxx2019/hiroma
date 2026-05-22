'use client'

import { useState, useEffect } from 'react'

interface PaymentMethod {
  id:             string
  type:           string
  account_name:   string
  account_number: string
  bank_name:      string | null
  status:         string
  created_at:     string
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

export default function CityPaymentMethodsPage() {
  const [methods, setMethods]       = useState<PaymentMethod[]>([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [success, setSuccess]       = useState('')
  const [deleting, setDeleting]     = useState<string | null>(null)

  const [form, setForm] = useState({
    type:           'gcash',
    account_name:   '',
    account_number: '',
    bank_name:      '',
  })

  const fetchMethods = () => {
    setLoading(true)
    fetch('/api/payment-methods')
      .then((r) => r.json())
      .then((d) => setMethods(d.methods || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchMethods() }, [])

  const resetForm = () => setForm({ type: 'gcash', account_name: '', account_number: '', bank_name: '' })

  const handleSubmit = async () => {
    if (!form.account_name || !form.account_number) {
      setError('Please fill in all required fields.')
      return
    }
    setSubmitting(true); setError(''); setSuccess('')
    const res = await fetch('/api/payment-methods', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    })
    const data = await res.json()
    setSubmitting(false)
    if (res.ok) {
      setSuccess('Payment method submitted for admin approval.')
      resetForm()
      setShowForm(false)
      fetchMethods()
    } else {
      setError(data.error || 'Something went wrong.')
    }
  }

  const handleDelete = async (id: string) => {
    setDeleting(id)
    const res = await fetch('/api/payment-methods', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    })
    setDeleting(null)
    if (res.ok) fetchMethods()
  }

  return (
    <div className="max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">Payment Methods</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Register your GCash or bank details — resellers will use these to pay for orders
          </p>
        </div>
        <button onClick={() => { setShowForm(true); setError(''); setSuccess('') }}
          className="bg-[#C9A84C] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#b8963e] transition-colors font-medium">
          + Add Method
        </button>
      </div>

      {success && (
        <div className="mb-4 bg-[#e8f7ef] text-[#1a7a4a] text-sm px-4 py-3 rounded-xl border border-[#1a7a4a]/15">
          ✓ {success}
        </div>
      )}

      {/* Info banner */}
      <div className="mb-6 bg-[#f0f7ff] border border-[#2563eb]/15 rounded-xl p-4">
        <p className="text-xs text-[#2563eb] font-medium mb-1">ℹ How it works</p>
        <p className="text-xs text-gray-500">
          Submit your GCash or bank details below. Admin will review and approve them.
          Once approved, resellers ordering from you can select these as payment options.
          Cash on pickup is always available by default.
        </p>
      </div>

      {/* Methods list */}
      {loading ? (
        <div className="text-center py-12">
          <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : methods.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/8 p-12 text-center">
          <p className="text-2xl mb-2">💳</p>
          <p className="text-sm font-medium text-[#0D1B3E]">No payment methods yet</p>
          <p className="text-xs text-gray-400 mt-1">Add your GCash or bank details to accept payments from resellers</p>
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
                    {m.bank_name && (
                      <p className="text-xs text-gray-400 mt-0.5">{m.bank_name}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <p className="text-[10px] text-gray-400">
                    {new Date(m.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                  {m.status !== 'approved' && (
                    <button
                      onClick={() => handleDelete(m.id)}
                      disabled={deleting === m.id}
                      className="text-[10px] text-[#a03030] hover:underline disabled:opacity-50"
                    >
                      {deleting === m.id ? 'Removing...' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>
              {m.status === 'pending' && (
                <div className="mt-3 pt-3 border-t border-[#0D1B3E]/5">
                  <p className="text-[10px] text-[#9a6f1e]">⏳ Waiting for admin approval before resellers can use this method</p>
                </div>
              )}
              {m.status === 'rejected' && (
                <div className="mt-3 pt-3 border-t border-[#0D1B3E]/5">
                  <p className="text-[10px] text-[#a03030]">✕ This method was rejected. Please remove and resubmit with correct details.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Method Modal */}
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
                    { key: 'gcash', label: 'GCash', icon: '📱' },
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
                <label className="block text-xs text-gray-400 mb-1">
                  {form.type === 'gcash' ? 'GCash' : 'Account'} Name <span className="text-[#C9A84C]">*</span>
                </label>
                <input value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                  placeholder="Full name registered on account"
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

              {error && <p className="text-xs text-[#a03030]">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors">
                  Cancel
                </button>
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex-1 bg-[#C9A84C] text-white text-sm rounded-lg py-2.5 hover:bg-[#b8963e] transition-colors disabled:opacity-50 font-medium">
                  {submitting ? 'Submitting...' : 'Submit for Approval'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}