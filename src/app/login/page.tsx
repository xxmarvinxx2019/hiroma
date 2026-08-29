'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import styles from './login.module.css'
import { startAuthentication } from '@simplewebauthn/browser'
import { getPasskeySignInError } from '@/app/lib/passkeyError'
import { sealPosOfflineScope } from '@/app/lib/posOfflineQueue'

type LoginPageProps = { portal?: 'member' | 'distributor' | 'admin' | 'legacy' }
const portalCopy = {
  member: { title: 'Member portal', subtitle: 'Sign in with your reseller or member account' },
  distributor: { title: 'Distributor portal', subtitle: 'Sign in with your distributor account' },
  admin: { title: 'Admin portal', subtitle: 'Sign in with your admin account' },
  legacy: { title: 'Welcome back', subtitle: 'Sign in to your Hiroma account' },
} as const

export function LoginPortal({ portal = 'legacy' }: LoginPageProps) {
  const router = useRouter()
  const sceneRef = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [passkeyMode, setPasskeyMode] = useState(false)
  const [requiresPin, setRequiresPin] = useState(false)
  const [securityPin, setSecurityPin] = useState('')
  const [showSecurityPin, setShowSecurityPin] = useState(false)
  const pinInputRefs = useRef<Array<HTMLInputElement | null>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const scene = sceneRef.current
    if (!scene || event.pointerType === 'touch') return
    const bounds = scene.getBoundingClientRect()
    scene.style.setProperty('--cursor-x', `${event.clientX - bounds.left}px`)
    scene.style.setProperty('--cursor-y', `${event.clientY - bounds.top}px`)
    scene.style.setProperty('--cursor-opacity', '1')
    scene.style.setProperty('--tilt-x', `${((event.clientY - bounds.top) / bounds.height - 0.5) * -5}deg`)
    scene.style.setProperty('--tilt-y', `${((event.clientX - bounds.left) / bounds.width - 0.5) * 6}deg`)
    scene.style.setProperty('--sphere-x', `${((event.clientX - bounds.left) / bounds.width - 0.5) * -28}px`)
    scene.style.setProperty('--sphere-y', `${((event.clientY - bounds.top) / bounds.height - 0.5) * -20}px`)
  }

  const handlePointerLeave = () => {
    sceneRef.current?.style.setProperty('--cursor-opacity', '0')
    sceneRef.current?.style.setProperty('--tilt-x', '0deg')
    sceneRef.current?.style.setProperty('--tilt-y', '0deg')
    sceneRef.current?.style.setProperty('--sphere-x', '0px')
    sceneRef.current?.style.setProperty('--sphere-y', '0px')
  }

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
          ...(portal === 'legacy' ? {} : { portal }),
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
      sealPosOfflineScope()
      router.push(data.redirect)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  const handlePasskeyLogin = async () => {
    if (!form.username.trim()) {
      setError('Enter your username before using Face ID or fingerprint.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const start = await fetch('/api/auth/passkey/authenticate/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username.trim().toLowerCase(), portal }),
      })
      const options = await start.json()
      if (!start.ok) throw new Error(options.error || 'Passkey sign-in is unavailable.')
      const assertion = await startAuthentication({ optionsJSON: options })
      const finish = await fetch('/api/auth/passkey/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...assertion, portal }),
      })
      const result = await finish.json()
      if (!finish.ok) throw new Error(result.error || 'Passkey sign-in failed.')
      sealPosOfflineScope()
      router.push(result.redirect)
    } catch (error) {
      setError(getPasskeySignInError(error))
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
      sealPosOfflineScope()
      router.push(data.redirect)
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  const updatePinDigit = (index: number, rawValue: string) => {
    const digits = rawValue.replace(/\D/g, '').slice(0, 6)
    const value = digits ? `${securityPin.slice(0, index)}${digits}`.slice(0, 6) : securityPin.slice(0, index)
    setSecurityPin(value)
    setError('')
    const nextIndex = Math.min(index + Math.max(digits.length, 1), 5)
    if (digits) requestAnimationFrame(() => pinInputRefs.current[nextIndex]?.focus())
  }

  const handlePinKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Backspace' || securityPin[index]) return
    if (index > 0) {
      setSecurityPin(securityPin.slice(0, index - 1))
      requestAnimationFrame(() => pinInputRefs.current[index - 1]?.focus())
    }
  }

  return (
    <div
      ref={sceneRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`${styles.loginScene} min-h-screen bg-[#010521] flex items-center justify-center px-4 py-12`}
    >
      <div className={styles.holographicField} aria-hidden="true">
        <span className={styles.auroraOne} />
        <span className={styles.auroraTwo} />
        <span className={styles.auroraThree} />
        <span className={styles.lightRay} />
        <span className={styles.orbitOne} />
        <span className={styles.orbitTwo} />
        <div className={styles.networkSphere}>
          <span className={styles.sphereMeridian} />
          <span className={styles.sphereMeridian} />
          <span className={styles.sphereEquator} />
          {Array.from({ length: 18 }, (_, index) => (
            <span
              key={index}
              className={styles.sphereNode}
              style={{
                '--sphere-node-x': `${8 + ((index * 31) % 84)}%`,
                '--sphere-node-y': `${9 + ((index * 47) % 80)}%`,
                '--sphere-node-delay': `${-index * .53}s`,
              } as React.CSSProperties}
            />
          ))}
        </div>
        <span className={styles.signalPath} />
        <span className={styles.signalPath} />
        <span className={styles.signalPath} />
        <span className={styles.shootingStar} />
        <span className={`${styles.shootingStar} ${styles.shootingStarTwo}`} />
        <span className={`${styles.shootingStar} ${styles.shootingStarThree}`} />
        <span className={styles.largeShootingStar} />
        <span className={`${styles.largeShootingStar} ${styles.largeShootingStarTwo}`} />
        <svg className={styles.constellation} viewBox="0 0 1600 900" preserveAspectRatio="none">
          <path d="M-80 690 C220 460 380 800 680 555 S1090 260 1680 540" />
          <path d="M-120 265 C185 540 370 85 720 330 S1195 700 1710 210" />
          <path d="M95 930 C340 610 545 720 785 480 S1210 170 1510 -45" />
        </svg>
        <div className={styles.hudReadout}>
          <span>HIROMA / DIGITAL NETWORK</span>
          <span>LIVE INTERFACE</span>
        </div>
        <div className={styles.particleField}>
          {Array.from({ length: 126 }, (_, index) => (
            <span
              key={index}
              className={styles.particle}
              style={{
                left: `${(index * 37 + 7) % 100}%`,
                top: `${(index * 53 + 11) % 100}%`,
                '--delay': `${-(index % 17) * 0.62}s`,
                '--duration': `${8 + (index % 8) * 1.15}s`,
                '--drift-x': `${(index % 2 === 0 ? 1 : -1) * (14 + (index % 5) * 12)}px`,
                '--drift-y': `${-16 - (index % 6) * 11}px`,
                '--particle-size': `${index % 17 === 0 ? 5 : index % 5 === 0 ? 3 : 2}px`,
                '--particle-brightness': `${index % 17 === 0 ? 1.45 : index % 5 === 0 ? 1.12 : .78}`,
              } as React.CSSProperties}
            />
          ))}
        </div>
      </div>
      <span className={styles.cursorGlow} aria-hidden="true" />
      <div className={`${styles.loginCard} w-full max-w-4xl bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row`}>

        {/* Left panel */}
        <div className={`${styles.heroPanel} bg-[#010521] md:w-1/2 p-8 flex flex-col justify-between border-r border-white/5`}>
          <div>
            <Link href="/" className="flex items-center gap-3 mb-8">
              <div className="w-10 h-10 relative flex-shrink-0">
                <Image src="/hiroma-logo.jpg" alt="Hiroma logo" fill className="object-contain rounded-lg" priority />
              </div>
              <span className="text-white font-medium text-base tracking-[0.25em]">HIROMA</span>
            </Link>

            <p className="text-[#C9A84C] text-xs italic mb-6">Long lasting oil rich fragrance</p>

            <div className="flex flex-col gap-5">
              {[
                { icon: '\u{1F333}', text: 'Manage your downline & binary tree' },
                { icon: '\u{1F4B0}', text: 'Track commissions, points & earnings' },
                { icon: '\u{1F4E6}', text: 'Order products online & offline' },
                { icon: '\u{1F69A}', text: 'Monitor your distribution network' },
                { icon: '\u{1F4B3}', text: 'Real-time wallet & payout requests' },
              ].map((item) => (
                <div key={item.text} className="flex items-center gap-3">
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-white/60 text-sm">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-10">
            <p className="text-white/20 text-xs">&copy; {new Date().getFullYear()} Hiroma. All rights reserved.</p>
          </div>
          <div className={styles.heroVisual} aria-hidden="true">
            {Array.from({ length: 44 }, (_, index) => (
              <span
                key={index}
                className={styles.heroDust}
                style={{
                  '--dust-x': `${-10 + ((index * 73) % 120)}%`,
                  '--dust-y': `${-8 + ((index * 47) % 116)}%`,
                  '--dust-drift-x': `${-180 + ((index * 97) % 360)}px`,
                  '--dust-drift-y': `${-210 + ((index * 71) % 420)}px`,
                  '--dust-delay': `${-index * .48}s`,
                  '--dust-duration': `${7.5 + (index % 7) * 1.15}s`,
                  '--dust-size': `${index % 6 === 0 ? 5 : index % 3 === 0 ? 3 : 2}px`,
                } as React.CSSProperties}
              />
            ))}
          </div>
        </div>

        {/* Right panel - form */}
        <div className={`${styles.formPanel} md:w-1/2 p-8 flex flex-col justify-center bg-white`}>
          <h1 className="text-[#0D1B3E] text-2xl font-semibold mb-1">{portalCopy[portal].title}</h1>
          <p className="text-gray-400 text-sm mb-6">{passkeyMode ? 'Enter your username to continue with your device passkey' : portalCopy[portal].subtitle}</p>

          <form onSubmit={passkeyMode ? (event) => { event.preventDefault(); void handlePasskeyLogin() } : handleSubmit} className={requiresPin ? 'hidden' : 'flex flex-col gap-4'}>

            {requiresPin ? (
              <>
                <div className="mb-2">
                  <h2 className="text-[#0D1B3E] text-lg font-semibold">Security PIN</h2>
                  <p className="text-gray-400 text-sm mt-1">Enter the six-digit PIN configured for this account.</p>
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
                    placeholder={'\u2022'.repeat(6)}
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
            {!passkeyMode && <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Password <span className="text-[#C9A84C]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <rect x="5" y="10" width="14" height="10" rx="2" />
                    <path strokeLinecap="round" d="M8 10V7a4 4 0 018 0v3" />
                  </svg>
                </span>
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
            </div>}

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
              className={`${styles.primaryButton} w-full bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-3 hover:bg-[#E8C96A] transition-all duration-150 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  {requiresPin ? 'Verifying PIN...' : passkeyMode ? 'Checking passkey...' : 'Signing in...'}
                </span>
              ) : requiresPin ? 'Verify & sign in' : passkeyMode ? 'Continue with Face ID / Fingerprint' : 'Sign in'}
            </button>

            {!requiresPin && !passkeyMode && (portal === 'member' || portal === 'distributor' || portal === 'admin') && <>
              <div className="flex items-center gap-3"><span className="h-px flex-1 bg-gray-200" /><span className="text-[10px] uppercase tracking-wider text-gray-400">or</span><span className="h-px flex-1 bg-gray-200" /></div>
              <button type="button" disabled={loading} onClick={() => { setPasskeyMode(true); setError('') }} className="w-full rounded-lg border border-[#0D1B3E]/20 bg-white py-3 text-sm font-semibold text-[#0D1B3E] transition-colors hover:bg-[#F0F2F8] disabled:opacity-60">
                Use Face ID / Fingerprint
              </button>
              <Link href="/support" className="text-center text-xs text-[#C9A84C] hover:underline">Recover your account or contact support.</Link>
            </>}
            {!requiresPin && passkeyMode && <>
              <p className="text-center text-xs leading-relaxed text-gray-400">Use a passkey registered or synced on this device. Your password is not required.</p>
              <button type="button" disabled={loading} onClick={() => { setPasskeyMode(false); setError('') }} className="text-xs font-medium text-[#C9A84C] hover:underline disabled:opacity-60">Back to password sign-in</button>
            </>}
            {requiresPin && (
              <button type="button" onClick={() => { setRequiresPin(false); setSecurityPin(''); setError('') }}
                className="text-xs text-gray-400 hover:text-[#0D1B3E]">
                Back to username and password
              </button>
            )}

          </form>

          {!passkeyMode && <p className="text-center text-xs text-gray-400 mt-4">
            <Link href="https://hiromadigital.com" className="text-[#C9A84C] hover:underline">&larr; Back to Hiroma homepage</Link>
          </p>}
        </div>

      </div>

      {requiresPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#010521]/75 p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="security-pin-login-title">
          <form onSubmit={handlePinSubmit} className="my-auto max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-[28px] border border-[#7594f5]/45 bg-[radial-gradient(circle_at_15%_0%,rgba(26,66,151,.48),transparent_42%),linear-gradient(135deg,rgba(11,23,53,.98),rgba(5,11,28,.98))] shadow-[0_28px_90px_rgba(0,0,0,.62),inset_0_1px_0_rgba(255,255,255,.08)]">
            <div className="border-b border-[#7190ea]/25 px-4 py-5 text-center sm:px-10 sm:py-7">
              <div className="mx-auto flex h-12 w-12 items-center justify-center sm:h-16 sm:w-16 rounded-full border border-[#C9A84C]/65 bg-[#C9A84C]/10 shadow-[0_0_32px_rgba(201,168,76,.25)]"><svg aria-hidden="true" className="h-6 w-6 text-[#E8C96A] sm:h-8 sm:w-8" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 4.8-2.9 8.6-7 10-4.1-1.4-7-5.2-7-10V6l7-3z" /><rect x="8.5" y="10.5" width="7" height="5.5" rx="1" /><path strokeLinecap="round" d="M10.5 10.5V9a1.5 1.5 0 013 0v1.5" /></svg></div>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.24em] sm:mt-4 sm:text-[11px] sm:tracking-[0.32em] text-[#E8C96A]">Account security</p>
              <h2 id="security-pin-login-title" className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-3xl">Enter your security PIN</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed sm:mt-3 text-[#aebee8] sm:text-base">Enter the six-digit PIN configured for this account to continue.</p>
            </div>
            <div className="space-y-3 px-4 py-5 sm:space-y-4 sm:px-10 sm:py-6">
              <div className="flex items-center justify-between gap-3"><label className="block text-sm font-medium text-white sm:text-base">Six-digit PIN</label><button type="button" onClick={() => setShowSecurityPin((visible) => !visible)} className="shrink-0 text-sm font-medium text-[#E8C96A] hover:text-[#fff2b5]">{showSecurityPin ? 'Hide digits' : 'Show digits'}</button></div>
              <div className="grid grid-cols-6 gap-1.5 sm:gap-4 [&>input]:rounded-xl sm:[&>input]:rounded-2xl [&>input]:border-[#5374c9]/65 [&>input]:bg-[#0a1733]/90 [&>input]:text-xl [&>input]:text-white sm:[&>input]:text-2xl [&>input]:focus:-translate-y-1 [&>input]:focus:border-[#ffd85c] [&>input]:focus:bg-[#10234b] [&>input]:focus:shadow-[0_0_0_1px_rgba(255,216,92,.35),0_0_26px_rgba(255,195,64,.3)]" aria-label="Six-digit security PIN">
                {Array.from({ length: 6 }, (_, index) => <input key={index} ref={(element) => { pinInputRefs.current[index] = element }} type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} autoFocus={index === 0} maxLength={6} value={securityPin[index] ? (showSecurityPin ? securityPin[index] : '\u2022') : ''} onChange={(event) => updatePinDigit(index, event.target.value)} onKeyDown={(event) => handlePinKeyDown(index, event)} onPaste={(event) => { event.preventDefault(); updatePinDigit(index, event.clipboardData.getData('text')) }} aria-label={`PIN digit ${index + 1}`} className={`aspect-square min-w-0 rounded-xl border bg-[#F0F2F8] text-center text-xl font-semibold text-[#0D1B3E] outline-none transition-all duration-200 focus:-translate-y-0.5 focus:border-[#C9A84C] focus:bg-white focus:shadow-[0_8px_18px_rgba(201,168,76,0.18)] ${error ? 'border-red-300' : securityPin[index] ? 'border-[#C9A84C]/70' : 'border-[#0D1B3E]/15'}`} />)}
              </div>
              <p className="text-xs leading-relaxed text-[#aebee8] sm:text-sm">Enter each digit, or paste the complete six-digit PIN.</p>
              <div className="relative hidden">
                <input
                  type={showSecurityPin ? 'text' : 'password'}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={securityPin}
                  onChange={(e) => { setSecurityPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
                  placeholder={'\u2022'.repeat(6)}
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
              {error && <p className="text-xs text-red-200">{error}</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-[#7190ea]/25 px-4 py-4 sm:flex-row sm:justify-end sm:gap-3 sm:px-10 sm:py-5">
              <button type="button" onClick={() => { setRequiresPin(false); setSecurityPin(''); setShowSecurityPin(false); setError('') }} className="w-full rounded-xl border border-[#7190ea]/35 bg-[#152444]/75 px-5 py-3 text-sm font-medium text-white hover:bg-[#1c315b] sm:w-auto">Cancel</button>
              <button type="submit" disabled={loading} className="w-full rounded-xl bg-gradient-to-r from-[#f6d75d] to-[#dca23c] px-5 py-3 text-sm font-bold text-[#09112b] shadow-[0_8px_24px_rgba(214,157,48,.26)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto">
                {loading ? 'Verifying...' : 'Verify & sign in'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

export default function LoginPage() {
  return <LoginPortal />
}
