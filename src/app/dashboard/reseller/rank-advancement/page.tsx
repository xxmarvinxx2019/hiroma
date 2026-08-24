'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface RankStats {
  package: { name: string } | null
  rank: {
    current: string
    total_pu: number
    ranks: { id: string; name: string; sequence: number; required_pu: number; pair_income: number }[]
    quarter: { label: string; start: string; endExclusive: string }
  }
}

const money = (points: number) => `₱${(Number(points) * 0.5).toFixed(2)}`
const date = (value: string) => new Date(value).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
const inclusiveEndDate = (value: string) => date(new Date(new Date(value).getTime() - 1).toISOString())

export default function RankAdvancementPage() {
  const [stats, setStats] = useState<RankStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadedAt] = useState(() => Date.now())

  useEffect(() => {
    fetch('/api/reseller/stats')
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load your rank goal.')
        setStats(data)
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false))
  }, [])

  let model = null
  if (stats?.rank) {
    const ranks = [...stats.rank.ranks].sort((a, b) => a.sequence - b.sequence)
    const totalPU = Number(stats.rank.total_pu || 0)
    const currentIndex = ranks.findIndex((rank) => rank.name === stats.rank.current)
    const current = currentIndex >= 0 ? ranks[currentIndex] : null
    const next = ranks[currentIndex + 1] || (current ? null : ranks[0]) || null
    const floor = current?.required_pu || 0
    const target = next?.required_pu || floor
    const progress = next ? Math.min(100, Math.max(0, Math.round(((totalPU - floor) / Math.max(1, target - floor)) * 100))) : 100
    const remaining = next ? Math.max(0, target - totalPU) : 0
    const daysLeft = Math.max(0, Math.ceil((new Date(stats.rank.quarter.endExclusive).getTime() - loadedAt) / 86_400_000))
    model = { ranks, totalPU, current, next, progress, remaining, daysLeft }
  }

  if (loading) return <div className="flex justify-center py-24"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[#C9A84C] border-t-transparent" /></div>
  if (error || !stats || !model) return <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error || 'Unable to load your rank goal.'}</div>

  const currentName = model.current?.name || stats.package?.name || 'Base'
  const currentPoints = Number(model.current?.pair_income || 10)

  return (
    <main className="mx-auto max-w-6xl space-y-5 pb-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#A17820]">Quarterly Product Qualification</p>
          <h1 className="mt-1 text-2xl font-bold text-[#0D1B3E]">Rank Advancement</h1>
          <p className="mt-1 text-sm text-gray-500">See exactly what you need to reach your next rank this quarter.</p>
        </div>
        <Link href="/dashboard/reseller/orders#place-order" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-sm font-bold text-white hover:bg-[#b8963e]">Shop qualified products →</Link>
      </header>

      <section className="overflow-hidden rounded-2xl bg-[#0D1B3E] p-5 text-white shadow-lg sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#e7cb7a]">{stats.rank.quarter.label}</p>
            <h2 className="mt-2 text-2xl font-bold">Your goal: {model.next ? `Reach ${model.next.name}` : 'Maintain your top rank'}</h2>
            <p className="mt-2 text-sm text-white/70">{date(stats.rank.quarter.start)} – {inclusiveEndDate(stats.rank.quarter.endExclusive)} · {model.daysLeft} day{model.daysLeft === 1 ? '' : 's'} remaining</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Current rank" value={currentName} />
            <Metric label="Personal PU" value={String(model.totalPU)} />
            <Metric label="PU remaining" value={String(model.remaining)} />
            <Metric label="Current pair rate" value={`${money(currentPoints)}/pair`} />
          </div>
        </div>
        <div className="mt-6">
          <div className="mb-2 flex justify-between text-xs"><span>Progress to {model.next?.name || 'top rank'}</span><strong>{model.progress}%</strong></div>
          <div className="h-3 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[#C9A84C] transition-all" style={{ width: `${model.progress}%` }} /></div>
          {model.next && <p className="mt-3 text-sm text-white/80">Earn <strong className="text-white">{model.remaining} more PU</strong>. If the products are worth 1 PU each, that is about <strong className="text-white">{model.remaining} more bottles</strong>. Products with higher PU reduce the number of bottles needed.</p>}
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-lg font-bold text-[#0D1B3E]">Your rank ladder</h2>
          <p className="mt-1 text-sm text-gray-500">Rank names and PU goals are configured by Hiroma. Pair rates follow the approved quarterly levels.</p>
          <div className="mt-5 space-y-3">
            <RankRow name="Base" pu={0} rate="₱5.00/pair" active={!model.current} reached />
            {model.ranks.map((rank) => (
              <RankRow key={rank.id} name={rank.name} pu={rank.required_pu} rate={`${money(rank.pair_income)}/pair`} active={model.current?.id === rank.id} reached={model.totalPU >= rank.required_pu} />
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <InfoCard number="1" title="Buy products for your own rank" text="Your own eligible, delivered product purchases add Personal PU to your account for the current quarter. PU depends on the product, so always check its PU value before ordering." />
          <InfoCard number="2" title="Team purchases create binary pairs" text="Eligible purchases by downlines add volume to the correct left or right team. Every 2 PU on the left plus 2 PU on the right creates one Product Binary pair." />
          <InfoCard number="3" title="Your qualified rate pays the pair" text={`Your current rate is ${money(currentPoints)} per completed pair. Reaching the next rank changes the rate used for eligible Product Binary pairs.`} />
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6">
        <h2 className="font-bold text-[#694e15]">What resets at the end of the quarter?</h2>
        <p className="mt-2 text-sm leading-6 text-[#725b28]">Your Personal PU qualification and active quarterly rank return to Base for the new quarter. Money already earned, commission history, and valid unmatched left/right Product Binary carryover are not deleted.</p>
      </section>

      <nav className="grid gap-3 sm:grid-cols-3" aria-label="Rank advancement actions">
        <Action href="/dashboard/reseller/orders#place-order" title="Shop / Place Order" text="Earn Personal PU from eligible delivered products." />
        <Action href="/dashboard/reseller/points" title="Product Binary Activity" text="Review pairing points and earnings history." />
        <Action href="/dashboard/reseller/tree" title="View Binary Tree" text="See your left and right downline structure." />
      </nav>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-28 rounded-xl border border-white/10 bg-white/10 p-3"><p className="text-[10px] uppercase tracking-wide text-white/55">{label}</p><p className="mt-1 text-base font-bold">{value}</p></div>
}

function RankRow({ name, pu, rate, active, reached }: { name: string; pu: number; rate: string; active: boolean; reached: boolean }) {
  return <div className={`flex items-center gap-3 rounded-xl border p-3 ${active ? 'border-[#C9A84C] bg-[#fffaf0]' : 'border-slate-200'}`}><span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${reached ? 'bg-[#0D1B3E] text-white' : 'bg-slate-100 text-slate-400'}`}>{reached ? '✓' : '○'}</span><div className="min-w-0 flex-1"><p className="font-semibold text-[#0D1B3E]">{name}{active ? ' · Current' : ''}</p><p className="text-xs text-gray-500">{pu} Personal PU required</p></div><strong className="text-sm text-[#9a6f1e]">{rate}</strong></div>
}

function InfoCard({ number, title, text }: { number: string; title: string; text: string }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#C9A84C] font-bold text-white">{number}</span><div><h3 className="font-bold text-[#0D1B3E]">{title}</h3><p className="mt-1 text-sm leading-6 text-gray-500">{text}</p></div></div></article>
}

function Action({ href, title, text }: { href: string; title: string; text: string }) {
  return <Link href={href} className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#C9A84C] hover:shadow-md"><strong className="text-sm text-[#0D1B3E]">{title} →</strong><p className="mt-1 text-xs leading-5 text-gray-500">{text}</p></Link>
}
