import { Prisma } from '@prisma/client'

export type ReplacementSelection = { product_id: string; kind: string; quantity: number }
export function parseOrderReplacements(value: unknown): ReplacementSelection[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 20) throw new Error('Invalid replacement selection.')
  const keys = new Set<string>()
  return value.map(item => {
    if (!item || typeof item.product_id !== 'string' || !item.product_id || !['distributor_replacement', 'internal_replenishment'].includes(item.kind)
      || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) throw new Error('Invalid replacement selection.')
    const key = `${item.product_id}:${item.kind}`
    if (keys.has(key)) throw new Error('Invalid replacement selection.')
    keys.add(key)
    return { product_id: item.product_id, kind: item.kind, quantity: item.quantity }
  }).sort((a, b) => a.product_id.localeCompare(b.product_id) || a.kind.localeCompare(b.kind))
}

export async function reserveOrderReplacements(tx: Pick<Prisma.TransactionClient, '$executeRaw'>, orderId: string, actorId: string, selections: ReplacementSelection[]) {
  for (const line of selections) await tx.$executeRaw`
    INSERT INTO order_replacement_requests(order_id,actor_id,product_id,kind,quantity)
    VALUES(${orderId},${actorId},${line.product_id},${line.kind},${line.quantity})
  `
}

export async function orderReplacementLines(db: Pick<Prisma.TransactionClient, '$queryRaw'>, ids: string[]) {
  if (!ids.length) return []
  return db.$queryRaw<{ order_id: string; id: string; product_name: string; quantity: number; state: string; received: boolean }[]>(Prisma.sql`
    SELECT r.order_id,r.id::text,p.name product_name,r.quantity,r.state,
      EXISTS(SELECT 1 FROM reward_stock_receipts s WHERE s.dispatch_id=r.id) received
    FROM order_replacement_requests r JOIN products p ON p.id=r.product_id WHERE r.order_id IN (${Prisma.join(ids)}) ORDER BY r.created_at,r.id
  `)
}

export function orderReplacementError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  return ['Invalid replacement selection.', 'Replacement credits are unavailable or already reserved.',
    'Replacement supplier is not authorized.', 'Replacement stock is currently unavailable. Reduce the quantity or contact the supplier.',
    'Only pending purchase orders can include replacements.'].find(value => message.includes(value))
}
