import { Prisma } from '@prisma/client'

export type RewardHistoryScope = { kind: 'reseller'; userId: string } | { kind: 'admin'; search: string }
export type RewardHistoryItem = {
  reference: string
  transaction_reference: string
  recorded_at: string
  qualifying_pair: number
  reward_interval: number
  product_name: string
  quantity: number
  source_kind: string
  claim_reference: string | null
  claimed_at: string | null
  claim_outlet: string | null
  claim_cashier: string | null
  member_name?: string
  member_username?: string
  company_unit_cost?: number
}
export type RewardHistoryPage = {
  items: RewardHistoryItem[]
  page: number
  page_size: number
  total: number
  total_pages: number
}

export function rewardHistoryPagination(params: URLSearchParams) {
  const parse = (key: string, fallback: number, maximum: number) => {
    const raw = params.get(key)
    if (raw === null) return fallback
    if (!/^[1-9]\d*$/.test(raw)) throw new Error('Invalid history pagination.')
    const number = Number(raw)
    if (!Number.isSafeInteger(number) || number > maximum) throw new Error('Invalid history pagination.')
    return number
  }
  return { page: parse('page', 1, 1_000_000), pageSize: parse('page_size', 20, 50) }
}

export async function loadProductRewardHistory(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  scope: RewardHistoryScope,
  pagination: { page: number; pageSize: number },
): Promise<RewardHistoryPage> {
  const { page, pageSize } = pagination
  const search = scope.kind === 'admin' ? scope.search.trim().slice(0, 100) : ''
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
  const reference = search.match(/^PR-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9]\d*)$/i)
  const ordinal = reference && Number.isSafeInteger(Number(reference[2])) ? Number(reference[2]) : null
  // Scope is chosen by the authenticated route, never from a client user ID.
  const filter = scope.kind === 'reseller' ? Prisma.sql`r.user_id=${scope.userId}`
    : reference && ordinal !== null ? Prisma.sql`r.id::text=${reference[1].toLowerCase()}`
    : search ? Prisma.sql`(u.full_name ILIKE ${pattern} OR u.username ILIKE ${pattern} OR r.id::text ILIKE ${pattern})` : Prisma.sql`TRUE`
  const quantity = reference && ordinal !== null ? Prisma.sql`CASE
    WHEN ${ordinal}::bigint > e.opening_reward_eligible_count
      AND ${ordinal}::bigint <= e.opening_reward_eligible_count + e.payable_pairs
      AND ${ordinal}::bigint % e.reward_interval = 0 THEN 1 ELSE 0 END` : Prisma.sql`r.quantity`
  const [count] = await db.$queryRaw<{ total: string }[]>(Prisma.sql`
    SELECT COALESCE(SUM(${quantity}),0)::text total
    FROM package_binary_product_rewards r JOIN binary_pair_events e ON e.id=r.pair_event_id JOIN users u ON u.id=r.user_id
    WHERE ${filter}
  `)
  const total = Number(count.total)
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid product reward history total.')
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, totalPages)
  const adminFields = scope.kind === 'admin'
    ? Prisma.sql`, u.full_name member_name, u.username member_username, r.unit_cost_snapshot::text company_unit_cost`
    : Prisma.empty
  const rows = await db.$queryRaw<{
    reward_id: string; pair_event_id: string; recorded_at: Date; qualifying_pair: string
    reward_interval: number; product_name: string; source_kind: string
    member_name?: string; member_username?: string; company_unit_cost?: string
    claim_id: string | null; claimed_at: Date | null; claim_outlet: string | null; claim_cashier: string | null
  }[]>(Prisma.sql`
    SELECT r.id::text reward_id, r.pair_event_id::text, r.created_at recorded_at,
      ((e.opening_reward_eligible_count / e.reward_interval + milestone.number) * e.reward_interval)::text qualifying_pair,
      e.reward_interval, r.product_name_snapshot product_name, e.source_kind,
      c.id::text claim_id,c.released_at claimed_at,c.outlet_name_snapshot claim_outlet,c.actor_name_snapshot claim_cashier ${adminFields}
    FROM package_binary_product_rewards r
    JOIN binary_pair_events e ON e.id=r.pair_event_id
    JOIN users u ON u.id=r.user_id
    CROSS JOIN LATERAL generate_series(1,r.quantity) milestone(number)
    LEFT JOIN product_reward_claim_allocations allocation ON allocation.reward_id=r.id AND allocation.unit_number=milestone.number
    LEFT JOIN product_reward_claims c ON c.id=allocation.claim_id
    WHERE ${filter} ${reference && ordinal !== null ? Prisma.sql`AND
      (e.opening_reward_eligible_count / e.reward_interval + milestone.number) * e.reward_interval = ${ordinal}::bigint` : Prisma.empty}
    ORDER BY r.created_at DESC,r.id DESC,milestone.number DESC
    LIMIT ${pageSize} OFFSET ${(currentPage - 1) * pageSize}
  `)
  const items = rows.map(row => {
    const ordinal = Number(row.qualifying_pair)
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error('Invalid product reward pair ordinal.')
    return {
      reference: `PR-${row.reward_id}:${ordinal}`,
      transaction_reference: row.pair_event_id,
      recorded_at: row.recorded_at.toISOString(),
      qualifying_pair: ordinal, reward_interval: row.reward_interval,
      product_name: row.product_name, quantity: 1, source_kind: row.source_kind,
      claim_reference: row.claim_id ? `RC-${row.claim_id}` : null,
      claimed_at: row.claimed_at?.toISOString() || null, claim_outlet: row.claim_outlet, claim_cashier: row.claim_cashier,
      ...(scope.kind === 'admin' ? {
        member_name: row.member_name, member_username: row.member_username,
        company_unit_cost: Number(row.company_unit_cost),
      } : {}),
    }
  })
  return { items, page: currentPage, page_size: pageSize, total, total_pages: totalPages }
}
