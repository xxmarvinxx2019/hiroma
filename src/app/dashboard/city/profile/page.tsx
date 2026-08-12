'use client'

import { useState, useEffect } from 'react'
import ProfilePhotoUploader from '@/app/components/profile/ProfilePhotoUploader'

type LocationItem = { code: string; name: string }
type OutletForm = { name: string; street: string; region_code: string; region_name: string; province_code: string; province_name: string; city_muni_code: string; city_muni_name: string; barangay_code: string; barangay_name: string; zip_code: string }
const blankOutlet: OutletForm = { name: '', street: '', region_code: '', region_name: '', province_code: '', province_name: '', city_muni_code: '', city_muni_name: '', barangay_code: '', barangay_name: '', zip_code: '' }

// ============================================================
// TYPES
// ============================================================

interface CityUser {
  id: string
  full_name: string
  username: string
  email: string | null
  mobile: string
  profile_photo: string | null
  address: string | null
  distributor_profile: {
    coverage_area: string
    dist_level: string
  } | null
}

// ============================================================
// SECTION WRAPPER
// ============================================================

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-[#0D1B3E]/8 overflow-hidden">
      <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
        <h2 className="text-sm font-semibold text-[#0D1B3E]">{title}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function InputField({
  label, value, onChange, type = 'text', placeholder, disabled, hint,
}: {
  label: string; value: string; onChange?: (v: string) => void
  type?: string; placeholder?: string; disabled?: boolean; hint?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-gray-500">{label}</label>
        {disabled && <span className="text-[10px] text-gray-400 flex items-center gap-0.5">🔒 Admin only</span>}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-[#F0F2F8]"
      />
      {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}

// ============================================================
// PAGE
// ============================================================

export default function CityProfilePage() {
  const [user, setUser]       = useState<CityUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Profile form
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null)
  const [profileForm, setProfileForm] = useState({ full_name: '', email: '', mobile: '', address: '' })
  const [profileSaving, setProfileSaving]   = useState(false)
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileError, setProfileError]     = useState('')
  const [outlet, setOutlet] = useState<OutletForm>(blankOutlet)
  const [hasOutlet, setHasOutlet] = useState(false)
  const [regions, setRegions] = useState<LocationItem[]>([])
  const [provinces, setProvinces] = useState<LocationItem[]>([])
  const [cities, setCities] = useState<LocationItem[]>([])
  const [barangays, setBarangays] = useState<LocationItem[]>([])
  const [outletSaving, setOutletSaving] = useState(false)
  const [outletMessage, setOutletMessage] = useState('')

  // Password form
  const [passwordForm, setPasswordForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [passwordSaving, setPasswordSaving]   = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [passwordError, setPasswordError]     = useState('')

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user)
          setProfilePhoto(data.user.profile_photo || null)
          setProfileForm({
            full_name: data.user.full_name || '',
            email:     data.user.email     || '',
            mobile:    data.user.mobile    || '',
            address:   data.user.address   || '',
          })
        }
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('https://psgc.gitlab.io/api/regions/').then((r) => r.json()).then(setRegions).catch(() => undefined)
    fetch('/api/city/profile').then((r) => r.json()).then(({ outlet: saved }) => {
      if (!saved?.fulfillment_outlet_address) return
      setHasOutlet(true)
      setOutlet({
        name: saved.fulfillment_outlet_name || '', street: saved.fulfillment_outlet_address.split(', ')[0] || '',
        region_code: saved.fulfillment_outlet_region_code || '', region_name: saved.fulfillment_outlet_region_name || '',
        province_code: saved.fulfillment_outlet_province_code || '', province_name: saved.fulfillment_outlet_province_name || '',
        city_muni_code: saved.fulfillment_outlet_city_muni_code || '', city_muni_name: saved.fulfillment_outlet_city_muni_name || '',
        barangay_code: saved.fulfillment_outlet_barangay_code || '', barangay_name: saved.fulfillment_outlet_barangay_name || '', zip_code: saved.fulfillment_outlet_zip_code || '',
      })
    }).catch(() => undefined)
  }, [])

  const loadProvinces = async (regionCode: string) => {
    const items = await fetch(`https://psgc.gitlab.io/api/regions/${regionCode}/provinces/`).then((r) => r.json())
    setProvinces(items); setCities([]); setBarangays([])
  }
  const loadCities = async (provinceCode: string) => {
    const items = await fetch(`https://psgc.gitlab.io/api/provinces/${provinceCode}/cities-municipalities/`).then((r) => r.json())
    setCities(items); setBarangays([])
  }
  const loadBarangays = async (cityCode: string) => {
    const items = await fetch(`https://psgc.gitlab.io/api/cities-municipalities/${cityCode}/barangays/`).then((r) => r.json())
    setBarangays(items)
  }
  const setOutletSelect = (key: 'region' | 'province' | 'city' | 'barangay', code: string) => {
    const source = key === 'region' ? regions : key === 'province' ? provinces : key === 'city' ? cities : barangays
    const selected = source.find((item) => item.code === code)
    if (!selected) return
    if (key === 'region') { setOutlet((f) => ({ ...f, region_code: code, region_name: selected.name, province_code: '', province_name: '', city_muni_code: '', city_muni_name: '', barangay_code: '', barangay_name: '' })); void loadProvinces(code) }
    if (key === 'province') { setOutlet((f) => ({ ...f, province_code: code, province_name: selected.name, city_muni_code: '', city_muni_name: '', barangay_code: '', barangay_name: '' })); void loadCities(code) }
    if (key === 'city') { setOutlet((f) => ({ ...f, city_muni_code: code, city_muni_name: selected.name, barangay_code: '', barangay_name: '' })); void loadBarangays(code) }
    if (key === 'barangay') setOutlet((f) => ({ ...f, barangay_code: code, barangay_name: selected.name }))
  }
  const saveOutlet = async () => {
    setOutletSaving(true); setOutletMessage('')
    const res = await fetch('/api/city/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fulfillment_outlet: hasOutlet ? outlet : blankOutlet }) })
    const data = await res.json(); setOutletSaving(false)
    setOutletMessage(res.ok ? (hasOutlet ? 'Physical outlet address saved. Resellers will see this fulfillment location.' : 'Physical outlet removed. Your registered address will be shown instead.') : (data.error || 'Unable to save outlet address.'))
  }

  const handleProfileSave = async () => {
    setProfileSaving(true)
    setProfileError('')
    setProfileSuccess('')
    const res = await fetch('/api/city/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: profileForm.address }),
    })
    const data = await res.json()
    setProfileSaving(false)
    if (res.ok) {
      setProfileSuccess('Profile updated successfully.')
      if (data.user) setUser(data.user)
    } else {
      setProfileError(data.error || 'Something went wrong.')
    }
  }

  const handlePasswordSave = async () => {
    setPasswordError('')
    setPasswordSuccess('')
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError('New passwords do not match.')
      return
    }
    setPasswordSaving(true)
    const res = await fetch('/api/city/profile/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_password: passwordForm.current_password,
        new_password:     passwordForm.new_password,
      }),
    })
    const data = await res.json()
    setPasswordSaving(false)
    if (res.ok) {
      setPasswordSuccess('Password changed successfully.')
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' })
    } else {
      setPasswordError(data.error || 'Something went wrong.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Header */}
      <div className="mb-2">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Profile</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your account information</p>
      </div>

      {/* Account Info (read-only) */}
      <Section title="Account Info" desc="Your system credentials and coverage area">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InputField label="Username"      value={user?.username || ''} disabled />
          <InputField
            label="Role"
            value={user?.distributor_profile?.dist_level === 'branch' ? 'Branch' : 'City Distributor'}
            disabled
          />
          <InputField label="Coverage Area" value={user?.distributor_profile?.coverage_area || '—'} disabled />
          <InputField label="Account Status" value="Active"              disabled />
        </div>
      </Section>

      {/* Profile */}
      <Section title="Personal Information" desc="Update your name, contact, and address">
        <ProfilePhotoUploader profilePhoto={profilePhoto} fullName={profileForm.full_name} onChange={setProfilePhoto} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InputField
            label="Full Name" value={profileForm.full_name}
            disabled={true}
            
            placeholder="Your full name"
          />
          <InputField
            label="Mobile" value={profileForm.mobile} type="tel"
            disabled={true}
            placeholder="+63 9XX XXX XXXX"
          />
          <InputField
            label="Email" value={profileForm.email} type="email"
            disabled={true}
            placeholder="Optional"
          />
          <InputField
            label="Address" value={profileForm.address}
            onChange={(v) => setProfileForm((f) => ({ ...f, address: v }))}
            placeholder="Your address"
          />
        </div>

        {profileSuccess && (
          <p className="mt-3 text-xs text-[#1a7a4a] bg-[#e8f7ef] px-3 py-2 rounded-lg">{profileSuccess}</p>
        )}
        {profileError && (
          <p className="mt-3 text-xs text-[#a03030] bg-[#fdecea] px-3 py-2 rounded-lg">{profileError}</p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleProfileSave}
            disabled={profileSaving}
            className="bg-[#010521] text-white text-sm px-5 py-2 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-50"
          >
            {profileSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </Section>

      <Section title="Physical Outlet Address" desc="Optional: this is the exact address resellers see when your account fulfills their order.">
        <div className="rounded-lg border border-[#C9A84C]/35 bg-[#fffaf0] p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={hasOutlet} onChange={(e) => { setHasOutlet(e.target.checked); setOutletMessage('') }} className="mt-0.5 accent-[#C9A84C]" />
            <span>
              <span className="block text-sm font-medium text-[#0D1B3E]">I have a physical branch or outlet</span>
              <span className="block text-xs text-gray-500 mt-0.5">Add the place where customers or resellers can actually collect or receive products. If you leave this off, your registered address is used as the fulfillment contact address.</span>
            </span>
          </label>
        </div>

        {hasOutlet && <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InputField label="Outlet / branch name (optional)" value={outlet.name} onChange={(v) => setOutlet((f) => ({ ...f, name: v }))} placeholder="e.g. Jairo Sogod Outlet" />
          <InputField label="ZIP code" value={outlet.zip_code} onChange={(v) => setOutlet((f) => ({ ...f, zip_code: v.replace(/\D/g, '').slice(0, 4) }))} placeholder="4 digits" />
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Region</label><select value={outlet.region_code} onChange={(e) => setOutletSelect('region', e.target.value)} className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm"><option value="">Select region</option>{regions.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Province</label><select value={outlet.province_code} disabled={!outlet.region_code} onChange={(e) => setOutletSelect('province', e.target.value)} className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm disabled:opacity-60"><option value="">Select province</option>{provinces.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1">City / Municipality</label><select value={outlet.city_muni_code} disabled={!outlet.province_code} onChange={(e) => setOutletSelect('city', e.target.value)} className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm disabled:opacity-60"><option value="">Select city / municipality</option>{cities.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Barangay</label><select value={outlet.barangay_code} disabled={!outlet.city_muni_code} onChange={(e) => setOutletSelect('barangay', e.target.value)} className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm disabled:opacity-60"><option value="">Select barangay</option>{barangays.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
          <div className="sm:col-span-2"><InputField label="Street / house no." value={outlet.street} onChange={(v) => setOutlet((f) => ({ ...f, street: v }))} placeholder="House/building, street, or sitio" hint="All address fields are required so the fulfillment location is complete and usable for delivery." /></div>
        </div>}
        {outletMessage && <p className={`mt-3 text-xs px-3 py-2 rounded-lg ${outletMessage.includes('saved') || outletMessage.includes('removed') ? 'text-[#1a7a4a] bg-[#e8f7ef]' : 'text-[#a03030] bg-[#fdecea]'}`}>{outletMessage}</p>}
        <div className="mt-4 flex justify-end"><button onClick={saveOutlet} disabled={outletSaving} className="bg-[#010521] text-white text-sm px-5 py-2 rounded-lg hover:bg-[#162850] disabled:opacity-50">{outletSaving ? 'Saving...' : hasOutlet ? 'Save Physical Outlet' : 'Use Registered Address'}</button></div>
      </Section>

      {/* Password */}
      <Section title="Change Password" desc="Update your login password">
        <div className="grid grid-cols-1 gap-4">
          <InputField
            label="Current Password" value={passwordForm.current_password} type="password"
            onChange={(v) => setPasswordForm((f) => ({ ...f, current_password: v }))}
            placeholder="Enter current password"
          />
          <InputField
            label="New Password" value={passwordForm.new_password} type="password"
            onChange={(v) => setPasswordForm((f) => ({ ...f, new_password: v }))}
            placeholder="At least 8 characters"
          />
          <InputField
            label="Confirm New Password" value={passwordForm.confirm_password} type="password"
            onChange={(v) => setPasswordForm((f) => ({ ...f, confirm_password: v }))}
            placeholder="Repeat new password"
          />
        </div>

        {passwordSuccess && (
          <p className="mt-3 text-xs text-[#1a7a4a] bg-[#e8f7ef] px-3 py-2 rounded-lg">{passwordSuccess}</p>
        )}
        {passwordError && (
          <p className="mt-3 text-xs text-[#a03030] bg-[#fdecea] px-3 py-2 rounded-lg">{passwordError}</p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={handlePasswordSave}
            disabled={passwordSaving}
            className="bg-[#010521] text-white text-sm px-5 py-2 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-50"
          >
            {passwordSaving ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </Section>

    </div>
  )
}
