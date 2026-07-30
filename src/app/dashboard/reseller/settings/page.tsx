'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type ThemeName = 'default' | 'modern'

const themes: Array<{
  value: Exclude<ThemeName, 'default'>
  label: string
  description: string
}> = [
  { value: 'modern', label: 'Modern', description: 'Use the premium Hiroma navy dashboard display.' },
]

function getStoredTheme(): ThemeName {
  if (typeof window === 'undefined') return 'default'
  const stored = window.localStorage.getItem('hiroma-reseller-theme')
  return stored === 'modern' || stored === 'on' ? 'modern' : 'default'
}

export default function ResellerSettingsPage() {
  const [theme, setTheme] = useState<ThemeName>('default')
  const [saved, setSaved] = useState(false)
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [securityForm, setSecurityForm] = useState({ current_pin: '', new_pin: '', confirm_pin: '' })
  const [securityMessage, setSecurityMessage] = useState('')
  const [securityMessageSuccess, setSecurityMessageSuccess] = useState(false)
  const securityMessageTimer = useRef<number | null>(null)
  const [securitySaving, setSecuritySaving] = useState(false)
  const [securityModalOpen, setSecurityModalOpen] = useState(false)
  const [securityTargetEnabled, setSecurityTargetEnabled] = useState(false)
  const [securitySwitchPreview, setSecuritySwitchPreview] = useState<boolean | null>(null)
  const [securityAction, setSecurityAction] = useState<'enable' | 'disable' | 'change'>('enable')

  useEffect(() => {
    setTheme(getStoredTheme())
  }, [])

  useEffect(() => {
    const loadSecurityStatus = async () => {
      try {
        const response = await fetch('/api/reseller/security-pin')
        const raw = await response.text()
        const data = raw ? JSON.parse(raw) as { enabled?: boolean; error?: string } : null
        if (!response.ok || !data) {
          setSecurityMessage(data?.error || 'Unable to load Security PIN settings. Please refresh and try again.')
          return
        }
        setTwoFactorEnabled(Boolean(data.enabled))
      } catch {
        setSecurityMessage('Unable to load Security PIN settings. Please refresh and try again.')
      }
    }
    void loadSecurityStatus()

    return () => {
      if (securityMessageTimer.current) window.clearTimeout(securityMessageTimer.current)
    }
  }, [])

  const clearSecurityMessage = () => {
    if (securityMessageTimer.current) window.clearTimeout(securityMessageTimer.current)
    securityMessageTimer.current = null
    setSecurityMessage('')
    setSecurityMessageSuccess(false)
  }

  const showSecuritySuccess = (message: string) => {
    if (securityMessageTimer.current) window.clearTimeout(securityMessageTimer.current)
    setSecurityMessage(message)
    setSecurityMessageSuccess(true)
    securityMessageTimer.current = window.setTimeout(() => {
      setSecurityMessage('')
      setSecurityMessageSuccess(false)
      securityMessageTimer.current = null
    }, 10_000)
  }

  const changeTheme = (nextTheme: ThemeName) => {
    setTheme(nextTheme)
    window.localStorage.setItem('hiroma-reseller-theme', nextTheme)
    window.dispatchEvent(new CustomEvent<ThemeName>('hiroma-reseller-theme-change', { detail: nextTheme }))
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  const saveSecurityPin = async (action: 'enable' | 'disable' | 'change') => {
    clearSecurityMessage()
    if (action !== 'disable' && !/^\d{6}$/.test(securityForm.new_pin)) {
      return setSecurityMessage('Enter a six-digit PIN.')
    }
    if (action !== 'disable' && securityForm.new_pin !== securityForm.confirm_pin) {
      return setSecurityMessage('PINs do not match. Please try again.')
    }
    if (action === 'disable' && !/^\d{6}$/.test(securityForm.current_pin)) {
      return setSecurityMessage('Incorrect PIN. Please try again.')
    }
    if (action === 'change' && !/^\d{6}$/.test(securityForm.current_pin)) {
      return setSecurityMessage('Incorrect PIN. Please try again.')
    }
    setSecuritySaving(true)
    const response = await fetch('/api/reseller/security-pin', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...securityForm }),
    })
    const data = await response.json()
    setSecuritySaving(false)
    if (response.ok) showSecuritySuccess(data.message)
    else setSecurityMessage(data.error || 'Unable to update security PIN.')
    if (response.ok) {
      setTwoFactorEnabled(Boolean(data.enabled))
      setSecurityForm({ current_pin: '', new_pin: '', confirm_pin: '' })
      setSecurityModalOpen(false)
    }
  }

  const openSecurityModal = () => {
    const nextEnabledState = !twoFactorEnabled

    clearSecurityMessage()
    setSecurityForm({ current_pin: '', new_pin: '', confirm_pin: '' })
    setSecurityTargetEnabled(nextEnabledState)
    setSecurityAction(twoFactorEnabled ? 'disable' : 'enable')
    setSecuritySwitchPreview(nextEnabledState)
    // Let the user see the switch slide before opening the confirmation modal.
    window.setTimeout(() => {
      setSecurityModalOpen(true)
      setSecuritySwitchPreview(null)
    }, 180)
  }

  const openChangePinModal = () => {
    clearSecurityMessage()
    setSecurityForm({ current_pin: '', new_pin: '', confirm_pin: '' })
    setSecurityTargetEnabled(true)
    setSecurityAction('change')
    setSecurityModalOpen(true)
  }

  const closeSecurityModal = () => {
    setSecurityModalOpen(false)
    setSecurityTargetEnabled(twoFactorEnabled)
    setSecuritySwitchPreview(null)
    clearSecurityMessage()
  }

  const displayedSecurityState = securitySwitchPreview ?? (securityModalOpen ? securityTargetEnabled : twoFactorEnabled)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">Manage your dashboard preferences and account options.</p>
      </div>

      <section className="overflow-hidden rounded-xl border border-[#0D1B3E]/8 bg-white">
        <div className="border-b border-[#0D1B3E]/8 px-5 py-4">
          <h2 className="text-sm font-semibold text-[#0D1B3E]">Dashboard themes</h2>
          <p className="mt-0.5 text-xs text-gray-400">Turn themes on to choose a dashboard style. Off uses the standard white Default theme.</p>
        </div>
        <div className="space-y-2 p-5">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[#0D1B3E]/10 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[#0D1B3E]">Themes <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${theme === 'modern' ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#F0F2F8] text-gray-500'}`}>{theme === 'modern' ? 'On' : 'Off'}</span></p>
              <p className="mt-1 text-xs text-gray-400">{theme === 'modern' ? 'Modern is active.' : 'Default white theme is active.'}</p>
            </div>
            <button type="button" role="switch" aria-checked={theme === 'modern'} onClick={() => changeTheme(theme === 'modern' ? 'default' : 'modern')}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/50 ${theme === 'modern' ? 'bg-emerald-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-[left] duration-200 ${theme === 'modern' ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          {theme === 'modern' && <div className="pt-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Choose a theme</p>
          {themes.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => changeTheme(option.value)}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                theme === option.value
                  ? 'border-[#C9A84C] bg-[#fef9ee]'
                  : 'border-[#0D1B3E]/10 hover:border-[#C9A84C]/50 hover:bg-[#f8f9fc]'
              }`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                theme === option.value ? 'border-[#C9A84C] bg-[#C9A84C] text-[#0D1B3E]' : 'border-gray-300'
              }`}>
                {theme === option.value && <span className="text-xs font-bold">✓</span>}
              </span>
              <span>
                <span className="block text-sm font-medium text-[#0D1B3E]">{option.label}</span>
                <span className="mt-0.5 block text-xs text-gray-400">{option.description}</span>
              </span>
            </button>
          ))}
          </div>}
          {saved && <p className="pt-1 text-xs font-medium text-[#1a7a4a]">Theme preference saved.</p>}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#0D1B3E]/8 bg-white">
        <div className="border-b border-[#0D1B3E]/8 px-5 py-4">
          <h2 className="text-sm font-semibold text-[#0D1B3E]">Two-factor authentication</h2>
          <p className="mt-0.5 text-xs text-gray-400">Use a six-digit security PIN at login and before sensitive account or payout actions.</p>
        </div>
        <div className="flex items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${displayedSecurityState ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#F0F2F8] text-gray-400'}`} aria-hidden="true">⌁</div>
            <div>
            <p className="text-sm font-semibold text-[#0D1B3E]">Security PIN <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${displayedSecurityState ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#F0F2F8] text-gray-500'}`}>{displayedSecurityState ? 'On' : 'Off'}</span></p>
              <p className="mt-1 text-xs text-gray-400">{displayedSecurityState ? 'Required at sign-in and sensitive actions.' : 'Protect sign-in, payouts, and account changes.'}</p>
            </div>
          </div>
          <button type="button" role="switch" aria-checked={displayedSecurityState} onClick={openSecurityModal}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#C9A84C]/50 ${displayedSecurityState ? 'bg-emerald-500' : 'bg-gray-300'}`}>
            <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-[left] duration-200 ${displayedSecurityState ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
        {!securityModalOpen && securityMessage && (
          <p className={`mx-5 mb-5 rounded-lg px-3 py-2 text-xs ${securityMessageSuccess ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#fdecea] text-[#a03030]'}`}>{securityMessage}</p>
        )}
        {twoFactorEnabled && (
          <div className="px-5 pb-5">
            <button type="button" onClick={openChangePinModal} className="text-xs font-medium text-[#C9A84C] hover:text-[#9a6f1e] hover:underline">
              Change your PIN
            </button>
          </div>
        )}
      </section>

      {securityModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0D1B3E]/55 p-4" role="dialog" aria-modal="true" aria-labelledby="security-pin-title">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-[#0D1B3E]/8 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">Account security</p>
                  <h2 id="security-pin-title" className="mt-1 text-base font-semibold text-[#0D1B3E]">{securityAction === 'enable' ? 'Set up your security PIN' : securityAction === 'change' ? 'Change your security PIN' : 'Turn off security PIN?'}</h2>
                  <p className="mt-1 text-xs leading-relaxed text-gray-400">{securityAction === 'enable' ? 'Create and confirm a six-digit PIN. You will need it after signing in and for sensitive actions.' : securityAction === 'change' ? 'Verify using your current PIN, then set a new six-digit PIN.' : 'Enter your current PIN before removing this protection.'}</p>
                </div>
                <button type="button" aria-label="Close" onClick={closeSecurityModal} className="text-xl text-gray-400 hover:text-[#0D1B3E]">×</button>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              {securityAction === 'disable' || securityAction === 'change' ? <input type="password" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="Current six-digit PIN" value={securityForm.current_pin} onChange={(event) => setSecurityForm({ ...securityForm, current_pin: event.target.value.replace(/\D/g, '').slice(0, 6) })} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 text-center text-sm outline-none focus:border-[#C9A84C]" /> : null}
              {securityAction !== 'disable' && <>
                <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder={securityAction === 'enable' ? 'Create your six-digit PIN' : 'New six-digit PIN'} value={securityForm.new_pin} onChange={(event) => setSecurityForm({ ...securityForm, new_pin: event.target.value.replace(/\D/g, '').slice(0, 6) })} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 text-center text-sm outline-none focus:border-[#C9A84C]" />
                <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder={securityAction === 'enable' ? 'Confirm your six-digit PIN' : 'Confirm new six-digit PIN'} value={securityForm.confirm_pin} onChange={(event) => setSecurityForm({ ...securityForm, confirm_pin: event.target.value.replace(/\D/g, '').slice(0, 6) })} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 text-center text-sm outline-none focus:border-[#C9A84C]" />
              </>}
              {securityMessage && <p className="text-xs text-[#a03030]">{securityMessage}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-[#0D1B3E]/8 px-5 py-3">
              <button type="button" onClick={closeSecurityModal} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-[#F0F2F8]">Cancel</button>
              <button type="button" disabled={securitySaving} onClick={() => saveSecurityPin(securityAction)} className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${securityAction === 'disable' ? 'bg-[#a03030]' : 'bg-[#C9A84C]'}`}>
                {securitySaving ? 'Saving...' : securityAction === 'enable' ? 'Enable security PIN' : securityAction === 'change' ? 'Change PIN' : 'Turn off PIN'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-[#0D1B3E]/8 bg-white">
        <div className="border-b border-[#0D1B3E]/8 px-5 py-4">
          <h2 className="text-sm font-semibold text-[#0D1B3E]">Account settings</h2>
          <p className="mt-0.5 text-xs text-gray-400">Update your account information, password, and payout details.</p>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <Link href="/dashboard/reseller/profile" className="rounded-lg border border-[#0D1B3E]/10 px-4 py-3 transition-colors hover:border-[#C9A84C]/60 hover:bg-[#fef9ee]">
            <span className="block text-sm font-medium text-[#0D1B3E]">Profile & password</span>
            <span className="mt-1 block text-xs text-gray-400">Edit your personal details and password.</span>
          </Link>
          <Link href="/dashboard/reseller/payment-methods" className="rounded-lg border border-[#0D1B3E]/10 px-4 py-3 transition-colors hover:border-[#C9A84C]/60 hover:bg-[#fef9ee]">
            <span className="block text-sm font-medium text-[#0D1B3E]">Payment methods</span>
            <span className="mt-1 block text-xs text-gray-400">Manage payout account details.</span>
          </Link>
        </div>
      </section>
    </div>
  )
}
