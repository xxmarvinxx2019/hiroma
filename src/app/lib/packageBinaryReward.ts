import type { Prisma } from '@prisma/client'

export const PACKAGE_REWARD_POLICY_KEY = 'package_binary_product_reward'
export const PACKAGE_REWARD_LOCK = 'package-binary-product-reward-policy'
export type PackageRewardPolicy = { enabled: boolean; interval: number; product_id: string | null }
export const DEFAULT_PACKAGE_REWARD_POLICY: PackageRewardPolicy = { enabled: false, interval: 5, product_id: null }

export function validatePackageRewardPolicy(value: unknown): PackageRewardPolicy {
  if (!value || typeof value !== 'object') throw new Error('Invalid product reward policy.')
  const policy = value as Record<string, unknown>
  if (typeof policy.enabled !== 'boolean' || !Number.isInteger(policy.interval) || Number(policy.interval) < 2 || Number(policy.interval) > 1000
    || (policy.product_id !== null && (typeof policy.product_id !== 'string' || !policy.product_id.trim() || policy.product_id.length > 255))
    || (policy.enabled && !policy.product_id)) {
    throw new Error('Choose a reward bottle and a whole interval from 2 to 1000 pairs.')
  }
  return { enabled: policy.enabled, interval: Number(policy.interval), product_id: policy.product_id as string | null }
}

export async function getPackageRewardPolicy(db: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<PackageRewardPolicy> {
  const [row] = await db.$queryRaw<{ value: string }[]>`SELECT value FROM system_settings WHERE key=${PACKAGE_REWARD_POLICY_KEY}`
  return row ? validatePackageRewardPolicy(JSON.parse(row.value)) : { ...DEFAULT_PACKAGE_REWARD_POLICY }
}

// Ordinals continue across days and interval changes. Historical pairs before
// activation and pairs earned while disabled do not advance this counter.
export function splitPackageRewardPairs(opening: number, eligible: number, policy: PackageRewardPolicy) {
  if (!Number.isSafeInteger(opening) || opening < 0 || !Number.isSafeInteger(eligible) || eligible < 0 || !Number.isSafeInteger(opening + eligible)) {
    throw new Error('Invalid Package Binary reward pair count.')
  }
  validatePackageRewardPolicy(policy)
  const closing = opening + (policy.enabled ? eligible : 0)
  const productPairs = policy.enabled ? Math.floor(closing / policy.interval) - Math.floor(opening / policy.interval) : 0
  return { cashPairs: eligible - productPairs, productPairs, opening, closing }
}

export async function getPackageRewardCount(db: Pick<Prisma.TransactionClient, '$queryRaw'>, userId: string) {
  const [row] = await db.$queryRaw<{ count: string }[]>`
    SELECT COALESCE(SUM(payable_pairs) FILTER (WHERE reward_interval IS NOT NULL),0)::text count
    FROM binary_pair_events WHERE recipient_user_id=${userId}
  `
  const count = Number(row?.count || 0)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid reward counter.')
  return count
}

export async function getPackageRewardWallet(db: Pick<Prisma.TransactionClient, '$queryRaw'>, userId: string) {
  const policy = await getPackageRewardPolicy(db)
  const eligiblePairs = await getPackageRewardCount(db, userId)
  const bottles = await db.$queryRaw<{ product_id: string; product_name: string; bottles: number; claimed: number; unclaimed: number }[]>`
    SELECT r.product_id, r.product_name_snapshot product_name, SUM(r.quantity)::int bottles,
      SUM((SELECT COUNT(*) FROM product_reward_claim_allocations a WHERE a.reward_id=r.id))::int claimed,
      SUM(r.quantity-(SELECT COUNT(*) FROM product_reward_claim_allocations a WHERE a.reward_id=r.id))::int unclaimed
    FROM package_binary_product_rewards r WHERE r.user_id=${userId}
    GROUP BY r.product_id, r.product_name_snapshot ORDER BY r.product_name_snapshot
  `
  return { enabled: policy.enabled, interval: policy.interval, eligible_pairs: eligiblePairs,
    pairs_until_next: policy.enabled ? policy.interval - eligiblePairs % policy.interval : null,
    bottles_earned: bottles.reduce((sum, row) => sum + row.bottles, 0),
    bottles_claimed: bottles.reduce((sum, row) => sum + row.claimed, 0),
    bottles_unclaimed: bottles.reduce((sum, row) => sum + row.unclaimed, 0), bottles }
}
