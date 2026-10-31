'use client'

import { useEffect, useState } from 'react'
import type { RewardHistoryPage } from '@/app/lib/productRewardHistory'
import { readSettingsResponse } from '@/app/lib/settingsResponse'

type HistoryResponse = { visible: false } | ({ visible: true } & RewardHistoryPage)
const manilaDate = (value: string) => new Date(value).toLocaleString('en-PH', {
  timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
})

export default function ProductRewardsHistory({ admin = false, onDisabled }: { admin?: boolean; onDisabled?: () => void }) {
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ page: String(page), page_size: '20' })
    if (admin && search) params.set('search', search)
    const endpoint = admin ? '/api/admin/settings/package-binary-reward/history' : '/api/reseller/product-rewards/history'
    fetch(`${endpoint}?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(response => readSettingsResponse<HistoryResponse>(response, 'Unable to load Product Rewards history.'))
      .then(payload => {
        if (controller.signal.aborted) return
        setHistory(payload); setError('')
        if (!payload.visible) onDisabled?.()
      })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to load history.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [admin, page, search, revision, onDisabled])

  if (history && !history.visible) return null
  const result = history?.visible ? history : null
  function changePage(next: number) { setLoading(true); setPage(next) }
  function refresh() { setLoading(true); setRevision(value => value + 1) }

  return <section aria-label="Product Rewards transaction history" className="mt-4 overflow-hidden rounded-xl border border-[#0D1B3E]/10 bg-white text-[#0D1B3E]">
    <div className="space-y-3 border-b border-[#0D1B3E]/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-sm font-semibold">Product Rewards transaction history</h3><p className="mt-1 text-xs text-gray-500">One entry per qualifying pair, including bottles earned together. Dates use Philippine time.</p></div>
        <button type="button" onClick={refresh} disabled={loading} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">Refresh</button>
      </div>
      {admin && <form onSubmit={event => { event.preventDefault(); setLoading(true); setPage(1); setSearch(query.trim()); setRevision(value => value + 1) }} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="product-reward-history-search">Search member or reward reference</label>
        <input id="product-reward-history-search" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="Member name, username or reward reference" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" />
        <button type="submit" disabled={loading} className="rounded-lg bg-[#0D1B3E] px-4 py-2 text-xs text-white disabled:opacity-50">Search</button>
      </form>}
      {result && <p className="text-xs text-gray-500">{result.total.toLocaleString()} bottle-credit {result.total === 1 ? 'entry' : 'entries'} · Claim status is recorded per bottle.</p>}
    </div>
    {error && <p role="alert" className="p-4 text-xs text-red-600">{error}</p>}
    {loading ? <p role="status" className="p-4 text-xs text-gray-500">Loading transaction history…</p> : !error && result && <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-gray-500"><tr>
            <th scope="col" className="whitespace-nowrap px-3 py-2">Date earned</th>
            {admin && <th scope="col" className="px-3 py-2">Reseller</th>}
            <th scope="col" className="px-3 py-2">Eligible pair</th><th scope="col" className="px-3 py-2">Product</th>
            <th scope="col" className="px-3 py-2">Bottles</th>
            <th scope="col" className="px-3 py-2">Claim status</th>
            {admin && <th scope="col" className="whitespace-nowrap px-3 py-2">Company cost</th>}
            <th scope="col" className="px-3 py-2">Reward reference</th>
          </tr></thead>
          <tbody className="divide-y">
            {result.items.map(item => <tr key={item.reference}>
              <td className="whitespace-nowrap px-3 py-3 align-top">{manilaDate(item.recorded_at)}</td>
              {admin && <td className="px-3 py-3 align-top"><p>{item.member_name}</p><p className="text-gray-500">@{item.member_username}</p></td>}
              <td className="px-3 py-3 align-top"><strong>#{item.qualifying_pair.toLocaleString()}</strong><p className="mt-1 whitespace-nowrap text-gray-500">Every {item.reward_interval} pairs</p></td>
              <td className="px-3 py-3 align-top">{item.product_name}</td><td className="px-3 py-3 align-top">{item.quantity}</td>
              <td className="px-3 py-3 align-top">{item.claim_reference ? <><strong className="text-emerald-700">Claimed</strong><p className="mt-1">{item.claim_outlet}</p><p className="text-gray-500">{item.claimed_at && manilaDate(item.claimed_at)}</p><p className="text-gray-500">Released by {item.claim_cashier}</p><code className="mt-1 block max-w-60 select-all break-all text-[10px]">{item.claim_reference}</code></> : <strong className="text-amber-700">Unclaimed</strong>}</td>
              {admin && <td className="px-3 py-3 align-top">₱{Number(item.company_unit_cost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>}
              <td className="px-3 py-3 align-top"><code className="block min-w-40 max-w-60 select-all break-all text-[10px]">{item.reference}</code>
                <details className="mt-2"><summary className="cursor-pointer text-gray-500">Pair transaction</summary><p className="mt-1 capitalize">{item.source_kind}</p><code className="block max-w-60 select-all break-all text-[10px]">{item.transaction_reference}</code></details>
              </td>
            </tr>)}
            {result.items.length === 0 && <tr><td colSpan={admin ? 8 : 6} className="px-3 py-8 text-center text-gray-500">{search ? 'No matching Product Rewards transactions.' : 'No Product Rewards transactions yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-xs">
        <button type="button" disabled={result.page <= 1} onClick={() => changePage(result.page - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Previous</button>
        <span>Page {result.page} of {result.total_pages}</span>
        <button type="button" disabled={result.page >= result.total_pages} onClick={() => changePage(result.page + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button>
      </div>
    </>}
  </section>
}
