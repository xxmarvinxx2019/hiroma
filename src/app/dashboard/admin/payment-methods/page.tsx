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
  const [methods, setMethods]       = useState<PaymentMethod[]>([])
  const [loading, setLoading]       = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [acting, setActing]         = useState<string | null>(null)

  const fetchMethods = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ ...(statusFilter !== 'all' && { status: statusFilter }) })
    fetch(`/api/payment-methods?${params}`)
      .then((r) => r.json())
      .then((d) => setMethods(d.methods || []))
      .finally(() => setLoading(false))
  }, [statusFilter])

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

  const pending  = methods.filter((m) => m.status === 'pending').length
  const approved = methods.filter((m) => m.status === 'approved').length
  const rejected = methods.filter((m) => m.status === 'rejected').length

  return (
    <div className="max-w-4xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Payment Method Approvals</h1>
        <p className="text-sm text-gray-400 mt-0.5">Review and approve city distributor payment details</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
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
              {/* Distributor */}
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{m.user.full_name}</p>
                <p className="text-[10px] text-gray-400">@{m.user.username}</p>
                <p className="text-[10px] text-gray-300">
                  {new Date(m.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
              {/* Type */}
              <div className="flex items-center gap-1.5">
                <span>{TYPE_ICON[m.type]}</span>
                <span className="text-xs text-[#0D1B3E]">{TYPE_LABEL[m.type]}</span>
              </div>
              {/* Account details */}
              <div>
                {m.bank_name && <p className="text-[10px] text-gray-400">{m.bank_name}</p>}
                <p className="text-xs font-medium text-[#0D1B3E]">{m.account_name}</p>
                <p className="text-xs font-mono text-gray-500">{m.account_number}</p>
              </div>
              {/* Status */}
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize w-fit ${STATUS_COLOR[m.status]}`}>
                {m.status}
              </span>
              {/* Actions */}
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
    </div>
  )
}