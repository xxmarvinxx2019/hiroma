'use client'

import { useEffect, useState } from 'react'

type Preview = {
  mode: 'simulation' | 'weekly'
  latest: { week: string; amount: string; credited: boolean; retained: boolean } | null
  endExclusive: string
  asOf: string
  qualifiedPairs: string
  pairShare: number
  estimatedRate: string
  estimatedBonusCentavos: string
}

const percent = new Intl.NumberFormat('en-PH', { style: 'percent', maximumSignificantDigits: 3 })
const pesos = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
const manilaTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
})

export default function ProductBinaryPoolPreview({ totalEarned }: { totalEarned: number }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let loading = false
    async function refresh() {
      if (loading || document.hidden) return
      loading = true
      try {
        const response = await fetch('/api/reseller/product-binary-pool', {
          cache: 'no-store', signal: controller.signal,
        })
        if (!response.ok) throw new Error('Preview unavailable')
        const data: Preview = await response.json()
        if (!controller.signal.aborted) {
          setPreview(data)
          setFailed(false)
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      } finally {
        loading = false
      }
    }

    void refresh()
    const interval = window.setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller.abort()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-[#0D1B3E]">
      <h2 className="font-semibold">{preview?.mode === 'weekly' ? 'Weekly Product Binary bonus' : 'Weekly Product Binary pool preview'}</h2>
      <p className="mt-1 text-xs text-slate-600">{preview?.mode === 'weekly' ? 'The estimated bonus updates until weekly cutoff.' : 'Simulation only. Wallet credits still follow the current per-order rules.'}</p>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs text-slate-600">Total Product Binary earned</dt>
          <dd className="mt-1 text-lg font-semibold">{pesos.format(totalEarned)}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs text-slate-600">{preview?.mode === 'weekly' ? 'This week’s estimated bonus' : 'This week’s simulated bonus'}</dt>
          <dd className="mt-1 text-lg font-semibold">{preview ? pesos.format(Number(preview.estimatedBonusCentavos) / 100) : '—'}</dd>
        </div>
      </dl>
      {preview && <>
        <dl className="mt-3 grid grid-cols-2 gap-3 px-3">
          <div><dt className="text-xs text-slate-600">Your qualified pairs</dt><dd className="font-semibold">{BigInt(preview.qualifiedPairs).toLocaleString('en-PH')}</dd></div>
          <div><dt className="text-xs text-slate-600">Estimated rate per pair</dt><dd className="font-semibold">{pesos.format(Number(preview.estimatedRate))}</dd></div>
          <div className="col-span-2">
            <dt className="text-xs text-slate-600">Your share of weekly qualified pairs</dt>
            <dd className="font-semibold">{percent.format(preview.pairShare)}</dd>
            <p className="text-xs text-slate-600">Your portion of this week’s qualified pairs. The bonus still follows the maximum rate per pair.</p>
          </div>
        </dl>
        <div className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-xs text-slate-600">
          <p>Weekly cutoff {manilaTime.format(new Date(new Date(preview.endExclusive).getTime() - 60_000))} Philippine time.</p>
          <p>Last updated {manilaTime.format(new Date(preview.asOf))} Philippine time.</p>
        </div>
      </>}
      {preview?.latest && <p className="mt-3 text-xs text-slate-600">
        Last finalized week ({preview.latest.week}) · {pesos.format(Number(preview.latest.amount) / 100)} · {preview.latest.credited ? 'Credited' : preview.latest.retained ? 'Expired at next cutoff' : Number(preview.latest.amount) === 0 ? 'No payout' : 'Pending credit'}
      </p>}
      {failed ? <p role="status" className="mt-2 text-xs text-red-700">Unable to refresh the preview. Retrying automatically.</p>
        : !preview && <p role="status" className="mt-2 text-xs text-slate-600">Loading pool preview…</p>}
    </section>
  )
}
