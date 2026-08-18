'use client'

import { useEffect, useState } from 'react'

type Action = 'enable' | 'disable' | 'change'
type PinField = 'current' | 'new' | 'confirm'
const emptyForm = { current_pin: '', new_pin: '', confirm_pin: '' }

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg> : <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 9 4 10 8a10.7 10.7 0 0 1-2.1 4.1"/><path d="M6.2 6.2C4.2 7.5 2.8 9.5 2 12c1 4 5 8 10 8 1.5 0 2.9-.4 4.1-1"/></svg>
}

export default function DistributorSecurityPinSettings() {
  const [enabled, setEnabled] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [visible, setVisible] = useState<Record<PinField, boolean>>({ current: false, new: false, confirm: false })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    void fetch('/api/reseller/security-pin', { cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load Security PIN settings.')
      setEnabled(Boolean(data.enabled))
    }).catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load Security PIN settings.'))
  }, [])

  useEffect(() => {
    if (!action) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) setAction(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [action, busy])

  const open = (next: Action) => {
    setAction(next); setForm(emptyForm); setVisible({ current: false, new: false, confirm: false }); setMessage(''); setSuccess(false)
  }
  const close = () => { if (!busy) { setAction(null); setForm(emptyForm); setMessage('') } }

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
      setEnabled(Boolean(data.enabled)); setSuccess(true); setMessage(data.message || 'Security PIN updated.'); setAction(null); setForm(emptyForm)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update Security PIN.') }
    finally { setBusy(false) }
  }

  const updatePin = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value.replace(/\D/g, '').slice(0, 6) }))
  const pinInput = (field: PinField, key: keyof typeof form, placeholder: string, autoComplete: string) => <div className="relative">
    <input type={visible[field] ? 'text' : 'password'} inputMode="numeric" maxLength={6} autoComplete={autoComplete} placeholder={placeholder} value={form[key]} onChange={event => updatePin(key, event.target.value)} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-10 py-2.5 text-center text-sm outline-none focus:border-[#C9A84C]" />
    <button type="button" aria-label={visible[field] ? `Hide ${field} PIN` : `Show ${field} PIN`} aria-pressed={visible[field]} onClick={() => setVisible(current => ({ ...current, [field]: !current[field] }))} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-white hover:text-[#0D1B3E] focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/40"><EyeIcon hidden={!visible[field]} /></button>
  </div>

  const displayedState = action === 'enable' ? true : action === 'disable' ? false : enabled

  return <>
    <section className="overflow-hidden rounded-xl border border-[#0D1B3E]/8 bg-white">
      <div className="border-b border-[#0D1B3E]/8 px-5 py-4"><h2 className="text-sm font-semibold text-[#0D1B3E]">Two-factor authentication</h2><p className="mt-1 text-xs text-gray-400">Require a six-digit Security PIN after your password when signing in.</p></div>
      <div className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-sm font-semibold text-[#0D1B3E]">Security PIN <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] uppercase ${displayedState ? 'bg-emerald-50 text-emerald-700' : 'bg-[#F0F2F8] text-gray-500'}`}>{displayedState ? 'On' : 'Off'}</span></p><p className="mt-1 text-xs text-gray-400">Five incorrect attempts temporarily lock PIN verification for 15 minutes.</p></div>
          <button type="button" role="switch" aria-checked={displayedState} onClick={() => open(enabled ? 'disable' : 'enable')} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/50 ${displayedState ? 'bg-emerald-500' : 'bg-gray-300'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-[left] duration-200 ${displayedState ? 'left-[22px]' : 'left-0.5'}`} /></button>
        </div>
        {enabled && !action && <button type="button" onClick={() => open('change')} className="mt-4 text-xs font-semibold text-[#a67a19] hover:underline">Change your PIN</button>}
        {!action && message && <p className={`mt-4 rounded-lg px-3 py-2 text-xs ${success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{message}</p>}
      </div>
    </section>

    {action && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0D1B3E]/55 p-4" role="dialog" aria-modal="true" aria-labelledby="distributor-security-pin-title">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-[#0D1B3E]/8 px-5 py-4"><div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">Account security</p><h2 id="distributor-security-pin-title" className="mt-1 text-base font-semibold text-[#0D1B3E]">{action === 'enable' ? 'Set up your security PIN' : action === 'change' ? 'Change your security PIN' : 'Turn off security PIN?'}</h2><p className="mt-1 text-xs leading-relaxed text-gray-400">{action === 'enable' ? 'Create and confirm a six-digit PIN. You will need it after signing in and for sensitive actions.' : action === 'change' ? 'Verify using your current PIN, then set a new six-digit PIN.' : 'Enter your current PIN before removing this protection.'}</p></div>
          <button type="button" aria-label="Close" onClick={close} disabled={busy} className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-[#F0F2F8] hover:text-[#0D1B3E] disabled:opacity-50"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </div></div>
        <div className="space-y-3 px-5 py-4">
          {action !== 'enable' && pinInput('current', 'current_pin', 'Current six-digit PIN', 'one-time-code')}
          {action !== 'disable' && <>{pinInput('new', 'new_pin', action === 'enable' ? 'Create your 6-digit PIN' : 'New 6-digit PIN', 'new-password')}{pinInput('confirm', 'confirm_pin', action === 'enable' ? 'Confirm your 6-digit PIN' : 'Confirm new 6-digit PIN', 'new-password')}</>}
          {message && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{message}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-[#0D1B3E]/8 px-5 py-3">
          <button type="button" onClick={close} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-[#F0F2F8] disabled:opacity-50">Cancel</button>
          <button type="button" disabled={busy} onClick={save} className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${action === 'disable' ? 'bg-[#a03030]' : 'bg-[#C9A84C]'}`}>{busy ? 'Saving...' : action === 'enable' ? 'Enable security PIN' : action === 'change' ? 'Change PIN' : 'Turn off PIN'}</button>
        </div>
      </div>
    </div>}
  </>
}
