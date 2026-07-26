'use client'

import { FormEvent, useEffect, useState } from 'react'
import { STAFF_PERMISSIONS } from '@/app/lib/staffPermissions'

interface StaffAccount {
  id: string
  permissions: string[]
  is_active: boolean
  created_at: string
  user: {
    id: string
    full_name: string
    username: string
    email: string | null
    mobile: string
  }
}

const emptyForm = {
  full_name: '',
  username: '',
  password: '',
  mobile: '',
  email: '',
  permissions: [] as string[],
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffAccount[]>([])
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadStaff = async () => {
    setLoading(true)
    const response = await fetch('/api/city/staff')
    const data = await response.json()
    if (response.ok) setStaff(data.staff || [])
    else setError(data.error || 'Unable to load staff.')
    setLoading(false)
  }

  useEffect(() => { void loadStaff() }, [])

  const togglePermission = (key: string) => {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(key)
        ? current.permissions.filter((permission) => permission !== key)
        : [...current.permissions, key],
    }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    const response = await fetch('/api/city/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await response.json()
    if (response.ok) {
      setForm(emptyForm)
      setSuccess('Staff account created. The employee can now log in using the assigned username and password.')
      await loadStaff()
    } else {
      setError(data.error || 'Unable to create staff account.')
    }
    setSaving(false)
  }

  const toggleStatus = async (account: StaffAccount) => {
    setError('')
    const response = await fetch('/api/city/staff', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staff_id: account.id, is_active: !account.is_active }),
    })
    const data = await response.json()
    if (response.ok) await loadStaff()
    else setError(data.error || 'Unable to update staff.')
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[#0D1B3E]">Register Staff</h1>
        <p className="text-xs text-gray-400 mt-1">
          Create individual employee logins and control which parts of this account they can access.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)] gap-5">
        <form onSubmit={submit} className="bg-white rounded-2xl border border-[#0D1B3E]/8 p-5 space-y-4">
          <h2 className="text-sm font-bold text-[#0D1B3E]">Staff account details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: 'full_name', label: 'Full name', type: 'text', required: true },
              { key: 'username', label: 'Username', type: 'text', required: true },
              { key: 'mobile', label: 'Mobile number', type: 'text', required: true },
              { key: 'email', label: 'Email (optional)', type: 'email', required: false },
              { key: 'password', label: 'Temporary password', type: 'password', required: true },
            ].map((field) => (
              <label key={field.key} className={field.key === 'password' ? 'sm:col-span-2' : ''}>
                <span className="block text-xs font-medium text-[#0D1B3E] mb-1.5">{field.label}</span>
                <input
                  type={field.type}
                  required={field.required}
                  minLength={field.key === 'password' ? 8 : undefined}
                  value={form[field.key as keyof typeof form] as string}
                  onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  className="w-full rounded-xl border border-[#0D1B3E]/15 px-3 py-2.5 text-sm outline-none focus:border-[#C9A84C]"
                />
              </label>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-[#0D1B3E]">Allowed access</h3>
              <button
                type="button"
                onClick={() => setForm((current) => ({
                  ...current,
                  permissions: STAFF_PERMISSIONS.map((permission) => permission.key),
                }))}
                className="text-[11px] text-[#9a6f1e] hover:underline"
              >
                Select all
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {STAFF_PERMISSIONS.map((permission) => (
                <label key={permission.key} className="flex gap-3 rounded-xl border border-[#0D1B3E]/10 p-3 cursor-pointer hover:bg-[#F8F9FC]">
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(permission.key)}
                    onChange={() => togglePermission(permission.key)}
                    className="mt-0.5 accent-[#C9A84C]"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-[#0D1B3E]">{permission.label}</span>
                    <span className="block text-[10px] text-gray-400 mt-0.5">{permission.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 rounded-xl p-3">{error}</p>}
          {success && <p className="text-xs text-green-700 bg-green-50 rounded-xl p-3">{success}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-[#C9A84C] text-[#0D1B3E] font-bold text-sm py-3 disabled:opacity-50"
          >
            {saving ? 'Creating staff…' : 'Create Staff Login'}
          </button>
        </form>

        <section className="bg-white rounded-2xl border border-[#0D1B3E]/8 overflow-hidden h-fit">
          <div className="px-5 py-4 border-b border-[#0D1B3E]/8">
            <h2 className="text-sm font-bold text-[#0D1B3E]">Registered staff</h2>
            <p className="text-[10px] text-gray-400 mt-0.5">{staff.length} account{staff.length === 1 ? '' : 's'}</p>
          </div>
          {loading ? (
            <p className="text-xs text-gray-400 p-6 text-center">Loading staff…</p>
          ) : staff.length === 0 ? (
            <p className="text-xs text-gray-400 p-6 text-center">No staff accounts yet.</p>
          ) : (
            <div className="divide-y divide-[#0D1B3E]/5">
              {staff.map((account) => (
                <div key={account.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#0D1B3E]">{account.user.full_name}</p>
                      <p className="text-[11px] text-gray-400">@{account.user.username} · {account.user.mobile}</p>
                    </div>
                    <button
                      onClick={() => toggleStatus(account)}
                      className={`text-[10px] font-semibold rounded-full px-2.5 py-1 ${
                        account.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {account.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-3">
                    {account.permissions.map((permission) => (
                      <span key={permission} className="text-[9px] rounded-full bg-[#F0F2F8] text-[#0D1B3E] px-2 py-1">
                        {STAFF_PERMISSIONS.find((item) => item.key === permission)?.label || permission}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
