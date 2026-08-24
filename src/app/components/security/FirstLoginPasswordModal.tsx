'use client'

import { FormEvent, useState } from 'react'
import type { PasswordReviewReason } from '@/app/lib/passwordReviewPolicy'

interface FirstLoginPasswordModalProps {
  open: boolean
  reviewReason?: PasswordReviewReason
  onResolved: () => void
  endpoint?: string
  allowRetain?: boolean
}

const reviewCopy: Record<PasswordReviewReason, { title: string; description: string }> = {
  temporary_first_login: {
    title: 'Secure your account',
    description: 'This is your first sign-in using a system-generated temporary password.',
  },
  temporary_day_3: {
    title: 'Review your temporary password',
    description: 'This is your day-3 security reminder. You may retain your current password or change it now.',
  },
  temporary_day_7: {
    title: 'Review your temporary password',
    description: 'This is your day-7 security reminder. You may retain your current password or change it now.',
  },
  temporary_day_30: {
    title: '30-day password review',
    description: 'Review the temporary password you retained. Retaining it now schedules the next review in 90 days.',
  },
  quarterly: {
    title: '90-day password review',
    description: 'For account security, review your password. You may retain it for another 90 days or change it now.',
  },
}

function ShieldLockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 72" fill="none" className={className} aria-hidden="true">
      <path d="M32 4 57 14v20c0 16.5-10.6 27.5-25 34C17.6 61.5 7 50.5 7 34V14L32 4Z" stroke="currentColor" strokeWidth="3" />
      <rect x="20" y="31" width="24" height="20" rx="3" stroke="currentColor" strokeWidth="3" />
      <path d="M25 31v-5a7 7 0 0 1 14 0v5M32 39v5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

function CalendarIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="6" width="24" height="22" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M9 3v6M23 3v6M4 13h24M10 18h3M19 18h3M10 23h3M19 23h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function EditIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path d="m7 24 2-6L22 5a3 3 0 0 1 4 4L13 22l-6 2Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="m19 8 5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

