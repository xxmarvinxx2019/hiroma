'use client'

import { useState, useEffect, useCallback } from 'react'
import Pagination, { PaginationMeta } from '@/app/components/ui/Pagination'

// ============================================================
// TYPES
// ============================================================

interface Reseller {
  id: string
  full_name: string
  username: string
  mobile: string
  address: string | null
  status: string
  created_at: string
  reseller_profile: {
    total_points: number
    package: { name: string } | null
  } | null
  wallet: { balance: number } | null
}

interface VerifiedPin {
  id: string
  pin_code: string
  package: { id: string; name: string; price: number } | null
}

interface Slot {
  parentId: string
  position: 'left' | 'right'
  depth: number
  direct: boolean
}

interface VerifiedReferral {
  id: string
  full_name: string
  username: string
  package: string | null
  is_hiroma_node: boolean
  daily_referral_count: number
  daily_cap_reached: boolean
  left_available: boolean
  right_available: boolean
  left_is_direct: boolean
  right_is_direct: boolean
  left_slot: Slot | null
  right_slot: Slot | null
}

const PAGE_SIZE = 15

// ============================================================
// PLACEMENT CARD
// ============================================================

function PlacementCard({
  side,
  slot,
  available,
  isDirect,
  selected,
  onSelect,
  referralData,
}: {
  side: 'left' | 'right'
  slot: Slot | null
  available: boolean
  isDirect: boolean
  selected: boolean
  onSelect: () => void
  referralData: VerifiedReferral
}) {
  const label = side === 'left' ? 'Left leg' : 'Right leg'
  const letter = side === 'left' ? 'L' : 'R'

  if (!available || !slot) {
    return (
      <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center opacity-50 cursor-not-allowed">
        <p className="text-2xl font-bold text-gray-300 mb-1">{letter}</p>
        <p className="text-xs font-semibold text-gray-300">{label}</p>
        <p className="text-xs text-gray-300 mt-1">No space available</p>
      </div>
    )
  }

  return (
    <button
      onClick={onSelect}
      className={`border-2 rounded-xl p-4 text-center transition-all cursor-pointer w-full ${
        selected
          ? 'border-[#C9A84C] bg-[#fef9ee]'
          : 'border-[#0D1B3E]/15 hover:border-[#C9A84C]/50 hover:bg-[#fef9ee]/30'
      }`}
    >
      <p
        className="text-2xl font-bold mb-1"
        style={{ color: selected ? '#C9A84C' : '#c0c8d8' }}
      >
        {letter}
      </p>
      <p className={`text-xs font-semibold capitalize ${selected ? 'text-[#C9A84C]' : 'text-[#0D1B3E]'}`}>
        {label}
      </p>

      {/* Direct or deep placement indicator */}
      {isDirect ? (
        <span className="inline-block mt-1.5 text-xs bg-[#e8f7ef] text-[#1a7a4a] px-2 py-0.5 rounded-full">
          Direct slot
        </span>
      ) : (
        <span className="inline-block mt-1.5 text-xs bg-[#eef0f8] text-[#0D1B3E] px-2 py-0.5 rounded-full">
          Level {(slot.depth || 0) + 1} deep
        </span>
      )}

      {/* Daily cap warning */}
      {!referralData.is_hiroma_node && referralData.daily_cap_reached && (
        <p className="text-xs text-[#9a6f1e] mt-1">⚠️ Daily cap reached — overflow to Hiroma</p>
      )}
    </button>
  )
}

// ============================================================
// MAIN PAGE
// ============================================================

