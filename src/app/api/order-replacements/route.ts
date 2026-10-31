import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { canAccessRewardStock } from '@/app/lib/rewardStockReplacement'
import { resolveOrderingSupplier, assertOrderingSupplier, OrderingSupplierChangedError, type OrderingRole } from '@/app/lib/orderingSupplier'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['city', 'provincial', 'regional'].includes(user.role) || !canAccessRewardStock(user, true)) return NextResponse.json({ error: 'Inventory management access is required.' }, { status: 403 })
    const result = await prisma.$transaction(async tx => {
      const supplier = await resolveOrderingSupplier(tx, user.id, user.role as OrderingRole)
      assertOrderingSupplier(req.nextUrl.searchParams.get('supplier_id'), supplier)
      if (!supplier) return { credits: [] }
      const credits = await tx.$queryRaw<{ product_id: string; product_name: string; kind: string; credits: number; available_quantity: number; is_available: boolean }[]>`
        SELECT u.product_id,p.name product_name,u.kind,COUNT(*)::int credits,
          GREATEST(0,COALESCE(i.quantity-i.reserved_quantity,0))::int available_quantity,
          COALESCE(i.quantity-i.reserved_quantity,0)>0 is_available
        FROM reward_stock_units u JOIN products p ON p.id=u.product_id
        LEFT JOIN inventory i ON i.owner_id=${supplier.id} AND i.product_id=u.product_id
        WHERE u.holder_id=${user.id} AND u.current_dispatch_id IS NULL AND u.settled_at IS NULL
          AND can_supply_reward_stock(${supplier.id},${user.id},u.kind)
          AND NOT EXISTS(SELECT 1 FROM order_replacement_units a JOIN order_replacement_requests r ON r.id=a.request_id WHERE a.unit_id=u.id AND r.state='pending')
        GROUP BY u.product_id,p.name,u.kind,i.quantity,i.reserved_quantity ORDER BY p.name,u.kind
      `
      return { credits: credits.map(line => ({ ...line, available_quantity: supplier.level === 'Admin' ? null : line.available_quantity })) }
    }, { isolationLevel: 'RepeatableRead' })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof OrderingSupplierChangedError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('[ORDER REPLACEMENT OPTIONS]', error)
    return NextResponse.json({ error: 'Unable to load replacement credits. Check database setup and connection.' }, { status: 500 })
  }
}
