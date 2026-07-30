'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [requiresPin, setRequiresPin] = useState(false)
  const [securityPin, setSecurityPin] = useState('')
  const [showSecurityPin, setShowSecurityPin] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.username || !form.password) {
      setError('Please enter your username and password.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: form.username.trim().toLowerCase(),
          password: form.password,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Login failed. Please try again.')
        setLoading(false)
        return
      }

      if (data.requires_pin) {
        setSecurityPin('')
        setShowSecurityPin(false)
        setRequiresPin(true)
        setLoading(false)
        return
      }

      // Redirect to the correct dashboard based on role
      router.push(data.redirect)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(securityPin)) {
      setError('Enter your six-digit security PIN.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: securityPin }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Security PIN verification failed.')
        setLoading(false)
        return
      }
      router.push(data.redirect)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0D1B3E] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-4xl bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row">

        {/* ── Left Panel ── */}
        <div className="bg-[#0D1B3E] md:w-1/2 p-10 flex flex-col justify-between border-r border-white/5">
          <div>
            <Link href="/" className="flex items-center gap-3 mb-10">
              <div className="w-10 h-10 relative flex-shrink-0">
                <Image src="/hiroma-logo.jpg" alt="Hiroma logo" fill className="object-contain rounded-lg" priority />
              </div>
              <span className="text-white font-medium text-base tracking-[0.25em]">HIROMA</span>
            </Link>

            <p className="text-[#C9A84C] text-xs italic mb-8">Long lasting oil rich fragrance</p>

            <div className="flex flex-col gap-5">
              {[
                { icon: '🌳', text: 'Manage your downline & binary tree' },
                { icon: '💰', text: 'Track commissions, points & earnings' },
                { icon: '📦', text: 'Order products online & offline' },
                { icon: '🚚', text: 'Monitor your distribution network' },
                { icon: '💳', text: 'Real-time wallet & payout requests' },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-3">
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-white/60 text-sm">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-10">
            <p className="text-white/20 text-xs">© {new Date().getFullYear()} Hiroma. All rights reserved.</p>
          </div>
        </div>

        {/* ── Right Panel — Form ── */}
        <div className="md:w-1/2 p-10 flex flex-col justify-center bg-white">
          <h1 className="text-[#0D1B3E] text-2xl font-semibold mb-1">Welcome back</h1>
          <p className="text-gray-400 text-sm mb-8">Sign in to your Hiroma account</p>

          <form onSubmit={handleSubmit} className={requiresPin ? 'hidden' : 'flex flex-col gap-4'}>

            {requiresPin ? (
              <>
                <div className="mb-2">
                  <h2 className="text-[#0D1B3E] text-lg font-semibold">Security PIN</h2>
                  <p className="text-gray-400 text-sm mt-1">Enter the six-digit PIN configured for this reseller account.</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Six-digit PIN <span className="text-[#C9A84C]">*</span></label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                    value={securityPin}
                    onChange={(e) => { setSecurityPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
                    placeholder="••••••"
                    className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-4 py-3 text-center text-lg tracking-[0.45em] text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                  />
                </div>
              </>
            ) : <>

            {/* Username */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Username <span className="text-[#C9A84C]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                <input
                  name="username"
                  value={form.username}
                  onChange={handleChange}
                  placeholder="Enter your username"
                  autoComplete="username"
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg pl-8 pr-4 py-2.5 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
                />
              </div>
            </div>
            </>}

            {/* Password */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Password <span className="text-[#C9A84C]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔒</span>
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={handleChange}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg pl-8 pr-10 py-2.5 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#0D1B3E] text-xs cursor-pointer"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && !requiresPin && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <p className="text-red-500 text-xs">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-3 hover:bg-[#E8C96A] transition-all duration-150 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  {requiresPin ? 'Verifying PIN...' : 'Signing in...'}
                </span>
              ) : requiresPin ? 'Verify & sign in' : 'Sign in'}
            </button>

            {requiresPin && (
              <button type="button" onClick={() => { setRequiresPin(false); setSecurityPin(''); setError('') }}
                className="text-xs text-gray-400 hover:text-[#0D1B3E]">
                Back to username and password
              </button>
            )}

          </form>

          <div className="mt-6 bg-[#F0F2F8] rounded-lg px-4 py-3">
            <p className="text-xs text-gray-400 leading-relaxed">
              New resellers are registered by your city distributor. Contact them with your starter package to get started.
            </p>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">
            <Link href="/" className="text-[#C9A84C] hover:underline">← Back to Hiroma homepage</Link>
          </p>
        </div>

      </div>

      {requiresPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D1B3E]/65 p-4" role="dialog" aria-modal="true" aria-labelledby="security-pin-login-title">
          <form onSubmit={handlePinSubmit} className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-[#0D1B3E]/8 px-6 py-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#C9A84C]">Account security</p>
              <h2 id="security-pin-login-title" className="mt-1 text-lg font-semibold text-[#0D1B3E]">Enter your security PIN</h2>
              <p className="mt-1 text-sm leading-relaxed text-gray-400">Enter the six-digit PIN configured for this reseller account.</p>
            </div>
            <div className="space-y-3 px-6 py-5">
              <label className="block text-xs font-medium text-[#0D1B3E]">Six-digit PIN</label>
              <div className="relative">
                <input
                  type={showSecurityPin ? 'text' : 'password'}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  value={securityPin}
                  onChange={(e) => { setSecurityPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
                  placeholder="••••••"
                  className="w-full rounded-lg border border-[#0D1B3E]/15 bg-[#F0F2F8] px-10 py-3 text-center text-lg tracking-[0.45em] text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
                {error && securityPin && (
                  <button type="button" onClick={() => setShowSecurityPin((visible) => !visible)} aria-label={showSecurityPin ? 'Hide security PIN' : 'Show security PIN'} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-[#0D1B3E]">
                    {showSecurityPin ? (
                      <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 4.2A10.7 10.7 0 0112 4c5.2 0 8.8 4.1 9.8 6.5a1.4 1.4 0 010 1C21.3 12.7 20.2 14.3 18.5 15.7M6.2 6.2C4.5 7.6 3.4 9.3 2.2 11.5a1.4 1.4 0 000 1C3.2 14.9 6.8 19 12 19c1 0 1.9-.2 2.8-.5" /></svg>
                    ) : (
                      <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.2 12.5a1.4 1.4 0 010-1C3.2 9.1 6.8 5 12 5s8.8 4.1 9.8 6.5a1.4 1.4 0 010 1C20.8 14.9 17.2 19 12 19S3.2 14.9 2.2 12.5z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                )}
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-[#0D1B3E]/8 px-6 py-4">
              <button type="button" onClick={() => { setRequiresPin(false); setSecurityPin(''); setShowSecurityPin(false); setError('') }} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:bg-[#F0F2F8]">Cancel</button>
              <button type="submit" disabled={loading} className="rounded-lg bg-[#C9A84C] px-4 py-2 text-sm font-semibold text-[#0D1B3E] transition-colors hover:bg-[#E8C96A] disabled:opacity-60">
                {loading ? 'Verifying...' : 'Verify & sign in'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
