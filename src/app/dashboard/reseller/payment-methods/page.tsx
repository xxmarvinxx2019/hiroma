'use client'

import { useCallback, useEffect, useState } from 'react'
import SecurityPinModal from '@/app/components/ui/SecurityPinModal'

type Mode = 'cash' | 'check' | 'account'
type Method = {
  id: string
  type: string
  account_name: string
  account_number: string
  bank_name: string | null
  status: string
}

export default function ResellerPaymentMethodsPage() {
  const [mode, setMode] = useState<Mode>('cash')
  const [methods, setMethods] = useState<Method[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [registeredName, setRegisteredName] = useState('')
  const [form, setForm] = useState({ type: 'gcash', account_name: '', account_number: '', bank_name: '' })
  const [securityPinEnabled, setSecurityPinEnabled] = useState(false)
  const [pinAction, setPinAction] = useState<'submit' | 'remove' | null>(null)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [policyRes, methodsRes] = await Promise.all([
      fetch('/api/reseller/payment-policy'),
      fetch('/api/payment-methods'),
    ])
    const policy = await policyRes.json()
    const methodData = await methodsRes.json()
    setMode(policy.mode || 'cash')
    setMethods(methodData.methods || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('/api/reseller/payment-policy').then((r) => r.json()),
      fetch('/api/payment-methods').then((r) => r.json()),
      fetch('/api/auth/me').then((r) => r.json()),
      fetch('/api/reseller/security-pin').then((r) => r.json()),
    ]).then(([policy, methodData, authData, securityData]) => {
      setMode(policy.mode || 'cash')
      setMethods(methodData.methods || [])
      setRegisteredName(authData.user?.full_name || '')
      setSecurityPinEnabled(Boolean(securityData.enabled))
      setLoading(false)
    })
  }, [])

  const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-PH')
  const accountNameMatches = Boolean(
    registeredName && normalizeName(form.account_name) === normalizeName(registeredName)
  )
  const gcashNumberValid = form.type !== 'gcash' || /^09\d{9}$/.test(form.account_number)

  const submitPaymentMethod = async (securityPin = ''): Promise<string | null> => {
    setSaving(true)
    const res = await fetch('/api/payment-methods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, security_pin: securityPin }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) return data.error || 'Unable to save payment method.'

    setMessage('Payment method submitted for admin approval.')
    setForm({ type: 'gcash', account_name: '', account_number: '', bank_name: '' })
    setPinAction(null)
    load()
    return null
  }

  const submit = async () => {
    setMessage('')
    if (!form.account_name || !form.account_number || (form.type === 'bank_transfer' && !form.bank_name)) {
      setMessage('Please complete all required account details.')
      return
    }
    if (!accountNameMatches) {
      setMessage('Account holder name must exactly match your registered Hiroma full name.')
      return
    }
    if (!gcashNumberValid) {
      setMessage('GCash mobile number must contain exactly 11 digits and start with 09.')
      return
    }
    if (securityPinEnabled) {
      setPinAction('submit')
      return
    }
    const error = await submitPaymentMethod()
    if (error) setMessage(error)
  }

  const removePaymentMethod = async (id: string, securityPin = ''): Promise<string | null> => {
    setSaving(true)
    const res = await fetch('/api/payment-methods', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, security_pin: securityPin }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) return data.error || 'Unable to remove payment method.'

    setPendingRemoveId(null)
    setPinAction(null)
    load()
    return null
  }

  const remove = async (id: string) => {
    if (securityPinEnabled) {
      setPendingRemoveId(id)
      setPinAction('remove')
      return
    }
    await removePaymentMethod(id)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Payment Method</h1>
        <p className="text-sm text-gray-400 mt-1">Manage where your approved payouts will be released.</p>
      </div>

      <div className="bg-white rounded-xl border border-[#0D1B3E]/10 p-5">
        <p className="text-xs text-gray-400 uppercase tracking-wide">Current payout policy</p>
        <p className="text-lg font-semibold text-[#0D1B3E] mt-1">
          {mode === 'cash' ? 'Cash release' : mode === 'check' ? 'Check release' : 'Approved payout account'}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {mode === 'account'
            ? 'Add your GCash or bank account below. It must be approved by Admin before it can receive a payout.'
            : `Admin currently requires reseller payouts to be released by ${mode}. Account submission is temporarily disabled.`}
        </p>
      </div>

      {mode === 'account' && (
        <div className="bg-white rounded-xl border border-[#0D1B3E]/10 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-[#0D1B3E]">Add payout account</h2>
          <div className="rounded-xl border border-[#C9A84C]/40 bg-[#fef9ee] px-4 py-3">
            <p className="text-xs font-semibold text-[#7a5717]">Important payout account requirement</p>
            <p className="text-xs text-[#7a5717]/80 mt-1 leading-relaxed">
              Use only your own GCash or bank account. The account holder name must match your registered
              Hiroma name, and the account number must belong to that same name and selected bank. Incorrect
              or third-party details will not be accepted and may cause payout delays.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm">
              <option value="gcash">GCash</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
            {form.type === 'bank_transfer' && (
              <input placeholder="Bank name (e.g. BDO, UnionBank)" value={form.bank_name}
                onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                className="bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm" />
            )}
            <div>
              <input placeholder="Account holder name" value={form.account_name}
                onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                className={`w-full bg-[#F0F2F8] border rounded-lg px-3 py-2 text-sm ${
                  form.account_name && !accountNameMatches ? 'border-red-400' : 'border-[#0D1B3E]/15'
                }`} />
              <p className={`text-[10px] mt-1 ${form.account_name && !accountNameMatches ? 'text-red-500' : 'text-gray-400'}`}>
                Must match your registered name: {registeredName || 'Loading...'}
              </p>
            </div>
            <div>
              <input
                type={form.type === 'gcash' ? 'tel' : 'text'}
                inputMode={form.type === 'gcash' ? 'numeric' : undefined}
                maxLength={form.type === 'gcash' ? 11 : undefined}
                placeholder={form.type === 'gcash' ? 'GCash number (09XXXXXXXXX)' : 'Bank account number'}
                value={form.account_number}
                onChange={(e) => setForm({
                  ...form,
                  account_number: form.type === 'gcash'
                    ? e.target.value.replace(/\D/g, '').slice(0, 11)
                    : e.target.value,
                })}
                className={`w-full bg-[#F0F2F8] border rounded-lg px-3 py-2 text-sm ${
                  form.type === 'gcash' && form.account_number && !gcashNumberValid
                    ? 'border-red-400'
                    : 'border-[#0D1B3E]/15'
                }`}
              />
              {form.type === 'gcash' && (
                <p className={`text-[10px] mt-1 ${
                  form.account_number && !gcashNumberValid ? 'text-red-500' : 'text-gray-400'
                }`}>
                  Enter exactly 11 digits starting with 09. Example: 09123456789
                </p>
              )}
              {form.type === 'bank_transfer' && (
                <p className="text-[10px] mt-1 text-gray-400">
                  The bank account number must belong to the account holder name above.
                </p>
              )}
            </div>
          </div>
          {message && <p className="text-xs text-[#9a6f1e]">{message}</p>}
          <button onClick={submit}
            disabled={saving || !accountNameMatches || !form.account_number || !gcashNumberValid || (form.type === 'bank_transfer' && !form.bank_name)}
            className="bg-[#C9A84C] text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {saving ? 'Submitting...' : 'Submit for Approval'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#0D1B3E]/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
          <h2 className="text-sm font-semibold text-[#0D1B3E]">My submitted accounts</h2>
        </div>
        {loading ? <p className="p-6 text-sm text-gray-400">Loading...</p> : methods.length === 0
          ? <p className="p-6 text-sm text-gray-400">No payout accounts submitted.</p>
          : methods.map((method) => (
            <div key={method.id} className="px-5 py-4 border-b border-[#0D1B3E]/5 flex justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[#0D1B3E]">
                  {method.type === 'gcash' ? 'GCash' : method.bank_name || 'Bank Transfer'}
                </p>
                <p className="text-xs text-gray-500">{method.account_name} · {method.account_number}</p>
                <span className="text-[10px] uppercase text-[#9a6f1e]">{method.status}</span>
              </div>
              <button onClick={() => remove(method.id)} className="text-xs text-red-500">Remove</button>
            </div>
          ))}
      </div>
      {pinAction && (
        <SecurityPinModal
          key={pinAction}
          title={pinAction === 'submit' ? 'Confirm payout account' : 'Remove payout account'}
          description={pinAction === 'submit'
            ? 'Enter your security PIN to submit this payout account for approval.'
            : 'Enter your security PIN to remove this payout account.'}
          confirmLabel={pinAction === 'submit' ? 'Submit for approval' : 'Remove account'}
          loading={saving}
          onClose={() => { if (!saving) { setPinAction(null); setPendingRemoveId(null) } }}
          onConfirm={async (pin) => {
            if (pinAction === 'submit') return submitPaymentMethod(pin)
            return pendingRemoveId ? removePaymentMethod(pendingRemoveId, pin) : 'No payout account was selected.'
          }}
        />
      )}
    </div>
  )
}
