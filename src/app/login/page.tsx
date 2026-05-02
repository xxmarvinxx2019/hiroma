'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'

type Role = 'regional' | 'provincial' | 'city' | 'reseller'

const roles: { value: Role; label: string; sub: string; icon: string }[] = [
  { value: 'reseller', label: 'Reseller', sub: 'MLM member', icon: '👤' },
  { value: 'city', label: 'City dist.', sub: 'Register resellers', icon: '🏙️' },
  { value: 'regional', label: 'Regional', sub: 'Distribution', icon: '🗺️' },
  { value: 'provincial', label: 'Provincial', sub: 'Distribution', icon: '🏛️' },
]

export default function LoginPage() {
  const router = useRouter()
  const [selectedRole, setSelectedRole] = useState<Role>('reseller')
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
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

      // ── If the returned role is admin, just redirect silently ──
      // ── For other roles, verify it matches selected role ──
      if (data.user.role !== 'admin' && data.user.role !== selectedRole) {
        setError(
          `This account is not registered as a ${selectedRole.replace('_', ' ')}.`
        )
        setLoading(false)
        return
      }

      // ── Redirect to the correct dashboard ──
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
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 mb-10">
              <div className="w-10 h-10 relative flex-shrink-0">
                <Image
                  src="/hiroma-logo.jpg"
                  alt="Hiroma logo"
                  fill
                  className="object-contain rounded-lg"
                  priority
                />
              </div>
              <span className="text-white font-medium text-base tracking-[0.25em]">
                HIROMA
              </span>
            </Link>

            {/* Tagline */}
            <p className="text-[#C9A84C] text-xs italic mb-8">
              Long lasting oil rich fragrance
            </p>

            {/* Features */}
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

          {/* Footer */}
          <div className="mt-10">
            <p className="text-white/20 text-xs">
              © {new Date().getFullYear()} Hiroma. All rights reserved.
            </p>
          </div>
        </div>

        {/* ── Right Panel — Form ── */}
        <div className="md:w-1/2 p-10 flex flex-col justify-center bg-white">
          <h1 className="text-[#0D1B3E] text-2xl font-semibold mb-1">
            Welcome back
          </h1>
          <p className="text-gray-400 text-sm mb-8">
            Sign in to your Hiroma account
          </p>

          {/* Role Selector */}
          <div className="mb-6">
            <p className="text-xs text-gray-400 mb-3">Sign in as</p>
            <div className="grid grid-cols-2 gap-2">
              {roles.map((role) => (
                <button
                  key={role.value}
                  type="button"
                  onClick={() => {
                    setSelectedRole(role.value)
                    setError('')
                  }}
                  className={`border rounded-lg p-3 text-center cursor-pointer transition-all duration-150 ${
                    selectedRole === role.value
                      ? 'border-[#C9A84C] bg-[#fef9ee]'
                      : 'border-gray-200 hover:border-[#C9A84C]/50'
                  }`}
                >
                  <div className="text-xl mb-1">{role.icon}</div>
                  <div
                    className={`text-xs font-medium ${
                      selectedRole === role.value
                        ? 'text-[#C9A84C]'
                        : 'text-[#0D1B3E]'
                    }`}
                  >
                    {role.label}
                  </div>
                  <div className="text-xs text-gray-400">{role.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            {/* Username */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Username <span className="text-[#C9A84C]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                  @
                </span>
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

            {/* Password */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">
                Password <span className="text-[#C9A84C]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
                  🔒
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
            </div>

            {/* Forgot Password */}
            <div className="flex justify-end -mt-2">
              <Link
                href="/forgot-password"
                className="text-xs text-[#C9A84C] hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <p className="text-red-500 text-xs">{error}</p>
              </div>
            )}

            {/* Submit Button */}
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
                  Signing in...
                </span>
              ) : (
                `Sign in as ${roles.find((r) => r.value === selectedRole)?.label}`
              )}
            </button>

          </form>

          {/* Notice */}
          <div className="mt-6 bg-[#F0F2F8] rounded-lg px-4 py-3">
            <p className="text-xs text-gray-400 leading-relaxed">
              New resellers are registered by your city distributor. Contact
              them with your starter package to get started.
            </p>
          </div>

          {/* Back to home */}
          <p className="text-center text-xs text-gray-400 mt-6">
            <Link href="/" className="text-[#C9A84C] hover:underline">
              ← Back to Hiroma homepage
            </Link>
          </p>
        </div>

      </div>
    </div>
  )
}