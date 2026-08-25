'use client'

import { useEffect, useState } from 'react'

interface Inspiration {
  date: string
  text: string
  author: string
  source?: string
  category: string
}

interface InspirationResponse {
  inspiration: Inspiration
  recent: Inspiration[]
  preference: { enabled: boolean; hidden_today: boolean }
}

export default function DailyInspirationPage() {
  const [data, setData] = useState<InspirationResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/reseller/daily-inspiration')
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Unable to load Daily Inspiration.')
        setData(result)
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false))
  }, [])

  async function updatePreference(body: Record<string, boolean>) {
    if (!data || saving) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/reseller/daily-inspiration', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to save your preference.')
      setData({
        ...data,
        preference: {
          enabled: typeof body.enabled === 'boolean' ? body.enabled : data.preference.enabled,
          hidden_today: typeof body.hide_today === 'boolean' ? body.hide_today : data.preference.hidden_today,
        },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save your preference.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-24"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#C9A84C] border-t-transparent" /></div>
  if (!data) return <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error || 'Unable to load Daily Inspiration.'}</div>

  return (
    <main className="mx-auto max-w-5xl space-y-5 pb-12">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#A17820]">Positive Daily Reflection</p>
          <h1 className="mt-1 text-2xl font-bold text-[#0D1B3E]">Daily Inspiration</h1>
          <p className="mt-1 text-sm text-gray-500">One carefully curated reflection for the entire Hiroma community each day.</p>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2 shadow-sm">
          <input type="checkbox" checked={data.preference.enabled} disabled={saving}
            onChange={(event) => updatePreference({ enabled: event.target.checked })}
            className="h-5 w-5 accent-[#C9A84C]" />
          <span className="text-sm font-semibold text-[#0D1B3E]">Show on my dashboard</span>
        </label>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section className="relative overflow-hidden rounded-3xl bg-[#0D1B3E] p-7 text-white shadow-xl sm:p-10">
        <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-[#C9A84C]/10" />
        <div className="absolute -bottom-20 left-12 h-44 w-44 rounded-full bg-white/5" />
        <div className="relative z-10 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e7cb7a]">
            <span>Today’s Reflection</span><span className="text-white/25">•</span><span>{data.inspiration.category}</span>
          </div>
          <blockquote className="mt-5 text-2xl font-semibold leading-relaxed sm:text-3xl">“{data.inspiration.text}”</blockquote>
          <p className="mt-5 text-sm text-white/55">
            — {data.inspiration.author}{data.inspiration.source ? ` · ${data.inspiration.source}` : ''}
          </p>
          <button type="button" disabled={saving} onClick={() => updatePreference({ hide_today: !data.preference.hidden_today })}
            className="mt-7 min-h-11 rounded-xl border border-white/15 bg-white/10 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/15 disabled:opacity-50">
            {data.preference.hidden_today ? 'Show again on dashboard today' : 'Hide from dashboard today'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <div>
          <h2 className="text-base font-bold text-[#0D1B3E]">Recent reflections</h2>
          <p className="mt-1 text-xs text-gray-500">The same approved reflection is shared with every member each day.</p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {data.recent.slice(1).map((item) => (
            <article key={item.date} className="rounded-xl border border-gray-100 bg-[#f8f9fc] p-4">
              <div className="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wide">
                <span className="text-[#A17820]">{item.category}</span>
                <time className="text-gray-400">{new Date(`${item.date}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</time>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#0D1B3E]">“{item.text}”</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 opacity-75">
        <p className="text-sm font-bold text-[#0D1B3E]">Faith & Bible reflections</p>
        <p className="mt-1 text-xs text-gray-500">Coming soon. This category is not active in the current version.</p>
      </section>
    </main>
  )
}
