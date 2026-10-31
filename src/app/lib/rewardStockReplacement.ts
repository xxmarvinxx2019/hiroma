import { Prisma } from '@prisma/client'
import type { JWTPayload } from '@/app/lib/auth'
import { UUID_PATTERN } from '@/app/lib/productRewardClaims'

export function canAccessRewardStock(user: JWTPayload | null, write = false) {
  if (!user || !['admin', 'regional', 'provincial', 'city'].includes(user.role)) return false
  if (!user.is_staff) return true
  return user.permissions?.includes(user.role === 'admin' ? (write ? 'inventory:manage' : 'inventory:view') : 'inventory') === true
}

export function parseRewardStockDispatch(body: unknown) {
  if (!body || typeof body !== 'object') throw new Error('Invalid replacement dispatch.')
  const value = body as Record<string, unknown>
  if (typeof value.client_request_id !== 'string' || !UUID_PATTERN.test(value.client_request_id)
    || typeof value.recipient_id !== 'string' || !value.recipient_id || value.recipient_id.length > 255
    || typeof value.product_id !== 'string' || !value.product_id || value.product_id.length > 255
    || !['internal_replenishment', 'distributor_replacement'].includes(String(value.kind))
    || !Number.isInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 100) throw new Error('Invalid replacement dispatch.')
  return { client_request_id: value.client_request_id.toLowerCase(), recipient_id: value.recipient_id, product_id: value.product_id,
    kind: String(value.kind), quantity: Number(value.quantity) }
}

export async function loadRewardStockWorkspace(db: Pick<Prisma.TransactionClient, '$queryRaw'>, user: JWTPayload, page: number, search = '') {
  const admin = user.role === 'admin'
  const visible = admin ? Prisma.sql`TRUE` : Prisma.sql`(u.holder_id=${user.id} OR u.origin_outlet_id=${user.id} OR can_supply_reward_stock(${user.id},u.holder_id,u.kind))`
  const [summary] = await db.$queryRaw<{ pending: number; reserved: number; in_transit: number; global_open: number; origin_replaced: number }[]>(Prisma.sql`
    SELECT COUNT(*) FILTER(WHERE holder_id=${user.id} AND settled_at IS NULL AND current_dispatch_id IS NULL AND NOT EXISTS(SELECT 1 FROM order_replacement_units a JOIN order_replacement_requests r ON r.id=a.request_id WHERE a.unit_id=reward_stock_units.id AND r.state='pending'))::int pending,
      COUNT(*) FILTER(WHERE holder_id=${user.id} AND EXISTS(SELECT 1 FROM order_replacement_units a JOIN order_replacement_requests r ON r.id=a.request_id WHERE a.unit_id=reward_stock_units.id AND r.state='pending'))::int reserved,
      COUNT(*) FILTER(WHERE holder_id=${user.id} AND current_dispatch_id IS NOT NULL)::int in_transit,
      COUNT(*) FILTER(WHERE ${admin} AND settled_at IS NULL)::int global_open,
      COUNT(*) FILTER(WHERE origin_outlet_id=${user.id} AND (holder_id IS DISTINCT FROM ${user.id} OR settled_at IS NOT NULL))::int origin_replaced
    FROM reward_stock_units
  `)
  const pendingVisible = admin ? Prisma.sql`TRUE` : Prisma.sql`(g.holder_id=${user.id} OR can_supply_reward_stock(${user.id},g.holder_id,g.kind))`
  const pattern = `%${search.trim().slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`
  const groups = await db.$queryRaw<{ recipient_id: string; recipient_name: string; product_id: string; product_name: string; kind: string; pending: number; available_stock: number; can_supply: boolean }[]>(Prisma.sql`
    WITH pending AS (SELECT holder_id,product_id,kind,COUNT(*)::int pending FROM reward_stock_units
      WHERE settled_at IS NULL AND current_dispatch_id IS NULL AND NOT EXISTS(SELECT 1 FROM order_replacement_units a JOIN order_replacement_requests r ON r.id=a.request_id WHERE a.unit_id=reward_stock_units.id AND r.state='pending') GROUP BY holder_id,product_id,kind)
    SELECT g.holder_id recipient_id,h.full_name recipient_name,g.product_id,p.name product_name,g.kind,g.pending,
      GREATEST(0,COALESCE(i.quantity-i.reserved_quantity,0))::int available_stock,
      can_supply_reward_stock(${user.id},g.holder_id,g.kind) can_supply
    FROM pending g JOIN users h ON h.id=g.holder_id JOIN products p ON p.id=g.product_id
    LEFT JOIN inventory i ON i.owner_id=${user.id} AND i.product_id=g.product_id
    WHERE ${pendingVisible} AND (h.full_name ILIKE ${pattern} OR h.username ILIKE ${pattern} OR p.name ILIKE ${pattern})
    ORDER BY h.full_name,p.name,g.kind LIMIT 201
  `)
  const shipmentFilter = admin ? Prisma.sql`TRUE` : Prisma.sql`(d.supplier_id=${user.id} OR d.recipient_id=${user.id})`
  const [total] = await db.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT COUNT(*)::int count FROM reward_stock_dispatches d WHERE ${shipmentFilter}`)
  const totalPages = Math.max(1, Math.ceil(total.count / 20)), currentPage = Math.min(page, totalPages)
  const shipments = await db.$queryRaw<{ id: string; supplier_id: string; recipient_id: string; supplier_name: string; recipient_name: string; product_name: string; kind: string; quantity: number; dispatched_at: Date; received_at: Date | null; receipt_actor: string | null; can_receive: boolean; combined_order_id: string | null }[]>(Prisma.sql`
    SELECT d.id::text,d.supplier_id,d.recipient_id,d.supplier_name,d.recipient_name,d.product_name,d.kind,d.quantity,d.dispatched_at,
      r.received_at,r.actor_name receipt_actor,(d.recipient_id=${user.id} AND r.id IS NULL) can_receive,
      (SELECT order_id FROM order_replacement_requests o WHERE o.id=d.id) combined_order_id
    FROM reward_stock_dispatches d LEFT JOIN reward_stock_receipts r ON r.dispatch_id=d.id
    WHERE ${shipmentFilter} ORDER BY d.dispatched_at DESC,d.id DESC LIMIT 20 OFFSET ${(currentPage - 1) * 20}
  `)
  const units = await db.$queryRaw<{ id: string; claim_reference: string; product_name: string; origin_name: string; holder_name: string | null; kind: string; classification_source: string; current_dispatch_id: string | null; cycle: number; settled_at: Date | null }[]>(Prisma.sql`
    SELECT u.id::text,c.id::text claim_reference,p.name product_name,o.full_name origin_name,h.full_name holder_name,u.kind,u.classification_source,
      u.current_dispatch_id::text,u.cycle,u.settled_at
    FROM reward_stock_units u JOIN product_reward_claim_allocations a ON a.id=u.claim_allocation_id
    JOIN product_reward_claims c ON c.id=a.claim_id JOIN products p ON p.id=u.product_id JOIN users o ON o.id=u.origin_outlet_id LEFT JOIN users h ON h.id=u.holder_id
    WHERE ${visible} ORDER BY u.created_at DESC,u.id DESC LIMIT 50
  `)
  return { summary, groups: groups.slice(0, 200), groups_has_more: groups.length > 200, shipments, units, page: currentPage, total_pages: totalPages, total_shipments: total.count,
    can_write: canAccessRewardStock(user, true), is_admin: admin }
}
