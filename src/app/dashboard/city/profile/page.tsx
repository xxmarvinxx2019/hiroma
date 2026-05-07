'use client'

import { useState, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

interface CityUser {
  id: string
  full_name: string
  username: string
  email: string | null
  mobile: string
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
  label, value, onChange, type = 'text', placeholder, disabled,
}: {
  label: string; value: string; onChange?: (v: string) => void
  type?: string; placeholder?: string; disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C] transition-colors placeholder:text-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
      />
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
  const [profileForm, setProfileForm] = useState({ full_name: '', email: '', mobile: '', address: '' })
  const [profileSaving, setProfileSaving]   = useState(false)
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileError, setProfileError]     = useState('')

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

  const handleProfileSave = async () => {
    setProfileSaving(true)
    setProfileError('')
    setProfileSuccess('')
    const res = await fetch('/api/city/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileForm),
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
          <InputField label="Role"          value="City Distributor"     disabled />
          <InputField label="Coverage Area" value={user?.distributor_profile?.coverage_area || '—'} disabled />
          <InputField label="Account Status" value="Active"              disabled />
        </div>
      </Section>

      {/* Profile */}
      <Section title="Personal Information" desc="Update your name, contact, and address">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InputField
            label="Full Name" value={profileForm.full_name}
            onChange={(v) => setProfileForm((f) => ({ ...f, full_name: v }))}
            placeholder="Your full name"
          />
          <InputField
            label="Mobile" value={profileForm.mobile} type="tel"
            onChange={(v) => setProfileForm((f) => ({ ...f, mobile: v }))}
            placeholder="+63 9XX XXX XXXX"
          />
          <InputField
            label="Email" value={profileForm.email} type="email"
            onChange={(v) => setProfileForm((f) => ({ ...f, email: v }))}
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
            className="bg-[#0D1B3E] text-white text-sm px-5 py-2 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-50"
          >
            {profileSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
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
            className="bg-[#0D1B3E] text-white text-sm px-5 py-2 rounded-lg hover:bg-[#162850] transition-colors disabled:opacity-50"
          >
            {passwordSaving ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </Section>

    </div>
  )
}