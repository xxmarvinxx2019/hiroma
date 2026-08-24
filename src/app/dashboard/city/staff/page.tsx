'use client'

import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react'
import { STAFF_PERMISSIONS } from '@/app/lib/staffPermissions'

interface StaffAccount {
  id: string; permissions: string[]; is_active: boolean; created_at: string
  user: { id: string; full_name: string; username: string; email: string | null; mobile: string; status: string; created_at: string }
}
const permissionKeys = STAFF_PERMISSIONS.map(({ key }) => key)
const emptyForm = { full_name: '', username: '', password: '', mobile: '', email: '', permissions: [] as string[] }
const presets = [
  { label: 'Registration Staff', permissions: ['dashboard', 'resellers', 'register_reseller', 'pins'] },
  { label: 'Cashier / POS Staff', permissions: ['dashboard', 'resellers', 'orders', 'pos'] },
  { label: 'Inventory Staff', permissions: ['dashboard', 'inventory'] },
  { label: 'Custom Access', permissions: [] },
]
const formatDate = (value: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value))

function PermissionGrid({ selected, onChange }: { selected: string[]; onChange: (permissions: string[]) => void }) {
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key])
  return <div>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-[#0D1B3E]">Allowed access</h3><div className="flex gap-3 text-xs font-semibold"><button type="button" onClick={() => onChange(permissionKeys)} className="text-[#9a6f1e] hover:underline">Select all</button><button type="button" onClick={() => onChange([])} className="text-gray-500 hover:underline">Clear</button></div></div>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{STAFF_PERMISSIONS.map((permission) => <label key={permission.key} className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${selected.includes(permission.key) ? 'border-[#C9A84C] bg-[#fff9e9]' : 'border-[#0D1B3E]/10 hover:bg-[#F8F9FC]'}`}><input type="checkbox" checked={selected.includes(permission.key)} onChange={() => toggle(permission.key)} className="mt-0.5 accent-[#C9A84C]" /><span><span className="block text-sm font-bold text-[#0D1B3E]">{permission.label}</span><span className="mt-1 block text-xs leading-5 text-gray-500">{permission.description}</span></span></label>)}</div>
    <p className="mt-2 text-xs leading-5 text-amber-700">Access is enforced by the server. Payment Methods and other management permissions can change business data, so grant them only when required.</p>
  </div>
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-[#010521]/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section role="dialog" aria-modal="true" aria-label={title} className="my-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between bg-[#010521] px-5 py-4 text-white"><h2 className="text-base font-bold">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-1 text-xl text-white/70 hover:bg-white/10 hover:text-white" aria-label="Close">×</button></div>{children}</section></div>
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffAccount[]>([]), [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false)
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [search, setSearch] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [editing, setEditing] = useState<StaffAccount | null>(null), [editPermissions, setEditPermissions] = useState<string[]>([])
  const [resetting, setResetting] = useState<StaffAccount | null>(null), [resetPassword, setResetPassword] = useState('')
  const [confirming, setConfirming] = useState<StaffAccount | null>(null)

  const loadStaff = async () => { setLoading(true); try { const response = await fetch('/api/city/staff', { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load staff.'); setStaff(data.staff || []) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load staff.') } finally { setLoading(false) } }
  useEffect(() => {
    let active = true
    fetch('/api/city/staff', { cache: 'no-store' })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!active) return
        if (!response.ok) throw new Error(data.error || 'Unable to load staff.')
        setStaff(data.staff || [])
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load staff.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const filtered = useMemo(() => staff.filter((account) => { const matchesStatus = status === 'all' || (status === 'active' ? account.is_active : !account.is_active); return matchesStatus && `${account.user.full_name} ${account.user.username} ${account.user.mobile} ${account.user.email || ''}`.toLowerCase().includes(search.trim().toLowerCase()) }), [staff, search, status])

  const request = async (body: Record<string, unknown>) => { setSaving(true); setError(''); setSuccess(''); try { const response = await fetch('/api/city/staff', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to update staff account.'); await loadStaff(); return true } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update staff account.'); return false } finally { setSaving(false) } }
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); setSuccess(''); try { const response = await fetch('/api/city/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to create staff account.'); setForm(emptyForm); setSuccess('Staff account created. The temporary password must be changed on the employee’s first login.'); await loadStaff() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create staff account.') } finally { setSaving(false) } }
  const activeCount = staff.filter(({ is_active }) => is_active).length

  return <div className="space-y-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold text-[#0D1B3E]">Staff Accounts</h1><p className="mt-1 text-sm text-gray-500">Create employee logins and control their access safely.</p></div><div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs leading-5 text-amber-800"><strong>Owner-controlled:</strong> staff cannot manage this page or grant access to themselves.</div></div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[['Total staff', staff.length, 'bg-[#0D1B3E]'], ['Active', activeCount, 'bg-[#1d7f4e]'], ['Inactive', staff.length - activeCount, 'bg-[#bf3941]']].map(([label, value, color]) => <div key={String(label)} className={`${color} rounded-2xl p-4 text-white shadow-sm`}><p className="text-xs font-bold uppercase tracking-wide text-white/85">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>)}</div>
    {(error || success) && <p className={`rounded-xl p-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`} role={error ? 'alert' : 'status'}>{error || success}</p>}

    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-[#0D1B3E]/8 bg-white p-5">
        <div><h2 className="text-base font-bold text-[#0D1B3E]">Create staff login</h2><p className="mt-1 text-xs text-gray-500">The employee must replace the temporary password after signing in.</p></div>
        <div className="flex flex-wrap gap-2">{presets.map((preset) => <button key={preset.label} type="button" onClick={() => setForm((current) => ({ ...current, permissions: [...preset.permissions] }))} className="rounded-full border border-[#C9A84C]/50 bg-[#fff9e9] px-3 py-1.5 text-xs font-bold text-[#765514] hover:bg-[#f8e9ba]">{preset.label}</button>)}</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[['full_name', 'Full name', 'text', true, 'Employee’s complete name'], ['username', 'Username', 'text', true, 'Letters, numbers, dot, dash, underscore'], ['mobile', 'Mobile number', 'tel', true, '09xx xxx xxxx'], ['email', 'Email (optional)', 'email', false, 'employee@example.com'], ['password', 'Temporary password', 'password', true, 'At least 8 characters']].map(([key, label, type, required, placeholder]) => <label key={String(key)} className={key === 'password' ? 'sm:col-span-2' : ''}><span className="mb-1.5 block text-xs font-bold text-[#0D1B3E]">{label}</span><input type={String(type)} required={Boolean(required)} minLength={key === 'password' ? 8 : undefined} autoComplete="off" placeholder={String(placeholder)} value={form[key as keyof typeof form] as string} onChange={(e) => setForm((current) => ({ ...current, [String(key)]: e.target.value }))} className="w-full rounded-xl border border-[#0D1B3E]/15 px-3 py-2.5 text-sm outline-none focus:border-[#C9A84C] focus:ring-2 focus:ring-[#C9A84C]/15" /></label>)}</div>
        <PermissionGrid selected={form.permissions} onChange={(permissions) => setForm((current) => ({ ...current, permissions }))} />
        <button type="submit" disabled={saving || form.permissions.length === 0} className="w-full rounded-xl bg-[#C9A84C] py-3 text-sm font-bold text-[#0D1B3E] disabled:opacity-50">{saving ? 'Creating staff…' : 'Create Staff Login'}</button>
      </form>

      <section className="h-fit overflow-hidden rounded-2xl border border-[#0D1B3E]/8 bg-white">
        <div className="border-b border-[#0D1B3E]/8 p-4"><h2 className="text-base font-bold text-[#0D1B3E]">Registered staff</h2><p className="mt-1 text-xs text-gray-500">{filtered.length} of {staff.length} accounts shown</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, username, mobile, or email…" className="min-w-0 flex-1 rounded-xl border border-[#0D1B3E]/15 px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" /><select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-xl border border-[#0D1B3E]/15 px-3 py-2 text-sm"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div></div>
        {loading ? <p className="p-8 text-center text-sm text-gray-500">Loading staff…</p> : filtered.length === 0 ? <p className="p-8 text-center text-sm text-gray-500">No matching staff accounts.</p> : <div className="divide-y divide-[#0D1B3E]/8">{filtered.map((account) => <article key={account.id} className="p-4"><div className="flex flex-col justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[#0D1B3E]">{account.user.full_name}</p><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${account.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{account.is_active ? 'Active' : 'Inactive'}</span></div><p className="mt-1 text-xs text-gray-500">@{account.user.username} · {account.user.mobile}</p><p className="mt-1 text-xs text-gray-500">Created {formatDate(account.created_at)}{account.user.email ? ` · ${account.user.email}` : ''}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => { setEditing(account); setEditPermissions(account.permissions) }} className="rounded-lg border px-3 py-2 text-xs font-bold">Edit Access</button><button onClick={() => { setResetting(account); setResetPassword('') }} className="rounded-lg border px-3 py-2 text-xs font-bold">Reset Password</button><button onClick={() => setConfirming(account)} className={`rounded-lg px-3 py-2 text-xs font-bold text-white ${account.is_active ? 'bg-[#bf3941]' : 'bg-[#1d7f4e]'}`}>{account.is_active ? 'Deactivate' : 'Activate'}</button></div></div><div className="mt-3 flex flex-wrap gap-1.5">{account.permissions.map((key) => <span key={key} className="rounded-full bg-[#F0F2F8] px-2.5 py-1 text-[10px] font-semibold text-[#0D1B3E]">{STAFF_PERMISSIONS.find((item) => item.key === key)?.label || key}</span>)}</div></article>)}</div>}
      </section>
    </div>

    {editing && <Modal title={`Edit access — ${editing.user.full_name}`} onClose={() => setEditing(null)}><div className="space-y-4 p-5"><p className="text-sm text-gray-600">Changes apply immediately to the employee’s next request.</p><PermissionGrid selected={editPermissions} onChange={setEditPermissions} /><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={() => setEditing(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={saving || editPermissions.length === 0} onClick={async () => { if (await request({ staff_id: editing.id, permissions: editPermissions })) { setEditing(null); setSuccess('Staff permissions updated and audited.') } }} className="rounded-xl bg-[#C9A84C] px-4 py-2.5 text-sm font-bold disabled:opacity-50">Save Access</button></div></div></Modal>}
    {resetting && <Modal title={`Reset password — ${resetting.user.full_name}`} onClose={() => setResetting(null)}><div className="space-y-4 p-5"><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800"><strong>Security confirmation:</strong> this immediately replaces the employee’s password. The new password must be changed at their next login.</div><label><span className="mb-1.5 block text-sm font-bold">New temporary password</span><input type="password" minLength={8} value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" className="w-full rounded-xl border px-3 py-3 text-sm outline-none focus:border-[#C9A84C]" /></label><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={() => setResetting(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={saving || resetPassword.length < 8} onClick={async () => { if (await request({ staff_id: resetting.id, password: resetPassword })) { setResetting(null); setSuccess('Temporary password reset. A password change is required at next login.') } }} className="rounded-xl bg-[#C9A84C] px-4 py-2.5 text-sm font-bold disabled:opacity-50">Confirm Password Reset</button></div></div></Modal>}
    {confirming && <Modal title={`${confirming.is_active ? 'Deactivate' : 'Activate'} staff account`} onClose={() => setConfirming(null)}><div className="space-y-4 p-5"><p className="text-sm leading-6 text-gray-700">{confirming.is_active ? <><strong>{confirming.user.full_name}</strong> will immediately lose access. Historical records remain unchanged.</> : <><strong>{confirming.user.full_name}</strong> will regain access using the assigned permissions.</>}</p><div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button onClick={() => setConfirming(null)} className="rounded-xl border px-4 py-2.5 text-sm font-bold">Cancel</button><button disabled={saving} onClick={async () => { const wasActive = confirming.is_active; if (await request({ staff_id: confirming.id, is_active: !wasActive })) { setConfirming(null); setSuccess(`Staff account ${wasActive ? 'deactivated' : 'activated'} and audited.`) } }} className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white ${confirming.is_active ? 'bg-[#bf3941]' : 'bg-[#1d7f4e]'}`}>Confirm {confirming.is_active ? 'Deactivation' : 'Activation'}</button></div></div></Modal>}
  </div>
}
