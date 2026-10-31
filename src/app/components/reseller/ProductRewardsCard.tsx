'use client'

import { useCallback, useEffect, useState } from 'react'
import ProductRewardsHistory from '@/app/components/rewards/ProductRewardsHistory'

type RewardWallet = {
  enabled: boolean; interval: number; pairs_until_next: number | null; bottles_earned: number; bottles_claimed: number; bottles_unclaimed: number
  bottles: { product_id: string; product_name: string; bottles: number; unclaimed: number }[]
}

export default function ProductRewardsCard() {
  const [wallet, setWallet] = useState<RewardWallet | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const hideDisabledRewards = useCallback(() => setWallet(null), [])
  useEffect(() => {
    let cancelled = false
    fetch('/api/reseller/product-rewards', { cache: 'no-store' }).then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load product rewards.')
      if (!cancelled) setWallet(data)
    }).catch(() => { if (!cancelled) setWallet(null) })
    return () => { cancelled = true }
  }, [])
  // Render nothing until the policy is confirmed enabled, so a disabled
  // feature never flashes a heading, loading state or disabled description.
  if (!wallet?.enabled) return null

  return <section aria-label="Product Rewards" className="my-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-[#0D1B3E]">
    <div className="flex items-start justify-between gap-4">
      <div><h2 className="text-sm font-bold">🎁 Product Rewards</h2><p className="mt-1 text-xs text-gray-500">Package Binary bottle credits · not withdrawable as cash</p></div>
      <strong className="whitespace-nowrap text-xl">{wallet.bottles_unclaimed.toLocaleString()} unclaimed</strong>
    </div>
      <p className="mt-3 text-xs">{`Every ${wallet.interval} eligible pairs earns one bottle instead of cash. ${wallet.pairs_until_next} more eligible ${wallet.pairs_until_next === 1 ? 'pair' : 'pairs'} until your next bottle.`}</p>
      {wallet.bottles.length > 0 && <ul className="mt-3 space-y-1 text-sm">{wallet.bottles.map(row => <li key={`${row.product_id}:${row.product_name}`} className="flex justify-between gap-3"><span>{row.product_name}</span><strong>{row.unclaimed} unclaimed</strong></li>)}</ul>}
      <p className="mt-3 text-xs text-gray-500">{wallet.bottles_earned} earned · {wallet.bottles_claimed} claimed. Claim at a branch or city POS using your Member ID and Security PIN.</p>
      <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)} className="mt-4 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold">{showHistory ? 'Hide transaction history' : 'View transaction history'}</button>
      {showHistory && <ProductRewardsHistory onDisabled={hideDisabledRewards} />}
  </section>
}
