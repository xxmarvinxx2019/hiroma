'use client'

import { useEffect, useState } from 'react'

type Action = 'enable' | 'disable' | 'change'

export default function DistributorSecurityPinSettings() {
  const [enabled, setEnabled] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [form, setForm] = useState({ current_pin: '', new_pin: '', confirm_pin: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => { void fetch('/api/reseller/security-pin', { cache: 'no-store' }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load Security PIN settings.'); setEnabled(Boolean(data.enabled)) }).catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load Security PIN settings.')) }, [])

  const open = (next: Action) => { setAction(next); setForm({ current_pin: '', new_pin: '', confirm_pin: '' }); setMessage(''); setSuccess(false) }
  const save = async () => {
    if (!action) return
    if (action !== 'disable' && !/^\d{6}$/.test(form.new_pin)) return setMessage('Security PIN must contain exactly six digits.')
    if (action !== 'disable' && form.new_pin !== form.confirm_pin) return setMessage('PINs do not match. Please try again.')
    if (action !== 'enable' && !/^\d{6}$/.test(form.current_pin)) return setMessage('Enter your current six-digit PIN.')
    setBusy(true); setMessage(''); setSuccess(false)
    try {
      const response = await fetch('/api/reseller/security-pin', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...form }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to update Security PIN.')
      setEnabled(Boolean(data.enabled)); setSuccess(true); setMessage(data.message || 'Security PIN updated.'); setAction(null)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update Security PIN.') }
    finally { setBusy(false) }
  }

  return <section className="overflow-hidden rounded-xl border border-[#0D1B3E]/8 bg-white">
    <div className="border-b border-[#0D1B3E]/8 px-5 py-4"><h2 className="text-sm font-semibold text-[#0D1B3E]">Two-factor authentication</h2><p className="mt-1 text-xs text-gray-400">Require a six-digit Security PIN after your password when signing in.</p></div>
    <div className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-semibold text-[#0D1B3E]">Security PIN <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] uppercase ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F0F2F8] text-gray-500'}`}>{enabled ? 'On' : 'Off'}</span></p><p className="mt-1 text-xs text-gray-400">Five incorrect attempts temporarily lock PIN verification for 15 minutes.</p></div><button type="button" onClick={() => open(enabled ? 'disable' : 'enable')} className={`rounded-lg px-4 py-2 text-xs font-semibold text-white ${enabled ? 'bg-red-600' : 'bg-[#0D1B3E]'}`}>{enabled ? 'Disable' : 'Enable'}</button></div>
      {enabled && !action && <button type="button" onClick={() => open('change')} className="text-xs font-semibold text-[#a67a19] hover:underline">Change your PIN</button>}
      {action && <div className="space-y-3 rounded-xl border border-[#0D1B3E]/10 bg-[#f8f9fc] p-4">
        <p className="text-sm font-semibold text-[#0D1B3E]">{action === 'enable' ? 'Create Security PIN' : action === 'change' ? 'Change Security PIN' : 'Disable Security PIN'}</p>
        {action !== 'enable' && <input type="password" inputMode="numeric" maxLength={6} autoComplete="one-time-code" placeholder="Current six-digit PIN" value={form.current_pin} onChange={event => setForm({ ...form, current_pin: event.target.value.replace(/\D/g, '').slice(0, 6) })} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-white px-3 py-2.5 text-center text-sm tracking-[0.3em] outline-none focus:border-[#C9A84C]"/>}
        {action !== 'disable' && <><input type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder="New six-digit PIN" value={form.new_pin} onChange={event => setForm({ ...form, new_pin: event.target.value.replace(/\D/g, '').slice(0, 6) })} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-white px-3 py-2.5 text-center text-sm tracking-[0.3em] outline-none focus:border-[#C9A84C]"/><input type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" placeholder="Confirm six-digit PIN" value={form.confirm_pin} onChange={event => setForm({ ...form, confirm_pin: event.target.value.replace(/\D/g, '').slice(0, 6) })} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-white px-3 py-2.5 text-center text-sm tracking-[0.3em] outline-none focus:border-[#C9A84C]"/></>}
        <div className="flex justify-end gap-2"><button type="button" onClick={() => { setAction(null); setMessage('') }} className="rounded-lg px-4 py-2 text-xs font-semibold text-gray-500">Cancel</button><button type="button" disabled={busy} onClick={save} className="rounded-lg bg-[#C9A84C] px-4 py-2 text-xs font-semibold text-[#0D1B3E] disabled:opacity-50">{busy ? 'Saving...' : 'Confirm'}</button></div>
      </div>}
      {message && <p className={`rounded-lg px-3 py-2 text-xs ${success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message}</p>}
    </div>
  </section>
}