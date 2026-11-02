'use client'

import { useEffect, useState } from 'react'

type Activity = {
  carryover: {enabled:boolean;max_points:number;left_points:number;right_points:number};
  mode: 'two_sessions' | 'daily_anytime'; cutoff: string | null; session: number; session_cap: number; daily_cap: number; used_session: number; used_today: number;
  remaining: number | null; closed: boolean; page: number; has_more: boolean;
  events: { id: string; created_at: string; source_kind: string; source_event_id: string | null;
    session_flushed_points: number | null; carryover_flushed_points: number | null; carryover_policy_id: string | null; cap_policy_id: string | null; cap_mode: string | null; cap_cutoff: string | null; source_leg: string; source_points: number; source_points_flushed: number; cap_session: number | null;
    payable_pairs: number; product_reward_pairs: number }[];
}

export default function PackageBinarySessionActivity() {
  const [data, setData] = useState<Activity | null>(null)
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    async function refresh() {
      try {
        const response = await fetch(`/api/reseller/package-binary-activity?page=${page}`, { cache: 'no-store', signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Unable to load activity.')
        setData(result); setError('')
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load activity.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 60000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [page])
  return <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
    <p className="font-bold">{data?.mode === 'daily_anytime' ? 'Package Binary daily cap' : 'Package Binary sessions'}</p>
    <p className="mt-1">{data?.mode === 'daily_anytime' ? 'Daily anytime · resets at Philippine midnight.' : `Two sessions · cutoff ${data?.cutoff || '13:00'} Philippine time. Unused session allowance does not carry over.`}</p>
    {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : data && <>
      <p className="mt-2 font-semibold">{data.mode === 'daily_anytime' ? 'Daily allowance' : data.session === 1 ? `Before ${data.cutoff}` : `From ${data.cutoff}`}: {data.used_session}/{data.session_cap} pairs · Today: {data.used_today}/{data.daily_cap}</p>
      <p className={data.closed ? 'mt-1 text-amber-800' : 'mt-1'}>{data.closed
        ? `${data.mode === 'daily_anytime' ? 'Daily' : 'Session'} cap reached. All new left/right points are flushed until ${data.session === 1 ? `${data.cutoff} Philippine time` : 'Philippine midnight'}.`
        : 'New points are accepted while session and daily allowance remain.'}</p>
      {data.carryover.enabled&&<p className="mt-2 rounded bg-white p-2">Unmatched balance limit: {data.carryover.max_points.toLocaleString()} points per leg.<br />Left: {data.carryover.left_points.toLocaleString()} · Right: {data.carryover.right_points.toLocaleString()}. Excess incoming unmatched points are flushed after matching.</p>}
      <details className="mt-2">
        <summary className="cursor-pointer font-semibold">Points transaction history</summary>
        {data.events.length === 0 && <p className="mt-2">No Package Binary point transactions yet.</p>}
        {data.events.map(event => <div key={event.id} className="mt-2 break-words border-t border-slate-200 pt-2">
          <p>{new Date(event.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} · {event.source_leg}</p>
          <p>{event.source_points - event.source_points_flushed} points accepted · {event.payable_pairs} eligible pairs · {event.product_reward_pairs} bottles</p>
          {event.source_points_flushed > 0 && <p className="text-amber-800">{event.source_points_flushed} incoming points flushed. Session/daily cap: {event.session_flushed_points??event.source_points_flushed}; unmatched balance cap: {event.carryover_flushed_points??0}.</p>}
          <p className="mt-1 text-[10px] text-slate-500">Reference: {event.id}<br />Source: {event.source_kind} {event.source_event_id || 'historical'}{event.carryover_policy_id&&<><br />Balance cap policy: {event.carryover_policy_id}</>}{event.cap_policy_id && <><br />Cap policy: {event.cap_policy_id}</>}</p>
        </div>)}
        <div className="mt-3 flex justify-between">
          <button type="button" disabled={loading || page === 1} onClick={() => { setLoading(true); setPage(page - 1) }} className="disabled:opacity-40">Previous</button>
          <span>Page {data.page}</span>
          <button type="button" disabled={loading || !data.has_more} onClick={() => { setLoading(true); setPage(page + 1) }} className="disabled:opacity-40">Next</button>
        </div>
      </details>
    </>}
  </section>
}
