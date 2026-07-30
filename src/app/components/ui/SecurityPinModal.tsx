'use client'

import { useState } from 'react'

type SecurityPinModalProps = {
  title: string
  description: string
  confirmLabel: string
  loading?: boolean
  onClose: () => void
  onConfirm: (pin: string) => Promise<string | null>
}

export default function SecurityPinModal({
  title,
  description,
  confirmLabel,
  loading = false,
  onClose,
  onConfirm,
}: SecurityPinModalProps) {
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [error, setError] = useState('')

  const confirm = async () => {
    if (!/^\d{6}$/.test(pin)) {
      setError('Enter your six-digit security PIN.')
      return
    }
    const result = await onConfirm(pin)
    if (result) setError(result)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0D1B3E]/55 p-4" role="dialog" aria-modal="true" aria-labelledby="security-pin-title">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#0D1B3E]/8 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#C9A84C]">Account security</p>
            <h2 id="security-pin-title" className="mt-1 text-base font-semibold text-[#0D1B3E]">{title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">{description}</p>
          </div>
          <button type="button" onClick={onClose} disabled={loading} aria-label="Close security PIN modal"
            className="ml-4 text-lg leading-none text-gray-400 hover:text-[#0D1B3E] disabled:opacity-50">
            ×
          </button>
        </div>

        <div className="px-5 py-4">
          <label className="block text-xs font-medium text-[#0D1B3E]" htmlFor="transaction-security-pin">Six-digit security PIN</label>
          <div className="relative mt-2">
            <input id="transaction-security-pin" type={showPin ? 'text' : 'password'} inputMode="numeric" autoComplete="one-time-code"
              autoFocus maxLength={6} value={pin}
              onChange={(event) => { setPin(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
              onKeyDown={(event) => { if (event.key === 'Enter') void confirm() }}
              placeholder="••••••" aria-invalid={Boolean(error)}
              className={`w-full rounded-lg border bg-[#F0F2F8] px-3 py-2.5 pr-12 text-center text-lg tracking-[0.2em] text-[#0D1B3E] placeholder:text-gray-400 outline-none transition-colors ${
                error ? 'border-red-400' : 'border-[#0D1B3E]/15 focus:border-[#C9A84C]'
              }`} />
            <button type="button" onClick={() => setShowPin(!showPin)} aria-label={showPin ? 'Hide security PIN' : 'Show security PIN'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 hover:text-[#0D1B3E]">
              {showPin ? '◉' : '◌'}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-[#0D1B3E]/8 px-5 py-3">
          <button type="button" onClick={onClose} disabled={loading}
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:text-[#0D1B3E] disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => void confirm()} disabled={loading}
            className="rounded-lg bg-[#C9A84C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#b8963e] disabled:opacity-50">
            {loading ? 'Verifying...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
