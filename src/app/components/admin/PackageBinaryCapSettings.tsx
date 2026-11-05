'use client'
import { useEffect, useState } from 'react'
import SecurityPinModal from '@/app/components/ui/SecurityPinModal'
import { validateBinaryCapDate, validateBinaryCapPolicy, validateCarryoverPolicy } from '@/app/lib/packageBinaryCapPolicy'
type Version={id:string;revision:string;effective_day:string;mode:string;daily_limit:number;first_limit:number|null;cutoff_minute:number|null;created_at:string;created_by:string|null}
type Package={id:string;name:string;current:{mode:string;cap:number;session:number;session_cap:number;cutoff:string|null;enabled:boolean;carryover_enabled:boolean;carryover_limit:number};versions:Version[]}
type Data={tomorrow:string;sharedPolicy:Package|null}
export default function PackageBinaryCapSettings(){
 const [data,setData]=useState<Data|null>(null),[carryoverLimit,setCarryoverLimit]=useState('180000'),[mode,setMode]=useState('two_sessions')
 const [daily,setDaily]=useState('10'),[first,setFirst]=useState('5'),[cutoff,setCutoff]=useState('13:00'),[effective,setEffective]=useState('')
 const [showPin,setShowPin]=useState(false)
 const [submitted,setSubmitted]=useState<string|null>(null)
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false)
 function choose(pkg:Package,day:string){setCarryoverLimit(String(pkg.current.carryover_limit));setMode(pkg.current.mode);setDaily(String(pkg.current.cap));setFirst(String(pkg.current.mode==='daily_anytime'?Math.max(1,Math.floor(pkg.current.cap/2)):pkg.current.session===1?pkg.current.session_cap:pkg.current.cap-pkg.current.session_cap));setCutoff(pkg.current.cutoff||'13:00');setEffective(day);setMessage('')}
 async function load(initial=false){const response=await fetch('/api/admin/settings/package-binary-cap',{cache:'no-store'});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to load cap policy.');setData(payload);if(initial&&payload.sharedPolicy)choose(payload.sharedPolicy,payload.tomorrow);return payload as Data}
 useEffect(()=>{let active=true;void fetch('/api/admin/settings/package-binary-cap',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);if(active){setData(d);if(d.sharedPolicy)choose(d.sharedPolicy,d.tomorrow)}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[])
 const pkg=data?.sharedPolicy
 const current = pkg?.current
 const currentFirst = current?.session === 1 ? current.session_cap : (current?.cap ?? 0) - (current?.session_cap ?? 0)
 const changed = Boolean(current && (
  mode !== current.mode || Number(daily) !== current.cap ||
  Number(carryoverLimit) !== current.carryover_limit ||
  (mode === 'two_sessions' && (Number(first) !== currentFirst || cutoff !== current.cutoff))
 ))

 function getDraft() {
  const [hours, minutes] = cutoff.split(':').map(Number)
  const policy = validateBinaryCapPolicy({
   mode,
   daily_limit: Number(daily),
   first_limit: mode === 'two_sessions' ? Number(first) : null,
   cutoff_minute: mode === 'two_sessions' ? hours * 60 + minutes : null,
  })
  const carryover = validateCarryoverPolicy({ enabled: true, max_points: Number(carryoverLimit) })
  return { policy, carryover_limit: carryover.max_points, effective_day: validateBinaryCapDate(effective) }
 }

 let draft: ReturnType<typeof getDraft> | null = null
 try {
  if (data && effective >= data.tomorrow) draft = getDraft()
 } catch {
  // Invalid drafts cannot open the confirmation modal.
 }
 const canSchedule = Boolean(changed && draft && JSON.stringify(draft) !== submitted)

 async function save(pin: string) {
  if (saving || !canSchedule || !draft) return 'Review the policy changes before scheduling.'
  setSaving(true)
  setError('')
  setMessage('')
  try {
   const response = await fetch('/api/admin/settings/package-binary-cap', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...draft, expected_latest_id: pkg?.versions[0]?.id ?? null, security_pin: pin }),
   })
   const result = await response.json()
   if (!response.ok) return result.error || 'Unable to save policy.'
   setSubmitted(JSON.stringify(draft))
   setShowPin(false)
   setMessage(`Scheduled for ${result.effective_day} at Philippine midnight. Existing usage and rewards are preserved.`)
   await load().catch(() => setError('Policy scheduled. Reopen settings to refresh the policy history.'))
   return null
  } catch {
   return 'Unable to schedule policy.'
  } finally {
   setSaving(false)
  }
 }
 return <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 text-sm text-[#0D1B3E]">
  <h2 className="font-bold">Package Binary cap policy</h2>
  <p className="mt-1 text-xs text-gray-500">One daily and session policy applies to all packages. All new left/right points are flushed after the applicable cap. Changes begin at a future Philippine midnight.</p>
  {pkg?.current.carryover_enabled && <div className="mt-3 rounded border bg-slate-50 p-3 text-xs">
    <p className="font-semibold">Shared unmatched-point limit: {pkg.current.carryover_limit.toLocaleString()} points</p>
    <p className="mt-1 text-gray-600">After matching, each member can carry unmatched points up to this limit on the accumulating leg, combined across all packages. Upgrading does not reset the balance. Existing excess is preserved, and new excess is flushed.</p>
  </div>}
  {data&&pkg&&<fieldset disabled={saving} className="mt-4 space-y-3">
   {pkg&&<p className="rounded bg-slate-50 p-2 text-xs">Current: {pkg.current.mode==='daily_anytime'?'Daily anytime':`Two sessions, cutoff ${pkg.current.cutoff}`} · {pkg.current.cap} pairs/day{!pkg.current.enabled?' · caps currently disabled':''}</p>}
   <div className="grid gap-3 sm:grid-cols-2">
    <label className="sm:col-span-2">Shared unmatched-point limit<input type="number" min="1" max="2147483647" step="1" value={carryoverLimit} onChange={e=>setCarryoverLimit(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
    <label>Cap mode<select value={mode} onChange={e=>setMode(e.target.value)} className="mt-1 block w-full rounded border p-2"><option value="two_sessions">Two sessions</option><option value="daily_anytime">Daily anytime</option></select></label>
    <label>Daily maximum<input type="number" min="1" max="10000" value={daily} onChange={e=>setDaily(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
    {mode==='two_sessions'&&<><label>First-session limit<input type="number" min="1" value={first} onChange={e=>setFirst(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label>Second session starts (Philippine time)<input type="time" value={cutoff} onChange={e=>setCutoff(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label><p className="text-xs sm:col-span-2">Second-session limit: {Number(daily)-Number(first)}. Unused session allowance does not transfer.</p></>}
    <label>Effective date<input type="date" min={data.tomorrow} value={effective} onChange={e=>setEffective(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
   </div>
   <p className="text-xs text-gray-500">Limits stay enabled. Saving again for the same effective date creates a new audited version; the latest version for that date takes effect. No usage or earned commissions are reset.</p>
   <button type="button" disabled={saving || !canSchedule} onClick={() => setShowPin(true)} className="rounded bg-[#0D1B3E] px-4 py-2 text-white disabled:opacity-40">Schedule cap policy</button>
   {changed && !draft && <p className="text-xs text-red-700">Enter valid limits and a future effective date to schedule this policy.</p>}
   {pkg&&<details><summary className="cursor-pointer font-semibold">Latest 20 policy versions and scheduled changes</summary>{pkg.versions.map(v=><p key={v.id} className="mt-2 break-words border-t pt-2 text-xs">From {v.effective_day} · {v.mode==='daily_anytime'?'Daily anytime':`${v.first_limit} + ${v.daily_limit-Number(v.first_limit)} sessions`} · {v.daily_limit}/day{v.cutoff_minute!==null&&` · cutoff ${String(Math.floor(v.cutoff_minute/60)).padStart(2,'0')}:${String(v.cutoff_minute%60).padStart(2,'0')} Philippine time`}<br />Saved: {new Date(v.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})} · {v.created_by||'migration'}<br />Reference: {v.id}</p>)}</details>}
  </fieldset>}
  {data&&!pkg&&<p role="alert">The Starter package is required to load the shared policy.</p>}
  {error&&<p role="alert" className="mt-3 text-red-700">{error}</p>}{message&&<p role="status" className="mt-3 text-green-700">{message}</p>}
  {showPin && <SecurityPinModal
   title="Confirm Package Binary policy"
   description="Enter your Admin Security PIN to schedule these changes for all packages."
   confirmLabel="Schedule policy"
   loading={saving}
   onClose={() => setShowPin(false)}
   onConfirm={save}
  />}
 </section>
}