export default function FirstLoginPasswordModal({ open, reviewReason = 'temporary_first_login', onResolved, endpoint = '/api/reseller/profile/password', allowRetain = true }: FirstLoginPasswordModalProps) {
  const [mode, setMode] = useState<'decision' | 'change'>('decision')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [submitting, setSubmitting] = useState<'retain' | 'change' | null>(null)
  const [error, setError] = useState('')

  if (!open) return null
  const copy = reviewCopy[reviewReason]
  const changingPassword = !allowRetain || mode === 'change'

  const retainPassword = async () => {
    setError('')
    setSubmitting('retain')
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retain' }),
      })
      const data = await response.json()
      if (!response.ok) return setError(data.error || 'Unable to retain your password. Please try again.')
      onResolved()
    } catch {
      setError('Unable to retain your password. Check your connection and try again.')
    } finally {
      setSubmitting(null)
    }
  }

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!currentPassword) return setError('Enter your current password.')
    if (newPassword.length < 8) return setError('Your new password must be at least 8 characters.')
    if (newPassword !== confirmPassword) return setError('The new passwords do not match.')
    if (newPassword === currentPassword) return setError('Choose a new password that is different from your current password.')
    setSubmitting('change')
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change', current_password: currentPassword, new_password: newPassword }),
      })
      const data = await response.json()
      if (!response.ok) return setError(data.error || 'Unable to update your password. Please try again.')
      onResolved()
    } catch {
      setError('Unable to update your password. Check your connection and try again.')
    } finally {
      setSubmitting(null)
    }
  }

  const inputType = showPasswords ? 'text' : 'password'
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center overflow-y-auto bg-[#010817]/80 px-3 py-5 backdrop-blur-md sm:px-6 sm:py-8">
      <form onSubmit={changePassword} className="relative w-full max-w-3xl overflow-hidden rounded-[28px] border border-[#d8ad49]/70 bg-[#030d21] text-white shadow-[0_30px_90px_rgba(0,0,0,0.65)]" role="dialog" aria-modal="true" aria-labelledby="password-review-title">
        <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" style={{ background: 'radial-gradient(circle at 84% 15%, rgba(218,167,48,.24), transparent 25%), radial-gradient(circle at 11% 76%, rgba(28,104,255,.18), transparent 38%), linear-gradient(135deg, rgba(255,255,255,.035), transparent 40%)' }} />
        <div className="pointer-events-none absolute right-[-80px] top-[-95px] h-64 w-64 rounded-full border border-[#d8ad49]/20" aria-hidden="true" />
        <div className="pointer-events-none absolute right-[-46px] top-[-61px] h-48 w-48 rounded-full border border-[#d8ad49]/15" aria-hidden="true" />

        <div className="relative border-b border-white/10 px-6 pb-6 pt-7 sm:px-10 sm:pb-7 sm:pt-9">
          <div className="flex items-start justify-between gap-5">
            <div className="max-w-xl">
              <div className="flex items-center gap-3 text-[#f6c44d]">
                <ShieldLockIcon className="h-9 w-8 shrink-0" />
                <p className="text-xs font-black uppercase tracking-[0.28em] sm:text-sm">Account security</p>
              </div>
              <h2 id="password-review-title" className="mt-5 text-3xl font-black tracking-tight text-white sm:text-5xl">
                {changingPassword ? <>Choose a <span className="text-[#f6c44d]">new password</span></> : copy.title}
              </h2>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300 sm:text-xl sm:leading-8">{changingPassword ? 'Verify your current password, then create a private password for your account.' : copy.description}</p>
            </div>
            <div className="hidden shrink-0 items-center justify-center rounded-full border border-[#f6c44d]/40 bg-[#10152a]/90 p-4 text-[#f6c44d] shadow-[0_0_35px_rgba(225,169,45,.26)] sm:flex" aria-hidden="true">
              <ShieldLockIcon className="h-20 w-[72px]" />
            </div>
          </div>
        </div>

        <div className="relative space-y-5 px-6 py-6 sm:px-10 sm:py-7">
          <div className="flex gap-4 rounded-2xl border border-[#d9a719]/80 bg-[linear-gradient(110deg,rgba(163,105,8,.32),rgba(55,37,4,.42))] p-4 shadow-[inset_0_0_30px_rgba(232,178,48,.1)] sm:p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#f7c74d]/70 bg-black/30 text-[#ffd45e] shadow-[0_0_22px_rgba(245,187,42,.28)]">
              <ShieldLockIcon className="h-8 w-7" />
            </div>
            <p className="text-sm leading-6 text-slate-100 sm:text-base sm:leading-7"><strong className="block text-lg text-[#ffca47]">Security reminder</strong>Never share your password, security PIN, or login credentials with anyone.</p>
          </div>

          {mode === 'decision' && allowRetain ? (
            <div className="flex gap-4 rounded-2xl border border-[#2f76df] bg-[linear-gradient(115deg,rgba(17,70,139,.36),rgba(4,20,48,.78))] p-4 shadow-[inset_0_0_35px_rgba(21,100,223,.12)] sm:p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#347de5]/70 bg-[#071a3d] text-[#66a0ff]">
                <CalendarIcon className="h-7 w-7" />
              </div>
              <p className="text-sm leading-6 text-slate-100 sm:text-base sm:leading-7"><strong className="block text-lg text-[#69a1ff]">Retain Password</strong>Keeps the same password you used to sign in. You do not need to enter it again.
                {reviewReason.startsWith('temporary_') && reviewReason !== 'temporary_day_30'
                  ? ' Reminders follow calendar day 3, day 7, and day 30; after that, reviews occur every 90 days.'
                  : ' The next password review will appear after 90 days.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4 rounded-2xl border border-white/10 bg-[#06142d]/75 p-4 sm:p-5">
              {[
                ['Current password', currentPassword, setCurrentPassword, 'current-password', 'Enter your current password'],
                ['New password', newPassword, setNewPassword, 'new-password', 'At least 8 characters'],
                ['Confirm new password', confirmPassword, setConfirmPassword, 'new-password', 'Re-enter your new password'],
              ].map(([label, value, setter, autoComplete, placeholder]) => (
                <label className="block" key={label as string}>
                  <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.15em] text-[#f5c24b]">{label as string}</span>
                  <input type={inputType} value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} autoComplete={autoComplete as string} className="w-full rounded-xl border border-white/15 bg-[#020a1b]/80 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#f3bd3d] focus:ring-2 focus:ring-[#efb831]/20" placeholder={placeholder as string} />
                </label>
              ))}
              <button type="button" onClick={() => setShowPasswords((current) => !current)} className="text-sm font-bold text-[#f5c24b] hover:text-[#ffdb74] hover:underline">{showPasswords ? 'Hide passwords' : 'Show passwords'}</button>
            </div>
          )}

          {error && <div className="rounded-xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-sm text-red-100" role="alert">{error}</div>}
        </div>

        <div className="relative border-t border-white/10 px-6 pb-7 pt-5 sm:px-10 sm:pb-8">
          <div className="flex flex-col gap-3 sm:flex-row">
            {mode === 'decision' && allowRetain ? (
              <>
                <button type="button" onClick={() => void retainPassword()} disabled={submitting !== null} className="flex flex-1 items-center justify-center gap-3 rounded-2xl border border-[#dfa92e] bg-[#06152c]/90 px-4 py-4 text-base font-black text-white transition hover:bg-[#0a2345] disabled:opacity-60"><ShieldLockIcon className="h-6 w-6 text-[#f4bf42]" />{submitting === 'retain' ? 'Retaining...' : 'Retain Password'}</button>
                <button type="button" onClick={() => { setError(''); setMode('change') }} disabled={submitting !== null} className="flex flex-1 items-center justify-center gap-3 rounded-2xl border border-[#ffde75] bg-[linear-gradient(120deg,#f8d45e,#ca8e18)] px-4 py-4 text-base font-black text-[#07132f] shadow-[0_8px_25px_rgba(211,159,36,.28)] transition hover:brightness-110 disabled:opacity-60"><EditIcon className="h-6 w-6" />Change Password</button>
              </>
            ) : (
              <>
                {allowRetain && <button type="button" onClick={() => { setError(''); setMode('decision') }} disabled={submitting !== null} className="flex-1 rounded-2xl border border-white/20 bg-[#0b1933] px-4 py-4 text-base font-black text-white transition hover:bg-[#142849] disabled:opacity-60">Back</button>}
                <button type="submit" disabled={submitting !== null} className="flex flex-1 items-center justify-center gap-3 rounded-2xl border border-[#ffde75] bg-[linear-gradient(120deg,#f8d45e,#ca8e18)] px-4 py-4 text-base font-black text-[#07132f] shadow-[0_8px_25px_rgba(211,159,36,.28)] transition hover:brightness-110 disabled:opacity-60"><EditIcon className="h-6 w-6" />{submitting === 'change' ? 'Changing...' : 'Save New Password'}</button>
              </>
            )}
          </div>
          <div className="mt-5 flex items-center justify-center gap-3 text-center text-sm text-slate-400 before:h-px before:flex-1 before:bg-[#d9a719]/50 after:h-px after:flex-1 after:bg-[#d9a719]/50"><ShieldLockIcon className="h-6 w-5 shrink-0 text-[#e7b53f]" /><span>Your security. Our priority.</span></div>
        </div>
      </form>
    </div>
  )
}
