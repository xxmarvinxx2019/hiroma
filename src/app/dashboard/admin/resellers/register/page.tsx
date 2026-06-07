'use client'

function generateUsername(fullName: string): string {
  const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].replace(/[^a-z0-9]/g, '')
  const firstName = parts[0].replace(/[^a-z]/g, '')
  const initials  = parts.slice(1).map((p) => p.replace(/[^a-z]/g, '')[0] || '').join('')
  return (firstName + initials).replace(/[^a-z0-9]/g, '')
}

function isValidUsername(username: string): boolean {
  return /^[a-z][a-z0-9]*$/.test(username)
}

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface Pin {
  id: string
  pin_code: string
  package: { id: string; name: string; price: number } | null
}

interface AvailableSlot {
  node_id:   string
  user_id:   string
  full_name: string
  username:  string
  package:   string
  left_open:  boolean
  right_open: boolean
}

interface SelectedSlot {
  parent_node_id: string
  position: 'left' | 'right'
  parent_username: string
}

interface VerifiedReferral {
  id: string
  full_name: string
  username: string
  package: string | null
  is_hiroma_node: boolean
  daily_cap_reached: boolean
  node_id: string
}

export default function AdminRegisterResellerPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)

  // Step 1 — PIN
  const [pins, setPins]           = useState<Pin[]>([])
  const [pinSearch, setPinSearch] = useState('')
  const [pinData, setPinData]     = useState<Pin | null>(null)
  const [pinError, setPinError]   = useState('')
  const [pinsLoading, setPinsLoading] = useState(false)
  const pinInputRef = useRef<HTMLInputElement>(null)

  // Step 2 — Location (PSGC)
  const [regions, setRegions]     = useState<{ code: string; name: string }[]>([])
  const [provinces, setProvinces] = useState<{ code: string; name: string }[]>([])
  const [cityMunis, setCityMunis] = useState<{ code: string; name: string }[]>([])
  const [loadingProv, setLoadingProv] = useState(false)
  const [loadingCity, setLoadingCity] = useState(false)
  const [location, setLocation] = useState({
    region_code: '', region_name: '',
    province_code: '', province_name: '',
    city_muni_code: '', city_muni_name: '',
    street: '',
  })

  // Step 3 — Referral & slot
  const [referralInput, setReferralInput]     = useState('')
  const [referralData, setReferralData]       = useState<VerifiedReferral | null>(null)
  const [referralError, setReferralError]     = useState('')
  const [referralLoading, setReferralLoading] = useState(false)
  const [availableSlots, setAvailableSlots]   = useState<AvailableSlot[]>([])
  const [slotSearch, setSlotSearch]           = useState('')
  const [slotDropdownOpen, setSlotDropdownOpen] = useState(false)
  const [slotsLoading, setSlotsLoading]       = useState(false)
  const [selectedSlot, setSelectedSlot]       = useState<SelectedSlot | null>(null)

  // Step 4 — Details
  const [form, setForm] = useState({
    full_name: '', username: '', email: '', mobile: '', password: '', confirmPassword: '',
  })
  const [nameCapInfo, setNameCapInfo]             = useState<{ count: number; max: number; remaining: number } | null>(null)
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernameEdited, setUsernameEdited]       = useState(false)
  const [formLoading, setFormLoading]             = useState(false)
  const [formError, setFormError]                 = useState('')
  const [successData, setSuccessData]             = useState<{ full_name: string; username: string; package: any } | null>(null)
  const [adminId, setAdminId]                       = useState<string>('')

  // Auto-generate username
  useEffect(() => {
    if (usernameEdited || !form.full_name.trim()) return
    setForm((f) => ({ ...f, username: generateUsername(form.full_name) }))
    setUsernameAvailable(null)
  }, [form.full_name, usernameEdited])

  // Fetch admin's own unused PINs
  const fetchPins = useCallback((id?: string) => {
    const distId = id || adminId
    if (!distId) return
    setPinsLoading(true)
    fetch(`/api/admin/pins?status=unused&pageSize=200&city_dist_id=${distId}`)
      .then((r) => r.json())
      .then((d) => setPins(d.pins || []))
      .catch(() => {})
      .finally(() => setPinsLoading(false))
  }, [adminId])

  // Load admin ID then fetch pins on mount
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        const id = data.user?.id || ''
        setAdminId(id)
        fetchPins(id)
      })
      .catch(() => {})
  }, [])

  // Load regions
  useEffect(() => {
    fetch('https://psgc.gitlab.io/api/regions/')
      .then((r) => r.json())
      .then((data) => setRegions(data.map((r: any) => ({ code: r.code, name: r.name })).sort((a: any, b: any) => a.name.localeCompare(b.name))))
      .catch(() => {})
  }, [])

  // Load provinces when region changes
  useEffect(() => {
    if (!location.region_code) { setProvinces([]); setCityMunis([]); return }
    setLoadingProv(true)
    fetch(`https://psgc.gitlab.io/api/regions/${location.region_code}/provinces/`)
      .then((r) => r.json())
      .then((data) => setProvinces(data.map((p: any) => ({ code: p.code, name: p.name })).sort((a: any, b: any) => a.name.localeCompare(b.name))))
      .catch(() => setProvinces([]))
      .finally(() => setLoadingProv(false))
    setLocation((l) => ({ ...l, province_code: '', province_name: '', city_muni_code: '', city_muni_name: '' }))
    setCityMunis([])
  }, [location.region_code])

  // Load cities when province changes
  useEffect(() => {
    if (!location.province_code) { setCityMunis([]); return }
    setLoadingCity(true)
    fetch(`https://psgc.gitlab.io/api/provinces/${location.province_code}/cities-municipalities/`)
      .then((r) => r.json())
      .then((data) => setCityMunis(data.map((c: any) => ({ code: c.code, name: c.name })).sort((a: any, b: any) => a.name.localeCompare(b.name))))
      .catch(() => setCityMunis([]))
      .finally(() => setLoadingCity(false))
    setLocation((l) => ({ ...l, city_muni_code: '', city_muni_name: '' }))
  }, [location.province_code])

  // Close slot dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.slot-dropdown-container')) setSlotDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const resetForm = useCallback(() => {
    setStep(1)
    setPinData(null); setPinSearch(''); setPinError('')
    setLocation({ region_code: '', region_name: '', province_code: '', province_name: '', city_muni_code: '', city_muni_name: '', street: '' })
    setReferralInput(''); setReferralData(null); setReferralError('')
    setAvailableSlots([]); setSlotSearch(''); setSelectedSlot(null)
    setForm({ full_name: '', username: '', email: '', mobile: '', password: '', confirmPassword: '' })
    setNameCapInfo(null); setUsernameAvailable(null); setUsernameEdited(false)
    setFormError('')
  }, [])

  // Step 3 — Verify referral + load slots
  const verifyReferral = async () => {
    if (!referralInput.trim()) { setReferralError('Please enter a referral username.'); return }
    setReferralLoading(true); setReferralError('')
    setReferralData(null); setAvailableSlots([]); setSlotSearch(''); setSelectedSlot(null)

    const res = await fetch('/api/city/resellers/verify-referral', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: referralInput.trim().toLowerCase() }),
    })
    const data = await res.json()
    if (!res.ok) { setReferralError(data.error || 'Referral not found.'); setReferralLoading(false); return }
    setReferralData(data.reseller)

    setSlotsLoading(true)
    const slotsRes = await fetch(`/api/city/resellers/available-slots?referrer=${referralInput.trim().toLowerCase()}`)
    const slotsData = await slotsRes.json()
    setAvailableSlots(slotsData.slots || [])
    setSlotsLoading(false)
    setReferralLoading(false)
  }

  const checkNameCap = async (name: string) => {
    if (!name.trim() || name.trim().length < 3) return
    const res  = await fetch(`/api/city/resellers/check-name?name=${encodeURIComponent(name.trim())}`)
    const data = await res.json()
    setNameCapInfo(data)
  }

  const checkUsername = async (uname: string) => {
    if (!uname.trim() || uname.trim().length < 3) return
    const res  = await fetch(`/api/city/resellers/check-username?username=${encodeURIComponent(uname.trim().toLowerCase())}`)
    const data = await res.json()
    setUsernameAvailable(data.available)
  }

  // Build full address from location
  const fullAddress = [location.street, location.city_muni_name, location.province_name, location.region_name]
    .filter(Boolean).join(', ')

  // Step 4 — Register
  const handleRegister = async () => {
    if (!form.full_name || !form.username || !form.mobile || !form.email || !form.password) {
      setFormError('Please fill in all required fields including email.'); return
    }
    if (!isValidUsername(form.username.toLowerCase())) {
      setFormError('Username must start with a letter and contain only letters and numbers.'); return
    }
    const expectedBase = generateUsername(form.full_name)
    if (form.username.toLowerCase().replace(/[0-9]+$/, '') !== expectedBase) {
      setFormError(`Username must follow the format: "${expectedBase}" or "${expectedBase}1", etc.`); return
    }
    if (form.password !== form.confirmPassword) { setFormError('Passwords do not match.'); return }
    if (form.password.length < 6) { setFormError('Password must be at least 6 characters.'); return }
    if (nameCapInfo && nameCapInfo.remaining === 0) { setFormError(`Maximum accounts reached for "${form.full_name}".`); return }
    if (usernameAvailable === false) { setFormError('Username is already taken.'); return }
    if (!selectedSlot) { setFormError('No placement slot selected.'); return }
    if (!location.city_muni_name) { setFormError('Please select a complete location.'); return }

    setFormLoading(true); setFormError('')

    const res = await fetch('/api/admin/resellers/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: form.full_name, username: form.username.toLowerCase(),
        email: form.email, mobile: form.mobile, password: form.password,
        address: fullAddress,
        pin_id: pinData?.id,
        referrer_username: referralData?.username,
        actual_parent_node_id: selectedSlot.parent_node_id,
        actual_position: selectedSlot.position,
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      setFormError(data.error || 'Registration failed.')
    } else {
      setSuccessData({ full_name: form.full_name, username: form.username.toLowerCase(), package: data.package || null })
    }
    setFormLoading(false)
  }

  const filteredPins = pins.filter((p) =>
    !pinSearch.trim() ||
    p.pin_code.toLowerCase().includes(pinSearch.toLowerCase()) ||
    p.package?.name.toLowerCase().includes(pinSearch.toLowerCase())
  )

  return (
    <div className="max-w-2xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <button onClick={() => router.push('/dashboard/admin/resellers')}
          className="text-xs text-gray-400 hover:text-[#0D1B3E] transition-colors mb-3 flex items-center gap-1">
          ← Back to Resellers
        </button>
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Register Reseller</h1>
        <p className="text-sm text-gray-400 mt-0.5">Register a new reseller directly as admin</p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        {['PIN', 'Location', 'Referral & Slot', 'Details'].map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
              step > i + 1 ? 'bg-[#1a7a4a] text-white' : step === i + 1 ? 'bg-[#C9A84C] text-[#0D1B3E]' : 'bg-[#F0F2F8] text-gray-400'
            }`}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-xs font-medium ${step === i + 1 ? 'text-[#0D1B3E]' : 'text-gray-400'}`}>{label}</span>
            {i < 3 && <div className="flex-1 h-px bg-[#0D1B3E]/10" />}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-6">

        {/* ══ STEP 1: PIN ══ */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold text-[#0D1B3E] mb-1">Select PIN</h3>
              <p className="text-xs text-gray-400">Select an unused PIN from your generated PINs.</p>
            </div>

            <div className="relative">
              <input
                ref={pinInputRef}
                value={pinSearch}
                onChange={(e) => setPinSearch(e.target.value)}
                placeholder="Search PIN code or package..."
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2.5 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400"
              />
            </div>

            {pinError && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2"><p className="text-red-500 text-xs">{pinError}</p></div>}

            {pinsLoading ? (
              <div className="text-center py-6"><div className="w-5 h-5 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin mx-auto" /></div>
            ) : filteredPins.length === 0 ? (
              <div className="text-center py-6 bg-[#F0F2F8] rounded-xl">
                <p className="text-xs text-gray-400 mb-2">No unused PINs available</p>
                <a href="/dashboard/admin/pins" className="text-xs text-[#C9A84C] hover:underline">Generate PINs first →</a>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto border border-[#0D1B3E]/8 rounded-xl">
                {filteredPins.map((pin) => (
                  <div key={pin.id}
                    onClick={() => { setPinData(pin); setPinError('') }}
                    className={`px-4 py-3 border-b border-[#0D1B3E]/5 last:border-0 cursor-pointer hover:bg-[#F0F2F8] transition-colors ${pinData?.id === pin.id ? 'bg-[#fef9ee] border-l-2 border-l-[#C9A84C]' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-mono font-semibold text-[#0D1B3E]">{pin.pin_code}</p>
                        <p className="text-[10px] text-gray-400">{pin.package?.name} · ₱{Number(pin.package?.price || 0).toLocaleString()}</p>
                      </div>
                      {pinData?.id === pin.id && <span className="text-[#C9A84C] text-xs font-bold">✓ Selected</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {pinData && (
              <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-4 py-3">
                <p className="text-xs text-[#1a7a4a] font-semibold">✓ PIN selected: {pinData.pin_code}</p>
                <p className="text-xs text-gray-400 mt-0.5">Package: {pinData.package?.name} · ₱{Number(pinData.package?.price || 0).toLocaleString()}</p>
              </div>
            )}

            <button onClick={() => { if (!pinData) { setPinError('Please select a PIN.'); return }; setStep(2) }}
              disabled={!pinData}
              className="w-full bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-3 hover:bg-[#E8C96A] disabled:opacity-60 transition-colors">
              Continue →
            </button>
          </div>
        )}

        {/* ══ STEP 2: LOCATION ══ */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-4 py-3">
              <p className="text-xs text-[#1a7a4a] font-semibold">✓ PIN: {pinData?.pin_code} · {pinData?.package?.name}</p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-[#0D1B3E] mb-1">Reseller Location</h3>
              <p className="text-xs text-gray-400">Select the reseller's location in the Philippines.</p>
            </div>

            {/* Region */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Region <span className="text-[#C9A84C]">*</span></label>
              <select value={location.region_code}
                onChange={(e) => {
                  const opt = regions.find((r) => r.code === e.target.value)
                  setLocation((l) => ({ ...l, region_code: e.target.value, region_name: opt?.name || '' }))
                }}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]">
                <option value="">Select region...</option>
                {regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              </select>
            </div>

            {/* Province */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Province <span className="text-[#C9A84C]">*</span></label>
              <select value={location.province_code} disabled={!location.region_code || loadingProv}
                onChange={(e) => {
                  const opt = provinces.find((p) => p.code === e.target.value)
                  setLocation((l) => ({ ...l, province_code: e.target.value, province_name: opt?.name || '' }))
                }}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] disabled:opacity-50">
                <option value="">{loadingProv ? 'Loading...' : 'Select province...'}</option>
                {provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </div>

            {/* City/Municipality */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">City / Municipality <span className="text-[#C9A84C]">*</span></label>
              <select value={location.city_muni_code} disabled={!location.province_code || loadingCity}
                onChange={(e) => {
                  const opt = cityMunis.find((c) => c.code === e.target.value)
                  setLocation((l) => ({ ...l, city_muni_code: e.target.value, city_muni_name: opt?.name || '' }))
                }}
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] disabled:opacity-50">
                <option value="">{loadingCity ? 'Loading...' : 'Select city/municipality...'}</option>
                {cityMunis.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>

            {/* Street/Barangay */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Street / Barangay <span className="text-gray-300">(optional)</span></label>
              <input value={location.street}
                onChange={(e) => setLocation((l) => ({ ...l, street: e.target.value }))}
                placeholder="e.g. Brgy. San Jose, Rizal St."
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />
            </div>

            {/* Preview */}
            {location.city_muni_name && (
              <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-400 mb-0.5">Address preview</p>
                <p className="text-xs text-[#1a7a4a] font-medium">{fullAddress}</p>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0]">← Back</button>
              <button onClick={() => { if (!location.city_muni_name) return; setStep(3) }}
                disabled={!location.city_muni_name}
                className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] disabled:opacity-60">
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ══ STEP 3: REFERRAL & SLOT ══ */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-4 py-3">
              <p className="text-xs text-[#1a7a4a] font-semibold">✓ PIN: {pinData?.pin_code} · {pinData?.package?.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">📍 {fullAddress}</p>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Referrer's username <span className="text-[#C9A84C]">*</span></label>
              <div className="flex gap-2">
                <input value={referralInput}
                  onChange={(e) => { setReferralInput(e.target.value.toLowerCase()); setReferralError(''); setReferralData(null); setAvailableSlots([]); setSlotSearch('') }}
                  onKeyDown={(e) => e.key === 'Enter' && verifyReferral()}
                  placeholder="Enter referrer's username"
                  className="flex-1 bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]" />
                <button onClick={verifyReferral} disabled={referralLoading || !referralInput.trim()}
                  className="bg-[#0D1B3E] text-white text-xs font-medium rounded-lg px-4 hover:bg-[#1A2F5E] disabled:opacity-60">
                  {referralLoading ? '...' : 'Verify'}
                </button>
              </div>
              {referralError && <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><p className="text-red-500 text-xs">{referralError}</p></div>}
            </div>

            {referralData && (
              <div className="flex flex-col gap-3">
                <div className="bg-[#F0F2F8] rounded-lg px-4 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#C9A84C]/20 border border-[#C9A84C]/40 flex items-center justify-center flex-shrink-0">
                    <span className="text-[#C9A84C] font-bold text-sm">{referralData.is_hiroma_node ? 'H' : referralData.full_name.charAt(0)}</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#0D1B3E]">{referralData.full_name}</p>
                    <p className="text-xs text-gray-400">@{referralData.username} · {referralData.is_hiroma_node ? 'Top node' : `Package: ${referralData.package}`}</p>
                    {referralData.daily_cap_reached && <p className="text-xs text-[#9a6f1e] mt-0.5">⚠️ Daily cap reached — overflow to Hiroma</p>}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-[#0D1B3E] mb-1.5">
                    Search available slots
                    {slotsLoading && <span className="text-gray-400 font-normal ml-1">— loading...</span>}
                    {!slotsLoading && availableSlots.length > 0 && <span className="text-gray-400 font-normal ml-1">— {availableSlots.length} found</span>}
                  </p>
                  <div className="relative slot-dropdown-container">
                    <input value={slotSearch}
                      onChange={(e) => { setSlotSearch(e.target.value); setSlotDropdownOpen(true) }}
                      onFocus={() => setSlotDropdownOpen(true)}
                      placeholder="Type name or username..."
                      className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] placeholder:text-gray-400" />
                    {slotDropdownOpen && !slotsLoading && availableSlots.length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-50 bg-white border border-[#0D1B3E]/15 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                        {availableSlots.filter((s) => !slotSearch.trim() || s.full_name.toLowerCase().includes(slotSearch.toLowerCase()) || s.username.toLowerCase().includes(slotSearch.toLowerCase()))
                          .map((slot) => (
                            <div key={slot.node_id} className="px-3 py-2 border-b border-[#0D1B3E]/5 last:border-0 hover:bg-[#F0F2F8]">
                              <p className="text-xs font-medium text-[#0D1B3E]">{slot.full_name}</p>
                              <p className="text-[10px] text-gray-400 mb-1">@{slot.username} · {slot.package}</p>
                              <div className="flex gap-1.5">
                                {slot.left_open && (
                                  <button onClick={() => { setSelectedSlot({ parent_node_id: slot.node_id, position: 'left', parent_username: slot.username }); setSlotSearch(`${slot.full_name} (@${slot.username}) — Left`); setSlotDropdownOpen(false) }}
                                    className="text-[10px] bg-[#0D1B3E] text-white px-2.5 py-1 rounded-full hover:bg-[#1A2F5E]">← Left</button>
                                )}
                                {slot.right_open && (
                                  <button onClick={() => { setSelectedSlot({ parent_node_id: slot.node_id, position: 'right', parent_username: slot.username }); setSlotSearch(`${slot.full_name} (@${slot.username}) — Right`); setSlotDropdownOpen(false) }}
                                    className="text-[10px] bg-[#C9A84C] text-[#0D1B3E] px-2.5 py-1 rounded-full hover:bg-[#E8C96A]">Right →</button>
                                )}
                              </div>
                            </div>
                          ))}
                        {availableSlots.filter((s) => !slotSearch.trim() || s.full_name.toLowerCase().includes(slotSearch.toLowerCase()) || s.username.toLowerCase().includes(slotSearch.toLowerCase())).length === 0 && (
                          <p className="text-xs text-gray-400 px-3 py-2">No matching slots found.</p>
                        )}
                      </div>
                    )}
                  </div>
                  {selectedSlot && (
                    <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-3 py-2 mt-2">
                      <p className="text-xs text-[#1a7a4a] font-semibold">✓ Placement: {selectedSlot.position} leg under @{selectedSlot.parent_username}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <button onClick={() => setStep(2)} className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0]">← Back</button>
              <button onClick={() => { if (!selectedSlot) { setReferralError('Please select a placement slot.'); return }; setReferralError(''); setStep(4) }}
                disabled={!selectedSlot}
                className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] disabled:opacity-60">
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ══ STEP 4: DETAILS ══ */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-4 py-3">
              <p className="text-xs text-[#1a7a4a] font-semibold mb-1">✓ All confirmed</p>
              <p className="text-xs text-gray-500">PIN: <strong>{pinData?.pin_code}</strong> · {pinData?.package?.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">📍 {fullAddress}</p>
              <p className="text-xs text-gray-500 mt-0.5">Referrer: <strong>@{referralData?.username}</strong> · <strong>{selectedSlot?.position}</strong> leg under <strong>@{selectedSlot?.parent_username}</strong></p>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Full name <span className="text-[#C9A84C]">*</span></label>
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                onBlur={(e) => checkNameCap(e.target.value)} placeholder="Juan dela Cruz"
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
              {nameCapInfo && (
                <p className={`text-xs mt-1 ${nameCapInfo.remaining === 0 ? 'text-red-500' : nameCapInfo.remaining <= 2 ? 'text-[#9a6f1e]' : 'text-gray-400'}`}>
                  {nameCapInfo.remaining === 0 ? `⛔ Max accounts reached for this name` : `${nameCapInfo.remaining} of ${nameCapInfo.max} slots remaining`}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Username <span className="text-[#C9A84C]">*</span></label>
              <input value={form.username}
                onChange={(e) => { setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }); setUsernameAvailable(null); setUsernameEdited(true) }}
                onBlur={(e) => checkUsername(e.target.value)} placeholder="juandc"
                className={`w-full bg-[#F0F2F8] border rounded-lg px-3 py-2 text-sm outline-none transition-colors ${usernameAvailable === true ? 'border-[#1a7a4a] bg-[#f0faf5]' : usernameAvailable === false ? 'border-red-400 bg-red-50' : 'border-[#0D1B3E]/15 focus:border-[#C9A84C]'}`} />
              {usernameAvailable === true  && <p className="text-xs text-[#1a7a4a] mt-1">✓ Available</p>}
              {usernameAvailable === false && <p className="text-xs text-red-500 mt-1">✕ Already taken</p>}
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Mobile <span className="text-[#C9A84C]">*</span></label>
              <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                placeholder="+63 9XX XXX XXXX"
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Email address <span className="text-[#C9A84C]">*</span></label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="e.g. juan@email.com"
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Password <span className="text-[#C9A84C]">*</span></label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Min. 6 characters"
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Confirm <span className="text-[#C9A84C]">*</span></label>
                <input type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                  placeholder="Re-enter password"
                  className={`w-full bg-[#F0F2F8] border rounded-lg px-3 py-2 text-sm outline-none ${form.confirmPassword && form.password !== form.confirmPassword ? 'border-red-400' : 'border-[#0D1B3E]/15 focus:border-[#C9A84C]'}`} />
                {form.confirmPassword && form.password !== form.confirmPassword && <p className="text-xs text-red-500 mt-1">Passwords do not match</p>}
              </div>
            </div>

            {formError && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2"><p className="text-red-500 text-xs">{formError}</p></div>}

            <div className="flex gap-2 pt-1">
              <button onClick={() => { setStep(3); setFormError('') }} className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] text-sm rounded-lg py-2.5 hover:bg-[#e4e7f0]">← Back</button>
              <button onClick={handleRegister}
                disabled={formLoading || nameCapInfo?.remaining === 0 || usernameAvailable === false || (form.confirmPassword.length > 0 && form.password !== form.confirmPassword)}
                className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] disabled:opacity-60">
                {formLoading ? 'Registering...' : 'Register Reseller ✓'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Success Modal */}
      {successData && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center px-4 overflow-y-auto py-6">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden my-auto">

            {/* Header */}
            <div className="bg-[#0D1B3E] px-6 py-6 text-center relative">
              <div className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(ellipse 60% 60% at 50% 100%, rgba(201,168,76,0.12) 0%, transparent 70%)' }} />
              <div className="w-16 h-16 bg-[#C9A84C]/20 border-2 border-[#C9A84C]/40 rounded-full flex items-center justify-center mx-auto mb-3 relative">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <path d="M6 16L13 23L26 9" stroke="#C9A84C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <p className="text-[#C9A84C] text-[10px] tracking-widest uppercase mb-1 relative">Welcome to Hiroma</p>
              <h2 className="text-white font-bold text-xl relative">Registration Successful! 🎉</h2>
              <p className="text-white/60 text-sm mt-2 relative">
                <span className="text-[#C9A84C] font-semibold">{successData.full_name}</span> is now an active Hiroma reseller
              </p>
              <p className="text-white/40 text-xs mt-1 relative">@{successData.username}</p>
            </div>

            <div className="p-5 space-y-4">

              {/* Account credentials reminder */}
              <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-[#1a7a4a] mb-2">✓ Account Created Successfully</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Full name</span>
                    <span className="font-medium text-[#0D1B3E]">{successData.full_name}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Username</span>
                    <span className="font-medium text-[#0D1B3E] font-mono">@{successData.username}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Status</span>
                    <span className="text-[#1a7a4a] font-semibold">Active ✓</span>
                  </div>
                </div>
              </div>

              {successData.package && (
                <>
                  {/* Package name + total */}
                  <div className="flex items-center justify-between bg-[#fef9ee] border border-[#C9A84C]/20 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Package Availed</p>
                      <p className="text-sm font-bold text-[#0D1B3E]">{successData.package.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Total Value</p>
                      <p className="text-sm font-bold text-[#C9A84C]">₱{Number(successData.package.total_price).toLocaleString()}</p>
                    </div>
                  </div>

                  {/* Price breakdown */}
                  <div className="bg-[#F0F2F8] rounded-xl px-4 py-3 space-y-2">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-2">Price Breakdown</p>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">PIN Price</span>
                      <span className="font-medium text-[#0D1B3E]">₱{Number(successData.package.pin_price).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Products Value (SRP)</span>
                      <span className="font-medium text-[#0D1B3E]">₱{Number(successData.package.products_total).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs pt-2 border-t border-[#0D1B3E]/8 font-semibold">
                      <span className="text-[#0D1B3E]">Total Package Value</span>
                      <span className="text-[#C9A84C]">₱{Number(successData.package.total_price).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Products list */}
                  {successData.package.products?.length > 0 && (
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-2">Included Products</p>
                      <div className="space-y-1.5">
                        {successData.package.products.map((p: any, i: number) => (
                          <div key={i} className="flex items-center justify-between bg-[#F0F2F8] rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${p.type === 'physical' ? 'bg-[#eef0f8] text-[#0D1B3E]' : 'bg-[#f0f7ff] text-[#2563eb]'}`}>
                                {p.type}
                              </span>
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-[#0D1B3E] truncate">{p.name}</p>
                                <p className="text-[10px] text-gray-400">SRP: ₱{Number(p.srp).toLocaleString()} × {p.quantity}</p>
                              </div>
                            </div>
                            <span className="text-xs font-semibold text-[#0D1B3E] ml-2">₱{Number(p.subtotal).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Next steps */}
              <div className="bg-[#F0F2F8] rounded-xl px-4 py-3">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-2">Next Steps</p>
                <div className="space-y-1.5">
                  {[
                    '📱 Share login credentials with the reseller',
                    '🛍️ Hand over the physical products included in the package',
                    '📊 Monitor their progress in the Resellers dashboard',
                  ].map((step, i) => (
                    <p key={i} className="text-xs text-gray-500">{step}</p>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={() => { setSuccessData(null); resetForm(); fetchPins() }}
                  className="flex-1 bg-[#F0F2F8] text-[#0D1B3E] font-semibold text-sm rounded-xl py-3 hover:bg-[#e4e7f0] transition-colors">
                  Register Another
                </button>
                <button onClick={() => router.push('/dashboard/admin/resellers')}
                  className="flex-1 bg-[#C9A84C] text-[#0D1B3E] font-bold text-sm rounded-xl py-3 hover:bg-[#E8C96A] transition-colors">
                  View Resellers →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}