'use client'

import { useState, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

interface AdminProfile {
  id: string
  full_name: string
  username: string
  email: string | null
  mobile: string
}

// ============================================================
// SECTION COMPONENT
// ============================================================

function SettingsSection({
  title,
  desc,
  children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
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

// ============================================================
// PAGE
// ============================================================

export default function SettingsPage() {
  const [profile, setProfile] = useState<AdminProfile | null>(null)
  const [loading, setLoading] = useState(true)

  // Profile form
  const [profileForm, setProfileForm] = useState({
    full_name: '',
    email: '',
    mobile: '',
  })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileError, setProfileError] = useState('')

  // Password form
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [passwordError, setPasswordError] = useState('')

  // MLM system settings
  const [mlmSettings, setMlmSettings] = useState({
    daily_referral_cap: 10,
    daily_pairs_cap: 12,
    name_cap: 7,
  })
  const [mlmSaving, setMlmSaving] = useState(false)
  const [mlmSuccess, setMlmSuccess] = useState('')

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setProfile(data.user)
          setProfileForm({
            full_name: data.user.full_name,
            email: data.user.email || '',
            mobile: data.user.mobile,
          })
        }
      })
      .finally(() => setLoading(false))
  }, [])

  const handleProfileSave = async () => {
    if (!profileForm.full_name || !profileForm.mobile) {
      setProfileError('Full name and mobile are required.')
      return
    }
    setProfileSaving(true)
    setProfileError('')
    setProfileSuccess('')

    const res = await fetch('/api/admin/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileForm),
    })
    const data = await res.json()

    if (!res.ok) {
      setProfileError(data.error || 'Failed to update profile.')
    } else {
      setProfileSuccess('Profile updated successfully!')
      setTimeout(() => setProfileSuccess(''), 3000)
    }
    setProfileSaving(false)
  }

  const handlePasswordSave = async () => {
    if (!passwordForm.current_password || !passwordForm.new_password) {
      setPasswordError('All password fields are required.')
      return
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError('New passwords do not match.')
      return
    }
    if (passwordForm.new_password.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }

    setPasswordSaving(true)
    setPasswordError('')
    setPasswordSuccess('')

    const res = await fetch('/api/admin/settings/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      }),
    })
    const data = await res.json()

    if (!res.ok) {
      setPasswordError(data.error || 'Failed to update password.')
    } else {
      setPasswordSuccess('Password updated successfully!')
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' })
      setTimeout(() => setPasswordSuccess(''), 3000)
    }
    setPasswordSaving(false)
  }

  const handleMlmSave = async () => {
    setMlmSaving(true)
    setMlmSuccess('')
    const res = await fetch('/api/admin/settings/mlm', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mlmSettings),
    })
    if (res.ok) {
      setMlmSuccess('MLM settings saved!')
      setTimeout(() => setMlmSuccess(''), 3000)
    }
    setMlmSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[#0D1B3E]">Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Manage your account and system configuration
        </p>
      </div>

      <div className="flex flex-col gap-5">

        {/* Profile Settings */}
        <SettingsSection
          title="Admin profile"
          desc="Update your name, email and mobile number"
        >
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Username
              </label>
              <input
                value={profile?.username || ''}
                disabled
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/10 rounded-lg px-3 py-2 text-sm text-gray-400 cursor-not-allowed"
              />
              <p className="text-xs text-gray-400 mt-1">Username cannot be changed</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Full name <span className="text-[#C9A84C]">*</span>
                </label>
                <input
                  value={profileForm.full_name}
                  onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Mobile <span className="text-[#C9A84C]">*</span>
                </label>
                <input
                  value={profileForm.mobile}
                  onChange={(e) => setProfileForm({ ...profileForm, mobile: e.target.value })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Email</label>
              <input
                value={profileForm.email}
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                placeholder="admin@hiroma.com"
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
              />
            </div>

            {profileError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="text-red-500 text-xs">{profileError}</p>
              </div>
            )}
            {profileSuccess && (
              <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-3 py-2">
                <p className="text-[#1a7a4a] text-xs">{profileSuccess}</p>
              </div>
            )}

            <button
              onClick={handleProfileSave}
              disabled={profileSaving}
              className="bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] transition-colors disabled:opacity-60 w-fit px-6"
            >
              {profileSaving ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        </SettingsSection>

        {/* Password Settings */}
        <SettingsSection
          title="Change password"
          desc="Update your admin account password"
        >
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Current password <span className="text-[#C9A84C]">*</span>
              </label>
              <input
                type="password"
                value={passwordForm.current_password}
                onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                placeholder="Enter current password"
                className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  New password <span className="text-[#C9A84C]">*</span>
                </label>
                <input
                  type="password"
                  value={passwordForm.new_password}
                  onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                  placeholder="Min. 8 characters"
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Confirm new password <span className="text-[#C9A84C]">*</span>
                </label>
                <input
                  type="password"
                  value={passwordForm.confirm_password}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                  placeholder="Re-enter new password"
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
              </div>
            </div>

            {passwordError && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="text-red-500 text-xs">{passwordError}</p>
              </div>
            )}
            {passwordSuccess && (
              <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-3 py-2">
                <p className="text-[#1a7a4a] text-xs">{passwordSuccess}</p>
              </div>
            )}

            <button
              onClick={handlePasswordSave}
              disabled={passwordSaving}
              className="bg-[#0D1B3E] text-white font-semibold text-sm rounded-lg py-2.5 hover:bg-[#1A2F5E] transition-colors disabled:opacity-60 w-fit px-6"
            >
              {passwordSaving ? 'Updating...' : 'Update password'}
            </button>
          </div>
        </SettingsSection>

        {/* MLM System Settings */}
        <SettingsSection
          title="MLM system rules"
          desc="Configure daily caps and network limits"
        >
          <div className="flex flex-col gap-4">
            <div className="bg-[#fef9ee] border border-[#C9A84C]/30 rounded-lg px-4 py-3">
              <p className="text-xs text-[#9a6f1e]">
                ⚠️ Changing these values affects all resellers immediately. Make sure you understand the impact before saving.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Daily referral cap
                </label>
                <input
                  type="number"
                  value={mlmSettings.daily_referral_cap}
                  onChange={(e) => setMlmSettings({ ...mlmSettings, daily_referral_cap: parseInt(e.target.value) })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
                <p className="text-xs text-gray-400 mt-1">Overflow → Hiroma</p>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Daily pairs cap
                </label>
                <input
                  type="number"
                  value={mlmSettings.daily_pairs_cap}
                  onChange={(e) => setMlmSettings({ ...mlmSettings, daily_pairs_cap: parseInt(e.target.value) })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
                <p className="text-xs text-gray-400 mt-1">Overflow → Hiroma</p>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">
                  Name cap
                </label>
                <input
                  type="number"
                  value={mlmSettings.name_cap}
                  onChange={(e) => setMlmSettings({ ...mlmSettings, name_cap: parseInt(e.target.value) })}
                  className="w-full bg-[#F0F2F8] border border-[#0D1B3E]/15 rounded-lg px-3 py-2 text-sm text-[#0D1B3E] outline-none focus:border-[#C9A84C]"
                />
                <p className="text-xs text-gray-400 mt-1">Max accounts per name</p>
              </div>
            </div>

            {mlmSuccess && (
              <div className="bg-[#e8f7ef] border border-[#1a7a4a]/30 rounded-lg px-3 py-2">
                <p className="text-[#1a7a4a] text-xs">{mlmSuccess}</p>
              </div>
            )}

            <button
              onClick={handleMlmSave}
              disabled={mlmSaving}
              className="bg-[#C9A84C] text-[#0D1B3E] font-semibold text-sm rounded-lg py-2.5 hover:bg-[#E8C96A] transition-colors disabled:opacity-60 w-fit px-6"
            >
              {mlmSaving ? 'Saving...' : 'Save MLM settings'}
            </button>
          </div>
        </SettingsSection>

        {/* Danger Zone */}
        <SettingsSection
          title="System info"
          desc="Current system configuration"
        >
          <div className="flex flex-col gap-2">
            {[
              { label: 'App name', value: 'Hiroma' },
              { label: 'Currency', value: 'Philippine Peso (PHP)' },
              { label: 'Binary structure', value: 'Left leg + Right leg' },
              { label: 'Payout mode', value: 'Manual (admin approval required)' },
              { label: 'Auth mode', value: 'Username + Password (JWT)' },
              { label: 'Database', value: 'PostgreSQL via Supabase' },
              { label: 'Version', value: '1.0.0' },
            ].map((item) => (
              <div key={item.label} className="flex justify-between py-2 border-b border-[#0D1B3E]/5">
                <span className="text-xs text-gray-400">{item.label}</span>
                <span className="text-xs font-medium text-[#0D1B3E]">{item.value}</span>
              </div>
            ))}
          </div>
        </SettingsSection>

      </div>
    </div>
  )
}