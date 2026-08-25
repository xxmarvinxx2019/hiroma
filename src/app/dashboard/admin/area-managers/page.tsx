'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'

type Distributor = { id: string; full_name: string; username: string; distributor_profile: { dist_level: string; coverage_area: string; fulfillment_outlet_name: string | null } | null }
type Manager = { id: string; is_active: boolean; created_at: string; user: { id: string; full_name: string; username: string; email: string | null; mobile: string; area_manager_assignments: Array<{ distributor_id: string }> } }
const blank = { full_name: '', username: '', mobile: '', email: '', password: '', distributor_ids: [] as string[] }

function BranchAssignmentPicker({ branches, ids, onChange }: { branches: Distributor[]; ids: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return branches
    return branches.filter((branch) => [branch.full_name, branch.username, branch.distributor_profile?.fulfillment_outlet_name, branch.distributor_profile?.coverage_area].some((value) => value?.toLowerCase().includes(term)))
  }, [branches, query])
  const visibleIds = visible.map(({ id }) => id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => ids.includes(id))
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])
  const toggleVisible = () => onChange(allVisibleSelected ? ids.filter((id) => !visibleIds.includes(id)) : [...new Set([...ids, ...visibleIds])])

  return <div className="overflow-hidden rounded-xl border border-[#0D1B3E]/10">
    <div className="space-y-2 border-b bg-white p-3">
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search branch name, username, or area…" className="w-full rounded-lg border border-[#0D1B3E]/15 px-3 py-2 text-sm outline-none focus:border-[#C9A84C]" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-gray-600">{ids.length} selected · {visible.length} shown of {branches.length}</span>
        <button type="button" disabled={!visible.length} onClick={toggleVisible} className="font-bold text-[#8A6813] disabled:text-gray-400">{allVisibleSelected ? 'Clear visible' : 'Select visible'}</button>
      </div>
    </div>
    <div className="max-h-64 space-y-2 overflow-y-auto bg-[#fbfcfe] p-3">
      {branches.length === 0 ? <p className="p-4 text-center text-xs text-gray-500">No active Hiroma Branch accounts are available.</p> : visible.length === 0 ? <p className="p-4 text-center text-xs text-gray-500">No branches match your search.</p> : visible.map((item) => <label key={item.id} className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 ${ids.includes(item.id) ? 'bg-[#fff8e6]' : 'bg-white'}`}><input type="checkbox" checked={ids.includes(item.id)} onChange={() => toggle(item.id)} className="mt-1 accent-[#C9A84C]"/><span><b className="block text-sm text-[#0D1B3E]">{item.distributor_profile?.fulfillment_outlet_name || item.full_name}</b><small className="text-gray-500">Hiroma Branch · {item.distributor_profile?.coverage_area || item.full_name}</small></span></label>)}
    </div>
  </div>
}

export default function AreaManagersPage() {
  const [managers, setManagers] = useState<Manager[]>([]), [distributors, setDistributors] = useState<Distributor[]>([])
  const [form, setForm] = useState(blank), [editing, setEditing] = useState<Manager | null>(null), [editIds, setEditIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const load = async () => { setLoading(true); try { const response = await fetch('/api/admin/area-managers', { cache: 'no-store' }); const data = await response.json().catch(() => null); if (!response.ok || !data) throw new Error(data?.error || 'Unable to load Area Managers. The server returned an invalid response.'); setManagers(data.managers || []); setDistributors(data.distributors || []) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load Area Managers.') } finally { setLoading(false) } }
  // Initial remote synchronization is intentionally performed once on mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [])
  const assignedNames = useMemo(() => new Map(distributors.map((item) => [item.id, item.distributor_profile?.fulfillment_outlet_name || item.full_name])), [distributors])
  const create = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); setNotice(''); try { const response = await fetch('/api/admin/area-managers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }); const data = await response.json().catch(() => null); if (!response.ok || !data) throw new Error(data?.error || 'Unable to create the Area Manager account.'); setForm(blank); setNotice('Area Manager account created with assigned branches.'); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create account.') } finally { setSaving(false) } }
  const update = async (body: Record<string, unknown>) => { setSaving(true); setError(''); setNotice(''); try { const response = await fetch('/api/admin/area-managers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setEditing(null); setNotice('Area Manager access updated.'); await load() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update account.') } finally { setSaving(false) } }

  return <div className="space-y-5 text-[#0D1B3E]">
    <header><p className="text-xs font-bold uppercase tracking-[.18em] text-[#C09A38]">Security & accountability</p><h1 className="mt-1 text-2xl font-extrabold">Area Managers</h1><p className="mt-1 text-sm text-gray-500">Create Hiroma company audit logins and assign only company Branch accounts. Independent City Distributor franchisees are excluded.</p></header>
    {(error || notice) && <p role={error ? 'alert' : 'status'} className={`rounded-xl p-4 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{error || notice}</p>}
    <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <form onSubmit={create} className="space-y-4 rounded-2xl border border-[#0D1B3E]/10 bg-white p-5"><div><h2 className="font-bold">Create Area Manager login</h2><p className="text-xs text-gray-500">The temporary password must be changed after first sign-in.</p></div><div className="grid gap-3 sm:grid-cols-2">{([['full_name','Full name','text'],['username','Username','text'],['mobile','Mobile','tel'],['email','Email (optional)','email'],['password','Temporary password','password']] as const).map(([key,label,type]) => <label key={key} className={key === 'password' ? 'sm:col-span-2' : ''}><span className="mb-1 block text-xs font-bold">{label}</span><input required={key !== 'email'} type={type} minLength={key === 'password' ? 12 : undefined} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="w-full rounded-xl border border-[#0D1B3E]/15 px-3 py-2.5 text-sm outline-none focus:border-[#C9A84C]"/></label>)}</div><div><p className="mb-2 text-xs font-bold">Assigned Hiroma Branches</p><BranchAssignmentPicker branches={distributors} ids={form.distributor_ids} onChange={(distributor_ids) => setForm((current) => ({ ...current, distributor_ids }))}/></div><button disabled={saving || !form.distributor_ids.length} className="w-full rounded-xl bg-[#0D1B3E] py-3 text-sm font-bold text-white disabled:opacity-40">{saving ? 'Creating…' : 'Create Area Manager'}</button></form>
      <section className="overflow-hidden rounded-2xl border border-[#0D1B3E]/10 bg-white"><div className="border-b p-5"><h2 className="font-bold">Area Manager accounts</h2><p className="text-xs text-gray-500">{managers.length} account{managers.length === 1 ? '' : 's'}</p></div>{loading ? <p className="p-8 text-center text-sm text-gray-400">Loading…</p> : managers.length === 0 ? <p className="p-8 text-center text-sm text-gray-400">No Area Managers yet.</p> : <div className="divide-y">{managers.map((manager) => <article key={manager.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><b>{manager.user.full_name}</b><span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase ${manager.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{manager.is_active ? 'Active' : 'Inactive'}</span></div><p className="text-xs text-gray-500">@{manager.user.username} · {manager.user.mobile}</p></div><div className="flex gap-2"><button onClick={() => { setEditing(manager); setEditIds(manager.user.area_manager_assignments.map(({ distributor_id }) => distributor_id)) }} className="rounded-lg border px-3 py-2 text-xs font-bold">Edit Assignments</button><button onClick={() => void update({ id: manager.id, is_active: !manager.is_active })} className={`rounded-lg px-3 py-2 text-xs font-bold text-white ${manager.is_active ? 'bg-red-600' : 'bg-green-700'}`}>{manager.is_active ? 'Deactivate' : 'Activate'}</button></div></div><div className="mt-3 flex flex-wrap gap-1.5">{manager.user.area_manager_assignments.map(({ distributor_id }) => <span key={distributor_id} className="rounded-full bg-[#eef2f8] px-2.5 py-1 text-[10px] font-semibold">{assignedNames.get(distributor_id) || 'Assigned location'}</span>)}</div></article>)}</div>}</section>
    </div>
    {editing && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#010521]/70 p-4" onMouseDown={(event) => event.target === event.currentTarget && setEditing(null)}><section role="dialog" aria-modal="true" aria-label="Edit Area Manager assignments" className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl"><h2 className="font-bold">Assignments — {editing.user.full_name}</h2><p className="mb-4 text-xs text-gray-500">Access changes apply immediately on the next request.</p><BranchAssignmentPicker branches={distributors} ids={editIds} onChange={setEditIds}/><div className="mt-4 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="rounded-xl border px-4 py-2 text-sm font-bold">Cancel</button><button disabled={saving || !editIds.length} onClick={() => void update({ id: editing.id, distributor_ids: editIds })} className="rounded-xl bg-[#0D1B3E] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">Save Assignments</button></div></section></div>}
  </div>
}
