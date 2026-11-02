'use client'
import { useEffect, useState } from 'react'
import { validateBinaryCapPolicy } from '@/app/lib/packageBinaryCapPolicy'
type Version={id:string;revision:string;effective_day:string;mode:string;daily_limit:number;first_limit:number|null;cutoff_minute:number|null;created_at:string;created_by:string|null}
type Package={id:string;name:string;points_per_pair:number;current:{mode:string;cap:number;session:number;session_cap:number;cutoff:string|null;enabled:boolean;carryover_enabled:boolean;carryover_limit:number};versions:Version[];carryover_versions:{id:string;effective_day:string;enabled:boolean;max_points:number}[]}
type Data={tomorrow:string;packages:Package[]}
export default function PackageBinaryCapSettings(){
 const [data,setData]=useState<Data|null>(null),[selected,setSelected]=useState(''),[mode,setMode]=useState('two_sessions')
 const [daily,setDaily]=useState('10'),[first,setFirst]=useState('5'),[cutoff,setCutoff]=useState('13:00'),[effective,setEffective]=useState(''),[pin,setPin]=useState('')
 const [carryEnabled,setCarryEnabled]=useState(true),[carryMax,setCarryMax]=useState('180000')
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false)
 function choose(pkg:Package,day:string){setCarryEnabled(pkg.current.carryover_enabled);setCarryMax(String(pkg.current.carryover_limit));setSelected(pkg.id);setMode(pkg.current.mode);setDaily(String(pkg.current.cap));setFirst(String(pkg.current.mode==='daily_anytime'?Math.max(1,Math.floor(pkg.current.cap/2)):pkg.current.session===1?pkg.current.session_cap:pkg.current.cap-pkg.current.session_cap));setCutoff(pkg.current.cutoff||'13:00');setEffective(day);setPin('');setMessage('')}
 async function load(initial=false){const response=await fetch('/api/admin/settings/package-binary-cap',{cache:'no-store'});const payload=await response.json();if(!response.ok)throw new Error(payload.error||'Unable to load cap policy.');setData(payload);if(initial&&payload.packages[0])choose(payload.packages[0],payload.tomorrow);return payload as Data}
 useEffect(()=>{let active=true;void fetch('/api/admin/settings/package-binary-cap',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);if(active){setData(d);if(d.packages[0])choose(d.packages[0],d.tomorrow)}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[])
 const pkg=data?.packages.find(p=>p.id===selected)
 async function save(){setSaving(true);setError('');setMessage('')
  try{const [h,m]=cutoff.split(':').map(Number);const policy=validateBinaryCapPolicy({mode,daily_limit:Number(daily),first_limit:mode==='two_sessions'?Number(first):null,cutoff_minute:mode==='two_sessions'?h*60+m:null})
   const response=await fetch('/api/admin/settings/package-binary-cap',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({package_id:selected,expected_latest_id:pkg?.versions[0]?.id??null,expected_latest_carryover_id:pkg?.carryover_versions[0]?.id??null,policy,carryover:{enabled:carryEnabled,max_points:Number(carryMax)},effective_day:effective,security_pin:pin})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to save policy.')
   setPin('');await load();setMessage(`Scheduled for ${result.effective_day} at Philippine midnight. Existing usage and rewards are preserved.`)
  }catch(e){setError(e instanceof Error?e.message:'Unable to schedule policy.')}finally{setSaving(false)}
 }
 return <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 text-sm text-[#0D1B3E]">
  <h2 className="font-bold">Package Binary cap policy</h2>
  <p className="mt-1 text-xs text-gray-500">Choose a daily allowance or two sessions. All new left/right points are flushed after the applicable cap. Changes begin at a future Philippine midnight.</p>
  {data&&<fieldset disabled={saving} className="mt-4 space-y-3">
   <label className="block">Package<select value={selected} onChange={e=>{const p=data.packages.find(p=>p.id===e.target.value);if(p)choose(p,data.tomorrow)}} className="mt-1 block w-full rounded border p-2">{data.packages.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
   {pkg&&<p className="rounded bg-slate-50 p-2 text-xs">Current: {pkg.current.mode==='daily_anytime'?'Daily anytime':`Two sessions, cutoff ${pkg.current.cutoff}`} · {pkg.current.cap} pairs/day{!pkg.current.enabled?' · caps currently disabled':''}</p>}
   <div className="rounded border bg-slate-50 p-3">
    <label className="flex items-center gap-2"><input type="checkbox" checked={carryEnabled} onChange={e=>setCarryEnabled(e.target.checked)} />Enable unmatched-point balance cap</label>
    <label className="mt-2 block">Maximum unmatched points per leg<input type="number" min={pkg?.points_per_pair||1} max="2147483647" disabled={!carryEnabled} value={carryMax} onChange={e=>setCarryMax(e.target.value)} className="mt-1 block w-full rounded border p-2 disabled:opacity-50" /></label>
    <p className="mt-1 text-xs">Matching comes first. Excess incoming unmatched points are flushed. Existing excess is preserved, but cannot receive additional unmatched points until the leg drops below its limit. Turning this off does not restore previously flushed points.</p>
    {pkg&&<p className="mt-2 text-xs font-semibold">Current balance cap: {pkg.current.carryover_enabled?`${pkg.current.carryover_limit.toLocaleString()} points per leg`:'Off'}</p>}
   </div>
   <div className="grid gap-3 sm:grid-cols-2">
    <label>Cap mode<select value={mode} onChange={e=>setMode(e.target.value)} className="mt-1 block w-full rounded border p-2"><option value="two_sessions">Two sessions</option><option value="daily_anytime">Daily anytime</option></select></label>
    <label>Daily maximum<input type="number" min="1" max="10000" value={daily} onChange={e=>setDaily(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
    {mode==='two_sessions'&&<><label>First-session limit<input type="number" min="1" value={first} onChange={e=>setFirst(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label><label>Second session starts (Philippine time)<input type="time" value={cutoff} onChange={e=>setCutoff(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label><p className="text-xs sm:col-span-2">Second-session limit: {Number(daily)-Number(first)}. Unused session allowance does not transfer.</p></>}
    <label>Effective date<input type="date" min={data.tomorrow} value={effective} onChange={e=>setEffective(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
    <label>Admin Security PIN<input type="password" autoComplete="off" inputMode="numeric" maxLength={6} value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,''))} className="mt-1 block w-full rounded border p-2" /></label>
   </div>
   <p className="text-xs text-gray-500">Limits stay enabled. Saving again for the same effective date creates a new audited version; the latest version for that date takes effect. No usage or earned commissions are reset.</p>
   <button type="button" disabled={saving||!pkg||!/^\d{6}$/.test(pin)} onClick={()=>void save()} className="rounded bg-[#0D1B3E] px-4 py-2 text-white disabled:opacity-40">{saving?'Saving…':'Schedule cap policy'}</button>
   {pkg&&<details><summary className="cursor-pointer font-semibold">Unmatched-point cap history</summary>{pkg.carryover_versions.map(v=><p key={v.id} className="mt-2 break-words border-t pt-2 text-xs">From {v.effective_day}: {v.enabled?`${v.max_points.toLocaleString()} points per leg`:'Off'} · Reference: {v.id}</p>)}</details>}
   {pkg&&<details><summary className="cursor-pointer font-semibold">Latest 20 policy versions and scheduled changes</summary>{pkg.versions.map(v=><p key={v.id} className="mt-2 break-words border-t pt-2 text-xs">From {v.effective_day} · {v.mode==='daily_anytime'?'Daily anytime':`${v.first_limit} + ${v.daily_limit-Number(v.first_limit)} sessions`} · {v.daily_limit}/day{v.cutoff_minute!==null&&` · cutoff ${String(Math.floor(v.cutoff_minute/60)).padStart(2,'0')}:${String(v.cutoff_minute%60).padStart(2,'0')} Philippine time`}<br />Saved: {new Date(v.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})} · {v.created_by||'migration'}<br />Reference: {v.id}</p>)}</details>}
  </fieldset>}
  {error&&<p role="alert" className="mt-3 text-red-700">{error}</p>}{message&&<p role="status" className="mt-3 text-green-700">{message}</p>}
 </section>
}