export default function CityResellersPage() {
  // List state
  const [resellers, setResellers] = useState<Reseller[]>([])
  const [meta, setMeta] = useState<PaginationMeta>({
    total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1,
  })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  // Modal state
  const [showForm, setShowForm] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Step 1 — PIN
  const [pinInput, setPinInput] = useState('')
  const [pinData, setPinData] = useState<VerifiedPin | null>(null)
  const [pinError, setPinError] = useState('')
  const [pinLoading, setPinLoading] = useState(false)

  // Step 2 — Referral
  const [referralInput, setReferralInput] = useState('')
  const [referralData, setReferralData] = useState<VerifiedReferral | null>(null)
  const [referralError, setReferralError] = useState('')
  const [referralLoading, setReferralLoading] = useState(false)
  const [placement, setPlacement] = useState<'left' | 'right' | null>(null)

  // Step 3 — Details
  const [form, setForm] = useState({
    full_name: '',
    username: '',
    mobile: '',
    address: '',
    password: '',
    confirmPassword: '',
  })
  const [nameCapInfo, setNameCapInfo] = useState<{ count: number; max: number; remaining: number } | null>(null)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')
  const [formSuccess, setFormSuccess] = useState('')

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => { setPage(1) }, [search])

  // Fetch resellers
  const fetchResellers = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...(search && { search }),
    })
    fetch(`/api/city/resellers?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setResellers(data.resellers || [])
        setMeta(data.meta || { total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 })
      })
      .finally(() => setLoading(false))
  }, [page, search])

  useEffect(() => { fetchResellers() }, [fetchResellers])

  // Reset form
  const resetForm = () => {
    setShowForm(false)
    setStep(1)
    setPinInput('')
    setPinData(null)
    setPinError('')
    setReferralInput('')
    setReferralData(null)
    setReferralError('')
    setPlacement(null)
    setForm({ full_name: '', username: '', mobile: '', address: '', password: '', confirmPassword: '' })
    setNameCapInfo(null)
    setUsernameAvailable(null)
    setFormError('')
    setFormSuccess('')
  }

  // Step 1 — Verify PIN
  const verifyPin = async () => {
    if (!pinInput.trim()) { setPinError('Please enter a PIN code.'); return }
    setPinLoading(true)
    setPinError('')
    const res = await fetch('/api/city/pins/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin_code: pinInput.trim().toUpperCase() }),
    })
    const data = await res.json()
    if (!res.ok) { setPinError(data.error || 'Invalid PIN.') }
    else { setPinData(data.pin); setStep(2) }
    setPinLoading(false)
  }

  // Step 2 — Verify referral
  const verifyReferral = async () => {
    if (!referralInput.trim()) { setReferralError('Please enter a referral username.'); return }
    setReferralLoading(true)
    setReferralError('')
    setPlacement(null)
    const res = await fetch('/api/city/resellers/verify-referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: referralInput.trim().toLowerCase() }),
    })
    const data = await res.json()
    if (!res.ok) {
      setReferralError(data.error || 'Referral not found.')
    } else {
      setReferralData(data.reseller)
      // Auto-select if only one leg available
      if (data.reseller.left_available && !data.reseller.right_available) {
        setPlacement('left')
      } else if (!data.reseller.left_available && data.reseller.right_available) {
        setPlacement('right')
      }
    }
    setReferralLoading(false)
  }

  const proceedToStep3 = () => {
    if (!placement) { setReferralError('Please choose a placement direction.'); return }
    setReferralError('')
    setStep(3)
  }

  // Check name cap
  const checkNameCap = async (name: string) => {
    if (!name.trim() || name.trim().length < 3) return
    const res = await fetch(`/api/city/resellers/check-name?name=${encodeURIComponent(name.trim())}`)
    const data = await res.json()
    setNameCapInfo(data)
  }

  // Check username availability
  const checkUsername = async (username: string) => {
    if (!username.trim() || username.trim().length < 3) return
    const res = await fetch(`/api/city/resellers/check-username?username=${encodeURIComponent(username.trim().toLowerCase())}`)
    const data = await res.json()
    setUsernameAvailable(data.available)
  }

  // Step 3 — Register
  const handleRegister = async () => {
    if (!form.full_name || !form.username || !form.mobile || !form.password) {
      setFormError('Please fill in all required fields.')
      return
    }
    if (form.password !== form.confirmPassword) {
      setFormError('Passwords do not match.')
      return
    }
    if (form.password.length < 6) {
      setFormError('Password must be at least 6 characters.')
      return
    }
    if (nameCapInfo && nameCapInfo.remaining === 0) {
      setFormError(`Maximum accounts reached for the name "${form.full_name}".`)
      return
    }
    if (usernameAvailable === false) {
      setFormError('Username is already taken.')
      return
    }

    setFormLoading(true)
    setFormError('')

    const res = await fetch('/api/city/resellers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: form.full_name,
        username: form.username.toLowerCase(),
        mobile: form.mobile,
        address: form.address,
        password: form.password,
        pin_id: pinData?.id,
        referrer_username: referralData?.username,
        placement,
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      setFormError(data.error || 'Registration failed.')
    } else {
      setFormSuccess(`✓ ${form.full_name} registered successfully!`)
      fetchResellers()
      setTimeout(() => resetForm(), 2500)
    }
    setFormLoading(false)
  }

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#0D1B3E]">My resellers</h1>
          <p className="text-sm text-gray-400 mt-0.5">Register and manage resellers in your city</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="bg-[#C9A84C] text-[#0D1B3E] text-xs font-semibold rounded-lg px-4 py-2 hover:bg-[#E8C96A] transition-colors"
        >
          + Register reseller
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total resellers', value: meta.total, accent: '#0D1B3E' },
          { label: 'Current page', value: `${meta.page} of ${meta.totalPages}`, accent: '#C9A84C' },
          { label: 'Per page', value: PAGE_SIZE, accent: '#0D1B3E' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-[#0D1B3E]/8 p-4" style={{ borderTop: `2px solid ${s.accent}` }}>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{s.label}</p>
            <p className="text-xl font-semibold" style={{ color: s.accent }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#0D1B3E]/8">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or username..."
            className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400"
          />
        </div>

        <div className="grid grid-cols-6 px-4 py-2 bg-[#F0F2F8]">
          {['Reseller', 'Mobile', 'Package', 'Points', 'Wallet', 'Status'].map((h) => (
            <p key={h} className="text-xs text-gray-400 uppercase tracking-wide font-medium">{h}</p>
          ))}
        </div>

        {loading ? (
          <div className="px-4 py-12 text-center">
            <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : resellers.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-gray-400 text-sm mb-2">No resellers found</p>
            <button onClick={() => setShowForm(true)} className="text-xs text-[#C9A84C] hover:underline">
              Register your first reseller →
            </button>
          </div>
        ) : (
          resellers.map((r) => (
            <div key={r.id} className="grid grid-cols-6 px-4 py-3 border-b border-[#0D1B3E]/5 hover:bg-[#F0F2F8]/50 transition-colors items-center">
              <div>
                <p className="text-xs font-medium text-[#0D1B3E]">{r.full_name}</p>
                <p className="text-xs text-gray-400">@{r.username}</p>
              </div>
              <p className="text-xs text-gray-400">{r.mobile}</p>
              <span>
                <span className="text-xs bg-[#fef6e4] text-[#9a6f1e] px-2 py-0.5 rounded-full">
                  {r.reseller_profile?.package?.name || '—'}
                </span>
              </span>
              <p className="text-xs font-medium text-[#C9A84C]">{r.reseller_profile?.total_points || 0} pts</p>
              <p className="text-xs font-medium text-[#0D1B3E]">₱{Number(r.wallet?.balance || 0).toLocaleString()}</p>
              <span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${r.status === 'active' ? 'bg-[#e8f7ef] text-[#1a7a4a]' : 'bg-[#fdecea] text-[#a03030]'}`}>
                  {r.status}
                </span>
              </span>
            </div>
          ))
        )}

        <Pagination meta={meta} onPageChange={setPage} />
      </div>

      {/* ════════════════════════════════
          REGISTRATION MODAL
      ════════════════════════════════ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">

            {/* Header */}
            <div className="bg-[#0D1B3E] px-6 py-4 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-white font-semibold text-sm">Register new reseller</h2>
                <p className="text-white/40 text-xs mt-0.5">
                  Step {step} of 3 — {step === 1 ? 'Verify PIN' : step === 2 ? 'Verify referral & placement' : 'Reseller details'}
                </p>
              </div>
              <button onClick={resetForm} className="text-white/50 hover:text-white text-lg cursor-pointer">✕</button>
            </div>

            {/* Progress bar */}
            <div className="flex flex-shrink-0">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex-1 h-1 transition-all duration-300" style={{ background: s <= step ? '#C9A84C' : '#F0F2F8' }} />
              ))}
            </div>

            <div className="p-6 overflow-y-auto flex-1">

              {/* ══ STEP 1: PIN ══ */}
              {step === 1 && (
                <div className="flex flex-col gap-5">
                  <div>
                    <h3 className="text-sm font-semibold text-[#0D1B3E] mb-1">Enter the PIN code</h3>
                    <p className="text-xs text-gray-400">The new reseller must have a starter package with an unused PIN.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">PIN code <span className="text-[#C9A84C]">*</span></label>
                    <input
                      value={pinInput}
                      onChange={(e) => { setPinInput(e.target.value.toUpperCase()); setPinError('') }}
                      onKeyDown={(e) => e.key === 'Enter' && verifyPin()}
                      placeholder="e.g. HRM-2026-GLD-12345"
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2.5 text-sm font-mono text-[#0D1B3E] outline-none focus:border-[#C9A84C] tracking-wider uppercase"
                    />
                    {pinError && <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><p className="text-red-500 text-xs">{pinError}</p></div>}
                  </div>
                  <button onClick={verifyPin} disabled={pinLoading || !pinInput.trim()} className="w-full bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-3 hover:bg-[#E8C96A] transition-colors disabled:opacity-60">
                    {pinLoading ? 'Verifying...' : 'Verify PIN →'}
                  </button>
                </div>
              )}

              {/* ══ STEP 2: REFERRAL & PLACEMENT ══ */}
              {step === 2 && (
                <div className="flex flex-col gap-5">

                  {/* PIN confirmed */}
                  <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-4 py-3">
                    <p className="text-xs text-[#1a7a4a] font-semibold">✓ PIN verified: {pinData?.pin_code}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Package: {pinData?.package?.name} · ₱{Number(pinData?.package?.price || 0).toLocaleString()}</p>
                  </div>

                  {/* Referral input */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Referrer's username <span className="text-[#C9A84C]">*</span></label>
                    <div className="flex gap-2">
                      <input
                        value={referralInput}
                        onChange={(e) => { setReferralInput(e.target.value.toLowerCase()); setReferralError(''); setReferralData(null); setPlacement(null) }}
                        onKeyDown={(e) => e.key === 'Enter' && verifyReferral()}
                        placeholder="Enter referrer's username"
                        className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                      />
                      <button
                        onClick={verifyReferral}
                        disabled={referralLoading || !referralInput.trim()}
                        className="bg-[#0D1B3E] text-white text-xs font-medium rounded-lg px-4 hover:bg-[#1A2F5E] transition-colors disabled:opacity-60 whitespace-nowrap"
                      >
                        {referralLoading ? '...' : 'Verify'}
                      </button>
                    </div>
                    {referralError && <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><p className="text-red-500 text-xs">{referralError}</p></div>}
                  </div>

                  {/* Referrer info + placement */}
                  {referralData && (
                    <div className="flex flex-col gap-3">
                      {/* Referrer confirmed */}
                      <div className="bg-[#F0F2F8] rounded-lg px-4 py-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#C9A84C]/20 border border-[#C9A84C]/40 flex items-center justify-center flex-shrink-0">
                          <span className="text-[#C9A84C] font-bold text-sm">
                            {referralData.is_hiroma_node ? 'H' : referralData.full_name.charAt(0)}
                          </span>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[#0D1B3E]">{referralData.full_name}</p>
                          <p className="text-xs text-gray-400">@{referralData.username} · {referralData.is_hiroma_node ? 'Top node' : `Package: ${referralData.package}`}</p>
                          {referralData.daily_cap_reached && (
                            <p className="text-xs text-[#9a6f1e] mt-0.5">⚠️ Daily cap reached (10/10) — new member will overflow to Hiroma</p>
                          )}
                        </div>
                      </div>

                      {/* Placement selector */}
                      <div>
                        <p className="text-xs font-medium text-[#0D1B3E] mb-1">
                          Choose placement direction
                        </p>
                        <p className="text-xs text-gray-400 mb-3">
                          The referrer picks which side. If the direct slot is occupied, the system finds the next available slot deeper in that direction.
                        </p>

                        <div className="grid grid-cols-2 gap-3">
                          <PlacementCard
                            side="left"
                            slot={referralData.left_slot}
                            available={referralData.left_available}
                            isDirect={referralData.left_is_direct}
                            selected={placement === 'left'}
                            onSelect={() => setPlacement('left')}
                            referralData={referralData}
                          />
                          <PlacementCard
                            side="right"
                            slot={referralData.right_slot}
                            available={referralData.right_available}
                            isDirect={referralData.right_is_direct}
                            selected={placement === 'right'}
                            onSelect={() => setPlacement('right')}
                            referralData={referralData}
                          />
                        </div>

                        {placement && (
                          <div className="mt-3 bg-[#fef9ee] border border-[#C9A84C]/30 rounded-lg px-3 py-2.5">
                            <p className="text-xs text-[#9a6f1e] font-medium">
                              📍 Placement preview
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {placement === 'left'
                                ? referralData.left_is_direct
                                  ? `Direct left leg of @${referralData.username}`
                                  : `Left direction — level ${(referralData.left_slot?.depth || 0) + 1} under @${referralData.username}`
                                : referralData.right_is_direct
                                ? `Direct right leg of @${referralData.username}`
                                : `Right direction — level ${(referralData.right_slot?.depth || 0) + 1} under @${referralData.username}`
                              }
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={() => { setStep(1); setReferralData(null); setPlacement(null) }} className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors">
                      ← Back
                    </button>
                    <button
                      onClick={proceedToStep3}
                      disabled={!referralData || !placement}
                      className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] transition-colors disabled:opacity-60"
                    >
                      Continue →
                    </button>
                  </div>
                </div>
              )}

              {/* ══ STEP 3: DETAILS ══ */}
              {step === 3 && (
                <div className="flex flex-col gap-4">

                  {/* Summary */}
                  <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-4 py-3">
                    <p className="text-xs text-[#1a7a4a] font-semibold mb-1">✓ PIN & referral verified</p>
                    <p className="text-xs text-gray-500">PIN: <strong>{pinData?.pin_code}</strong> · Package: <strong>{pinData?.package?.name}</strong></p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Referred by: <strong>@{referralData?.username}</strong> · {placement === 'left' ? referralData?.left_is_direct ? 'Direct left leg' : `Left direction (level ${(referralData?.left_slot?.depth || 0) + 1})` : referralData?.right_is_direct ? 'Direct right leg' : `Right direction (level ${(referralData?.right_slot?.depth || 0) + 1})`}
                    </p>
                  </div>

                  {/* Full name */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Full name <span className="text-[#C9A84C]">*</span></label>
                    <input
                      value={form.full_name}
                      onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                      onBlur={(e) => checkNameCap(e.target.value)}
                      placeholder="Juan dela Cruz"
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                    />
                    {nameCapInfo && (
                      <p className={`text-xs mt-1 ${nameCapInfo.remaining === 0 ? 'text-red-500' : nameCapInfo.remaining <= 2 ? 'text-[#9a6f1e]' : 'text-gray-400'}`}>
                        {nameCapInfo.remaining === 0
                          ? `⛔ Max accounts (${nameCapInfo.max}) reached for this name`
                          : `${nameCapInfo.remaining} of ${nameCapInfo.max} slots remaining for this name`}
                      </p>
                    )}
                  </div>

                  {/* Username */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Username <span className="text-[#C9A84C]">*</span></label>
                    <input
                      value={form.username}
                      onChange={(e) => { setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }); setUsernameAvailable(null) }}
                      onBlur={(e) => checkUsername(e.target.value)}
                      placeholder="juandc"
                      className={`w-full bg-[#F0F2F8] border rounded-lg px-3 py-2 text-sm outline-none transition-colors ${usernameAvailable === true ? 'border-[#1a7a4a] bg-[#f0faf5]' : usernameAvailable === false ? 'border-red-400 bg-red-50' : 'border-[#0D1B3E]/15 focus:border-[#C9A84C]'}`}
                    />
                    {usernameAvailable === true && <p className="text-xs text-[#1a7a4a] mt-1">✓ Username is available</p>}
                    {usernameAvailable === false && <p className="text-xs text-red-500 mt-1">✕ Username is already taken</p>}
                    <p className="text-xs text-gray-400 mt-1">Letters, numbers and underscores only.</p>
                  </div>

                  {/* Mobile */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Mobile <span className="text-[#C9A84C]">*</span></label>
                    <input
                      value={form.mobile}
                      onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                      placeholder="+63 9XX XXX XXXX"
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                    />
                  </div>

                  {/* Address */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Address</label>
                    <input
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                      placeholder="City / Municipality"
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                    />
                  </div>

                  {/* Password */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Password <span className="text-[#C9A84C]">*</span></label>
                      <input
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        placeholder="Min. 6 characters"
                        className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Confirm password <span className="text-[#C9A84C]">*</span></label>
                      <input
                        type="password"
                        value={form.confirmPassword}
                        onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                        placeholder="Re-enter password"
                        className={`w-full bg-[#F0F2F8] border rounded-lg px-3 py-2 text-sm outline-none transition-colors ${form.confirmPassword && form.password !== form.confirmPassword ? 'border-red-400' : 'border-[#0D1B3E]/15 focus:border-[#C9A84C]'}`}
                      />
                      {form.confirmPassword && form.password !== form.confirmPassword && (
                        <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                      )}
                    </div>
                  </div>

                  {formError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <p className="text-red-500 text-xs">{formError}</p>
                    </div>
                  )}
                  {formSuccess && (
                    <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-4 py-3">
                      <p className="text-[#1a7a4a] text-sm font-semibold">{formSuccess}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Closing form...</p>
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setStep(2); setFormError('') }} className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0] transition-colors">
                      ← Back
                    </button>
                    <button
                      onClick={handleRegister}
                      disabled={
                        formLoading ||
                        nameCapInfo?.remaining === 0 ||
                        usernameAvailable === false ||
                        (form.confirmPassword.length > 0 && form.password !== form.confirmPassword)
                      }
                      className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] transition-colors disabled:opacity-60"
                    >
                      {formLoading ? 'Registering...' : 'Register reseller ✓'}
                    </button>
                  </div>

                </div>
              )}

            </div>
          </div>
        </div>
      )}

    </div>
  )
}