import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { boundedPage, boundedPageSize } from '@/app/lib/pagination'

// ── GET city distributor's inventory with search & pagination ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true },
    })
    const isBranch = profile?.dist_level === 'branch'
    const canViewFinancials = user.is_staff !== true || user.permissions?.includes('reports') === true
    const actorId = user.actor_id || user.id
    const inventoryCost = (product: { cost_price: unknown; city_price: unknown; branch_price: unknown }) =>
      isBranch ? Number(product.branch_price) || Number(product.cost_price) : Number(product.city_price)

    const { searchParams } = req.nextUrl
    const search     = searchParams.get('search') || ''
    const type       = searchParams.get('type')   || 'all'
    const stockParam = searchParams.get('stock')  || 'all'
    const page       = boundedPage(searchParams.get('page'))
    const pageSize   = boundedPageSize(searchParams.get('pageSize'))
    const now = new Date()
    const manilaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const periodStart = new Date(Date.UTC(
      manilaNow.getUTCFullYear(),
      manilaNow.getUTCMonth(),
      manilaNow.getUTCDate(),
    ) - 8 * 60 * 60 * 1000)

    const productFilter: Record<string, unknown> = {
      ...(type !== 'all' && { type }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    }

    let stockWhere: Record<string, unknown> = {}
    if (stockParam === 'out') stockWhere = { quantity: { equals: 0 } }
    if (stockParam === 'low') stockWhere = { quantity: { gt: 0, lte: prisma.inventory.fields.low_stock_threshold } }
    if (stockParam === 'ok')  stockWhere = { quantity: { gt: prisma.inventory.fields.low_stock_threshold } }

    const where: Record<string, unknown> = {
      owner_id: user.id,
      ...stockWhere,
      ...(Object.keys(productFilter).length > 0 && { product: productFilter }),
    }

    const [total, items] = await Promise.all([
      prisma.inventory.count({ where }),
      prisma.inventory.findMany({
        where,
        orderBy: { quantity: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id:                  true,
          quantity:            true,
          low_stock_threshold: true,
          updated_at:          true,
          product: {
            select: {
              id:             true,
              name:           true,
              type:           true,
              is_active:      true,
              cost_price:     true,
              city_price:     true,
              branch_price:   true,
              reseller_price: true,
            },
          },
        },
      }),
    ])

    const [all, acquisitionMovements] = await Promise.all([
      prisma.inventory.findMany({
        where: { owner_id: user.id },
        select: {
          product_id: true,
          quantity:            true,
          low_stock_threshold: true,
          product: {
            select: { cost_price: true, city_price: true, branch_price: true, reseller_price: true },
          },
        },
      }),
      prisma.inventoryMovement.findMany({
        where: {
          recipient_id: user.id,
          OR: [
            { order_id: { not: null } },
            { received_at: { not: null } },
          ],
        },
        select: {
          product_id: true,
          quantity: true,
          accepted_quantity: true,
          order_id: true,
          unit_price: true,
        },
      }),
    ])

    const acquisitionByProduct = new Map<string, { units: number; cost: number }>()
    for (const movement of acquisitionMovements) {
      const receivedUnits = movement.order_id ? movement.quantity : (movement.accepted_quantity ?? 0)
      if (receivedUnits <= 0) continue
      const current = acquisitionByProduct.get(movement.product_id) || { units: 0, cost: 0 }
      current.units += receivedUnits
      current.cost += receivedUnits * Number(movement.unit_price)
      acquisitionByProduct.set(movement.product_id, current)
    }
    const historicalUnitCost = (productId: string, product: { cost_price: unknown; city_price: unknown; branch_price: unknown }) => {
      const snapshot = acquisitionByProduct.get(productId)
      return snapshot && snapshot.units > 0 ? snapshot.cost / snapshot.units : inventoryCost(product)
    }

    const deliveredOrders = canViewFinancials ? await prisma.order.findMany({
      where: {
        seller_id: user.id,
        status: 'delivered',
        ...(periodStart && { delivered_at: { gte: periodStart } }),
      },
      select: {
        items: {
          select: {
            quantity: true,
            subtotal: true,
            product:  { select: { id: true, name: true, type: true, cost_price: true, city_price: true, branch_price: true } },
          },
        },
      },
    }) : []

    const actualRevenue = deliveredOrders.reduce(
      (s, o) => s + o.items.reduce((ss, i) => ss + Number(i.subtotal), 0), 0
    )
    const actualCost = deliveredOrders.reduce(
      (s, o) => s + o.items.reduce((ss, i) => ss + inventoryCost(i.product) * i.quantity, 0), 0
    )

    // Build product sales map
    const salesMap = new Map<string, { name: string; type: string; units_sold: number; revenue: number; cost: number }>()
    for (const o of deliveredOrders) {
      for (const item of o.items) {
        const p = item.product
        if (!p?.id) continue
        const existing = salesMap.get(p.id) || { name: p.name, type: p.type, units_sold: 0, revenue: 0, cost: 0 }
        existing.units_sold += item.quantity
        existing.revenue    += Number(item.subtotal)
        existing.cost       += inventoryCost(p) * item.quantity
        salesMap.set(p.id, existing)
      }
    }
    const productSales = Array.from(salesMap.entries())
      .map(([product_id, data]) => ({ product_id, ...data, profit: data.revenue - data.cost }))
      .sort((a, b) => b.units_sold - a.units_sold)

    const totalCostValue = all.reduce((s, i) => s + historicalUnitCost(i.product_id, i.product) * i.quantity, 0)
    const totalSellingValue = all.reduce((s, i) => s + Number(i.product.reseller_price) * i.quantity, 0)
    const summary = {
      total_products: all.length,
      low_stock: all.filter((i) => i.quantity > 0 && i.quantity <= i.low_stock_threshold).length,
      out_of_stock: all.filter((i) => i.quantity === 0).length,
      total_units: all.reduce((s, i) => s + i.quantity, 0),
      ...(canViewFinancials && {
        total_cost_value: totalCostValue,
        total_selling_value: totalSellingValue,
        potential_profit: totalSellingValue - totalCostValue,
        actual_revenue: actualRevenue,
        actual_cost: actualCost,
        actual_profit: actualRevenue - actualCost,
      }),
    }

    const openShift = !canViewFinancials
      ? await prisma.posShift.findFirst({
          where: { owner_id: user.id, opened_by_id: actorId, status: 'open' },
          orderBy: { opened_at: 'desc' },
          select: { id: true, opening_cash: true, opened_at: true },
        })
      : null
    const shiftTransactions = openShift
      ? await prisma.posTransaction.findMany({
          where: { shift_id: openShift.id, status: { in: ['finalized', 'approved'] } },
          select: { total_snapshot: true, payment_method_snapshot: true, adjustment_requests: { where: { status: 'approved', request_type: 'refund' }, select: { amount_snapshot: true } } },
        })
      : []
    const netShiftAmount = (transaction: (typeof shiftTransactions)[number]) => Number(transaction.total_snapshot)
      - transaction.adjustment_requests.reduce((sum, request) => sum + Number(request.amount_snapshot), 0)
    const shiftSales = shiftTransactions.reduce((sum, transaction) => sum + netShiftAmount(transaction), 0)
    const shiftCashSales = shiftTransactions.reduce(
      (sum, transaction) => transaction.payment_method_snapshot.trim().toLowerCase() === 'cash'
        ? sum + netShiftAmount(transaction)
        : sum,
      0,
    )
    const cashierShiftSummary = {
      has_open_shift: Boolean(openShift),
      opened_at: openShift?.opened_at || null,
      transaction_count: shiftTransactions.length,
      sales_total: shiftSales,
      cash_sales: shiftCashSales,
      non_cash_sales: shiftSales - shiftCashSales,
    }

    return NextResponse.json({
      items: items.map((item) => ({
        ...item,
        product: {
          ...item.product,
          city_price: canViewFinancials ? inventoryCost(item.product) : null,
          cost_price: undefined,
          branch_price: undefined,
        },
      })),
      summary,
      productSales: canViewFinancials ? productSales : [],
      access: { can_view_financials: canViewFinancials },
      financial_period: canViewFinancials ? 'today' : null,
      cashier_shift_summary: canViewFinancials ? null : cashierShiftSummary,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[CITY INVENTORY ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH update stock threshold ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { inventory_id, low_stock_threshold } = await req.json()
    if (!inventory_id || low_stock_threshold == null) {
      return NextResponse.json({ error: 'Missing fields.' }, { status: 400 })
    }

    const parsedThreshold = Number(low_stock_threshold)
    if (!Number.isInteger(parsedThreshold) || parsedThreshold < 0) {
      return NextResponse.json({ error: 'Threshold must be a non-negative whole number.' }, { status: 400 })
    }

    const item = await prisma.inventory.findFirst({
      where: { id: inventory_id, owner_id: user.id },
      include: { product: { select: { name: true } } },
    })
    if (!item) return NextResponse.json({ error: 'Item not found.' }, { status: 404 })

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.inventory.update({
        where: { id: inventory_id },
        data: { low_stock_threshold: parsedThreshold },
      })
      if (item.low_stock_threshold !== parsedThreshold) {
        await tx.inventoryAuditEvent.create({
          data: {
            owner_id: user.id,
            product_id: item.product_id,
            event_type: 'low_stock_threshold_changed',
            quantity_delta: 0,
            quantity_before: item.quantity,
            quantity_after: item.quantity,
            actor_id: user.actor_id || user.id,
            actor_name_snapshot: user.actor_name || user.full_name || user.username,
            reference_type: 'inventory_threshold',
            reference_id: item.id,
            reason: `${item.product.name}: low-stock threshold changed from ${item.low_stock_threshold} to ${parsedThreshold}.`,
            metadata: { previous_threshold: item.low_stock_threshold, new_threshold: parsedThreshold },
          },
        })
      }
      return result
    })

    return NextResponse.json({ success: true, item: updated })
  } catch (error) {
    console.error('[CITY INVENTORY PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
