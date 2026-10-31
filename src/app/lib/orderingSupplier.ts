import { Prisma } from '@prisma/client'

export type OrderingRole = 'city' | 'provincial' | 'regional'
export type OrderingSupplier = { id: string; full_name: string; username: string; level: string }
type SupplierDb = Pick<Prisma.TransactionClient, 'distributorProfile' | 'user'>

export class OrderingSupplierChangedError extends Error {
  constructor() { super('The ordering supplier has changed. Reload the order form before placing this order.') }
}
export function assertOrderingSupplier(selected: unknown, supplier: OrderingSupplier | null) {
  if (selected !== undefined && selected !== null && (typeof selected !== 'string' || selected !== supplier?.id)) throw new OrderingSupplierChangedError()
}

export async function resolveOrderingSupplier(db: SupplierDb, buyerId: string, role: OrderingRole): Promise<OrderingSupplier | null> {
  const profile = await db.distributorProfile.findUnique({ where: { user_id: buyerId },
    select: { is_active: true, dist_level: true, province_code: true, region_code: true } })
  if (!profile?.is_active || (role === 'city' ? !['city', 'branch'].includes(profile.dist_level) : profile.dist_level !== role)) return null
  // Territory is authoritative. Stale parent links cannot route stock across territories.
  if (role === 'city' && profile.province_code) {
    const provincial = await db.distributorProfile.findFirst({ where: { dist_level: 'provincial', province_code: profile.province_code, ...(profile.region_code ? { region_code: profile.region_code } : {}), is_active: true, user: { role: 'provincial', status: 'active' } },
      select: { user: { select: { id: true, full_name: true, username: true } } }, orderBy: { id: 'asc' } })
    if (provincial) return { ...provincial.user, level: 'Provincial Distributor' }
  }
  if (role !== 'regional' && profile.region_code) {
    const regional = await db.distributorProfile.findFirst({ where: { dist_level: 'regional', region_code: profile.region_code, is_active: true, user: { role: 'regional', status: 'active' } },
      select: { user: { select: { id: true, full_name: true, username: true } } }, orderBy: { id: 'asc' } })
    if (regional) return { ...regional.user, level: 'Regional Distributor' }
  }
  const admin = await db.user.findFirst({ where: { role: 'admin', status: 'active' }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }], select: { id: true, full_name: true, username: true } })
  return admin ? { ...admin, level: 'Admin' } : null
}

export async function loadSupplierOrderCatalog(
  db: SupplierDb & Pick<Prisma.TransactionClient, '$queryRaw'>, buyerId: string, role: OrderingRole, selected?: unknown,
) {
  const supplier = await resolveOrderingSupplier(db, buyerId, role)
  assertOrderingSupplier(selected, supplier)
  if (!supplier) return { supplier: null, products: [] }
  const products = await db.$queryRaw<{ id: string; name: string; type: string; price: number; available_quantity: number }[]>(Prisma.sql`
    SELECT p.id,p.name,p.type::text,
      (CASE WHEN ${role}='regional' THEN COALESCE(NULLIF(p.regional_price,0),p.price)
        WHEN ${role}='provincial' THEN COALESCE(NULLIF(p.provincial_price,0),p.price)
        WHEN dp.dist_level::text='branch' THEN COALESCE(NULLIF(p.branch_price,0),p.cost_price)
        ELSE p.city_price END)::float price,
      GREATEST(0,COALESCE(i.quantity-i.reserved_quantity,0))::int available_quantity
    FROM products p JOIN distributor_profiles dp ON dp.user_id=${buyerId}
    LEFT JOIN inventory i ON i.owner_id=${supplier.id} AND i.product_id=p.id
    WHERE p.is_active=true AND NOT EXISTS(SELECT 1 FROM product_area_visibility v
      WHERE v.distributor_id=dp.id AND v.product_id=p.id AND v.is_visible=false)
    ORDER BY p.name,p.id
  `)
  return { supplier, products: products.map(product => ({ ...product, is_available: product.available_quantity > 0, available_quantity: supplier.level === 'Admin' ? null : product.available_quantity })) }
}
