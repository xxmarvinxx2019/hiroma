'use client'

import { FormEvent, useState } from 'react'
import type { PasswordReviewReason } from '@/app/lib/passwordReviewPolicy'

interface FirstLoginPasswordModalProps {
  open: boolean
  reviewReason?: PasswordReviewReason
  onResolved: () => void
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

export default function FirstLoginPasswordModal({ open, reviewReason = 'temporary_first_login', onResolved }: FirstLoginPasswordModalProps) {
  const [mode, setMode] = useState<'decision' | 'change'>('decision')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [submitting, setSubmitting] = useState<'retain' | 'change' | null>(null)
  const [error, setError] = useState('')

  if (!open) return null
  const copy = reviewCopy[reviewReason]

  const retainPassword = async () => {
    setError('')
    setSubmitting('retain')
    try {
      const response = await fetch('/api/reseller/profile/password', {
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
      const response = await fetch('/api/reseller/profile/password', {
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
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-[#07132f]/75 px-4 py-6 backdrop-blur-sm">
      <form onSubmit={changePassword} className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="password-review-title">
        <div className="border-b border-gray-100 px-6 py-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#C9A84C]">Account security</p>
          <h2 id="password-review-title" className="mt-1 text-xl font-bold text-[#0D1B3E]">{mode === 'change' ? 'Change your password' : copy.title}</h2>
          <p className="mt-1 text-sm leading-5 text-gray-500">{mode === 'change' ? 'Verify your current password, then create a private password.' : copy.description}</p>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
            <strong>Security reminder:</strong> Never share your password, security PIN, or login credentials with anyone.
          </div>

          {mode === 'decision' ? (
            <div className="rounded-xl border border-[#0D1B3E]/10 bg-[#F0F2F8] px-4 py-3 text-xs leading-5 text-[#0D1B3E]">
              <strong>Retain Password</strong> keeps the same password you used to sign in. You do not need to enter it again.
              {reviewReason.startsWith('temporary_') && reviewReason !== 'temporary_day_30'
                ? ' Reminders follow calendar day 3, day 7, and day 30; after that, reviews occur every 90 days.'
                : ' The next password review will appear after 90 days.'}
            </div>
          ) : (
            <>
              {[
                ['Current password', currentPassword, setCurrentPassword, 'current-password', 'Enter your current password'],
                ['New password', newPassword, setNewPassword, 'new-password', 'At least 8 characters'],
                ['Confirm new password', confirmPassword, setConfirmPassword, 'new-password', 'Re-enter your new password'],
              ].map(([label, value, setter, autoComplete, placeholder]) => (
                <label className="block" key={label as string}>
                  <span className="mb-1 block text-xs font-medium text-[#0D1B3E]">{label as string}</span>
                  <input type={inputType} value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} autoComplete={autoComplete as string} className="w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-3 py-2.5 text-sm outline-none focus:border-[#C9A84C]" placeholder={placeholder as string} />
                </label>
              ))}
              <button type="button" onClick={() => setShowPasswords((current) => !current)} className="text-xs font-medium text-[#9a6f1e] hover:underline">{showPasswords ? 'Hide passwords' : 'Show passwords'}</button>
            </>
          )}

          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">{error}</div>}
        </div>

        <div className="flex gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4">
          {mode === 'decision' ? (
            <>
              <button type="button" onClick={() => void retainPassword()} disabled={submitting !== null} className="flex-1 rounded-lg border border-[#0D1B3E]/15 bg-white px-4 py-2.5 text-sm font-semibold text-[#0D1B3E] hover:bg-gray-100 disabled:opacity-60">{submitting === 'retain' ? 'Retaining...' : 'Retain Password'}</button>
              <button type="button" onClick={() => { setError(''); setMode('change') }} disabled={submitting !== null} className="flex-1 rounded-lg bg-[#C9A84C] px-4 py-2.5 text-sm font-semibold text-[#0D1B3E] hover:bg-[#E8C96A] disabled:opacity-60">Change Password</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => { setError(''); setMode('decision') }} disabled={submitting !== null} className="flex-1 rounded-lg border border-[#0D1B3E]/15 bg-white px-4 py-2.5 text-sm font-semibold text-[#0D1B3E] hover:bg-gray-100 disabled:opacity-60">Back</button>
              <button type="submit" disabled={submitting !== null} className="flex-1 rounded-lg bg-[#C9A84C] px-4 py-2.5 text-sm font-semibold text-[#0D1B3E] hover:bg-[#E8C96A] disabled:opacity-60">{submitting === 'change' ? 'Changing...' : 'Save New Password'}</button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
