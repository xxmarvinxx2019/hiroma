import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const hashRewardClaimProof = (token: string) => createHash('sha256').update(token).digest('hex')
export type RewardClaimInput = { client_request_id: string; terminal_id: string; shift_id: string; reseller_id: string; product_id: string; quantity: number; scan_proof: string }
export type ClaimReceipt = { id: string; client_request_id: string; reseller_id: string; product_id: string; quantity: number; product_name: string; outlet_name: string; cashier_name: string; stock_after: number; available_stock?: number; released_at: Date }
type ClaimDb = Pick<Prisma.TransactionClient, '$queryRaw'>

export function parseRewardClaim(body: unknown): RewardClaimInput {
  if (!body || typeof body !== 'object') throw new Error('Invalid reward claim.')
  const value = body as Record<string, unknown>
  for (const key of ['client_request_id', 'terminal_id', 'shift_id']) {
    if (typeof value[key] !== 'string' || !UUID_PATTERN.test(value[key])) throw new Error('Invalid reward claim.')
  }
  for (const key of ['reseller_id', 'product_id']) {
    if (typeof value[key] !== 'string' || !value[key] || value[key].length > 255) throw new Error('Invalid reward claim.')
  }
  if (!Number.isInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 100
    || typeof value.scan_proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.scan_proof)) throw new Error('Invalid reward claim.')
  return { client_request_id: String(value.client_request_id).toLowerCase(), terminal_id: String(value.terminal_id).toLowerCase(),
    shift_id: String(value.shift_id).toLowerCase(), reseller_id: String(value.reseller_id), product_id: String(value.product_id),
    quantity: Number(value.quantity), scan_proof: value.scan_proof }
}

export async function assertRewardClaimShift(db: ClaimDb, ownerId: string, actorId: string, terminalId: string, shiftId: string) {
  const [row] = await db.$queryRaw<{ valid: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pos_shifts s JOIN pos_terminals t ON t.id=s.terminal_id
      JOIN users u ON u.id=s.owner_id JOIN distributor_profiles dp ON dp.user_id=u.id
      WHERE s.id=${shiftId}::uuid AND s.owner_id=${ownerId} AND s.opened_by_id=${actorId}
        AND s.terminal_id=${terminalId}::uuid AND t.owner_id=${ownerId} AND t.is_active
        AND s.status::text='open' AND u.role::text='city' AND u.status::text='active'
        AND dp.is_active AND dp.dist_level::text IN ('city','branch')) valid
  `
  if (!row?.valid) throw new Error('Open your own cashier shift at an active branch/city terminal first.')
}

export async function listClaimableRewardBottles(db: ClaimDb, resellerId: string, ownerId: string) {
  return db.$queryRaw<{ product_id: string; product_name: string; unclaimed: number; available_stock: number }[]>`
    SELECT r.product_id,p.name product_name,
      SUM(r.quantity-(SELECT COUNT(*) FROM product_reward_claim_allocations a WHERE a.reward_id=r.id))::int unclaimed,
      GREATEST(0,COALESCE(i.quantity-i.reserved_quantity,0))::int available_stock
    FROM package_binary_product_rewards r JOIN products p ON p.id=r.product_id
    LEFT JOIN inventory i ON i.owner_id=${ownerId} AND i.product_id=r.product_id
    WHERE r.user_id=${resellerId}
    GROUP BY r.product_id,p.name,i.quantity,i.reserved_quantity
    HAVING SUM(r.quantity-(SELECT COUNT(*) FROM product_reward_claim_allocations a WHERE a.reward_id=r.id))>0
    ORDER BY p.name,r.product_id
  `
}

export async function findRewardClaimReplay(db: ClaimDb, input: RewardClaimInput, ownerId: string, actorId: string) {
  const [row] = await db.$queryRaw<(ClaimReceipt & { owner_id: string; actor_id: string; terminal_id: string; shift_id: string; token_hash: string })[]>`
    SELECT c.id::text,c.client_request_id::text,c.owner_id,c.actor_id,c.reseller_id,c.product_id,c.quantity,
      c.terminal_id::text,c.shift_id::text,c.product_name_snapshot product_name,c.outlet_name_snapshot outlet_name,
      c.actor_name_snapshot cashier_name,c.stock_after,c.released_at,p.token_hash,
      COALESCE((SELECT GREATEST(0,i.quantity-i.reserved_quantity) FROM inventory i WHERE i.owner_id=c.owner_id AND i.product_id=c.product_id),0)::int available_stock
    FROM product_reward_claims c JOIN product_reward_claim_proofs p ON p.id=c.proof_id
    WHERE c.client_request_id=${input.client_request_id}::uuid
  `
  if (!row) return null
  if (row.owner_id !== ownerId || row.actor_id !== actorId || row.reseller_id !== input.reseller_id || row.product_id !== input.product_id
    || row.quantity !== input.quantity || row.terminal_id !== input.terminal_id || row.shift_id !== input.shift_id || row.token_hash !== hashRewardClaimProof(input.scan_proof)) {
    throw new Error('This claim reference was already used for a different release.')
  }
  return claimReceipt(row)
}

export function claimReceipt(row: ClaimReceipt) {
  return { id: row.id, reference: `RC-${row.id}`, client_request_id: row.client_request_id,
    reseller_id: row.reseller_id, product_id: row.product_id, quantity: row.quantity,
    product_name: row.product_name, outlet_name: row.outlet_name, cashier_name: row.cashier_name,
    stock_after: row.stock_after, available_stock: row.available_stock ?? row.stock_after, released_at: row.released_at.toISOString() }
}
