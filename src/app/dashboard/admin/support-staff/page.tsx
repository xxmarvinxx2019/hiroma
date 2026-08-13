'use client'

import { FormEvent, useEffect, useState } from 'react'
import { ADMIN_STAFF_MODULES, ADMIN_STAFF_TYPES } from '@/app/lib/staffPermissions'

type StaffAccount = {
  id: string
  staff_type: string
  permissions: string[]
  is_active: boolean
  user: { full_name: string; username: string; email: string | null; mobile: string }
}

const emptyForm = { full_name: '', username: '', mobile: '', email: '', password: '', staff_type: 'customer_support', permissions: ['support_center'] as string[] }

export default function AdminStaffPage() {
  const [list, setList] = useState<StaffAccount[]>([])
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editType, setEditType] = useState('custom')
  const [editPermissions, setEditPermissions] = useState<string[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const response = await fetch('/api/admin/support-staff')
    const data = await response.json()
    if (response.ok) setList(data.staff || [])
    else setError(data.error || 'Unable to load staff accounts.')
  }

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [])

  const applyType = (staffType: string, editing = false) => {
    const preset = ADMIN_STAFF_TYPES.find(({ key }) => key === staffType)
    const permissions = preset?.permissions ? [...preset.permissions] : []
    if (editing) { setEditType(staffType); if (staffType !== 'custom') setEditPermissions(permissions) }
    else setForm((current) => ({ ...current, staff_type: staffType, permissions: staffType === 'custom' ? current.permissions : permissions }))
  }

  const toggle = (key: string, editing = false) => {
    const [moduleKey, access] = key.split(':')
    const updatePermissions = (current: string[]) => {
      if (current.includes(key)) {
        return access === 'view' ? current.filter((item) => !item.startsWith(`${moduleKey}:`)) : current.filter((item) => item !== key)
      }
      return [...current, key]
    }
    if (editing) {
      setEditType('custom')
      setEditPermissions(updatePermissions)
    } else {
      setForm((current) => ({ ...current, staff_type: 'custom', permissions: updatePermissions(current.permissions) }))
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('')
    const response = await fetch('/api/admin/support-staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await response.json()
    if (response.ok) { setForm(emptyForm); setSuccess('Staff login created with the selected access.'); await load() }
    else setError(data.error || 'Unable to create staff account.')
    setSaving(false)
  }

  async function update(account: StaffAccount, payload: object) {
    setError(''); setSuccess('')
    const response = await fetch('/api/admin/support-staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: account.id, ...payload }) })
    const data = await response.json()
    if (response.ok) { setEditingId(null); setSuccess('Staff access updated. Removed access and account deactivation apply immediately.'); await load() }
    else setError(data.error || 'Unable to update staff account.')
  }

  const permissionGrid = (permissions: string[], editing = false) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {ADMIN_STAFF_MODULES.map((module) => (
        <div key={module.key} className="rounded-xl border border-[#0D1B3E]/10 p-3">
          <b className="block text-xs text-[#0D1B3E]">{module.label}</b><small className="block text-[10px] text-gray-400">{module.description}</small>
          <div className="mt-2 flex flex-wrap gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px]"><input type="checkbox" checked={permissions.includes(`${module.key}:view`)} onChange={() => toggle(`${module.key}:view`, editing)} className="accent-[#C9A84C]" /> View only</label>
            {module.action && <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[#9a6f1e]"><input type="checkbox" checked={permissions.includes(`${module.key}:${module.action}`)} disabled={!permissions.includes(`${module.key}:view`)} onChange={() => toggle(`${module.key}:${module.action}`, editing)} className="accent-[#C9A84C] disabled:opacity-40" /> {module.actionLabel}</label>}
          </div>
        </div>
      ))}
    </div>
  )

  return <section className="mx-auto max-w-6xl space-y-5">
    <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#C9A84C]">Hiroma HQ</p><h1 className="mt-1 text-2xl font-semibold text-[#0D1B3E]">Staff Access</h1><p className="mt-1 text-sm text-gray-400">Create employee logins and choose exactly which admin areas each employee can access.</p></div>
    <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-[#0D1B3E]">Create staff login</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['full_name','username','mobile','email','password'] as const).map((key) => <input key={key} required={key !== 'email'} type={key === 'password' ? 'password' : key === 'email' ? 'email' : 'text'} minLength={key === 'password' ? 8 : undefined} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} placeholder={key.replace('_', ' ')} className={`${key === 'password' ? 'sm:col-span-2 ' : ''}rounded-xl border px-3 py-2.5 text-sm`} />)}
        </div>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#0D1B3E]">Staff type</span><select value={form.staff_type} onChange={(event) => applyType(event.target.value)} className="w-full rounded-xl border px-3 py-2.5 text-sm">{ADMIN_STAFF_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label>
        <div><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold text-[#0D1B3E]">Allowed access</h3><button type="button" onClick={() => setForm((current) => ({ ...current, staff_type: 'custom', permissions: ADMIN_STAFF_MODULES.map(({ key }) => `${key}:view`) }))} className="text-[11px] text-[#9a6f1e]">View all only</button></div>{permissionGrid(form.permissions)}</div>
        {error && <p className="rounded-xl bg-red-50 p-3 text-xs text-red-600">{error}</p>}{success && <p className="rounded-xl bg-green-50 p-3 text-xs text-green-700">{success}</p>}
        <button disabled={saving} className="rounded-xl bg-[#C9A84C] px-4 py-2.5 text-sm font-semibold text-[#0D1B3E] disabled:opacity-50">{saving ? 'Creating…' : 'Create Staff Login'}</button>
      </form>
      <section className="h-fit overflow-hidden rounded-2xl bg-white shadow-sm"><h2 className="border-b p-5 font-semibold text-[#0D1B3E]">Staff accounts</h2>{list.length === 0 ? <p className="p-5 text-sm text-gray-400">No staff accounts yet.</p> : list.map((account) => <div key={account.id} className="border-b p-4">
        <div className="flex items-start justify-between gap-3"><span><b className="block text-sm">{account.user.full_name}</b><small className="text-gray-400">@{account.user.username} · {ADMIN_STAFF_TYPES.find(({ key }) => key === account.staff_type)?.label || 'Custom Access'}</small></span><button onClick={() => void update(account, { is_active: !account.is_active })} className={`rounded-full px-3 py-1 text-xs ${account.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{account.is_active ? 'Active' : 'Inactive'}</button></div>
        <div className="mt-3 flex flex-wrap gap-1">{account.permissions.map((permission) => { const [moduleKey, access] = permission.split(':'); const moduleInfo = ADMIN_STAFF_MODULES.find(({ key }) => key === moduleKey); return <span key={permission} className="rounded-full bg-[#F0F2F8] px-2 py-1 text-[9px]">{moduleInfo?.label || moduleKey}: {access}</span> })}</div>
        {editingId === account.id ? <div className="mt-4 space-y-3 border-t pt-4"><select value={editType} onChange={(event) => applyType(event.target.value, true)} className="w-full rounded-xl border px-3 py-2 text-sm">{ADMIN_STAFF_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select>{permissionGrid(editPermissions, true)}<div className="flex gap-2"><button onClick={() => void update(account, { staff_type: editType, permissions: editPermissions })} className="rounded-lg bg-[#C9A84C] px-3 py-2 text-xs font-semibold">Save access</button><button onClick={() => setEditingId(null)} className="rounded-lg bg-gray-100 px-3 py-2 text-xs">Cancel</button></div></div> : <button onClick={() => { setEditingId(account.id); setEditType(account.staff_type); setEditPermissions(account.permissions) }} className="mt-3 text-xs font-semibold text-[#9a6f1e]">Edit access</button>}
      </div>)}</section>
    </div>
  </section>
}
