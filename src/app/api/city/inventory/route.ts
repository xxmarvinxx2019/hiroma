import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET city distributor's inventory with search & pagination ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const search   = searchParams.get('search') || ''
    const type     = searchParams.get('type') || 'all'
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const productFilter: Record<string, unknown> = {
      ...(type !== 'all' && { type }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    }

    const where: Record<string, unknown> = {
      owner_id: user.id,
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
              id:              true,
              name:            true,
              type:            true,
              is_active:       true,
              cost_price:      true,
              city_price:      true,
              reseller_price:  true,
            },
          },
        },
      }),
    ])

    // Summary — include financial data
    const all = await prisma.inventory.findMany({
      where: { owner_id: user.id },
      select: {
        quantity:            true,
        low_stock_threshold: true,
        product: {
          select: { city_price: true, reseller_price: true },
        },
      },
    })

    // Actual profit from delivered orders sold TO resellers
    // Cost for city dist = city_price (what they paid to supplier)
    // Revenue = what resellers paid them (order subtotal)
    const deliveredOrders = await prisma.order.findMany({
      where: { seller_id: user.id, status: 'delivered' },
      select: {
        items: {
          select: {
            quantity:   true,
            subtotal:   true,
            product:    { select: { city_price: true } },
          },
        },
      },
    })

    const actualRevenue = deliveredOrders.reduce(
      (s, o) => s + o.items.reduce((ss, i) => ss + Number(i.subtotal), 0), 0
    )
    const actualCost = deliveredOrders.reduce(
      (s, o) => s + o.items.reduce((ss, i) => ss + Number(i.product.city_price) * i.quantity, 0), 0
    )

    const summary = {
      total_products:    all.length,
      low_stock:         all.filter((i) => i.quantity > 0 && i.quantity <= i.low_stock_threshold).length,
      out_of_stock:      all.filter((i) => i.quantity === 0).length,
      total_units:       all.reduce((s, i) => s + i.quantity, 0),
      // Financial
      // City dist cost = city_price (what they pay), selling = reseller_price (what they sell for)
      total_cost_value:    all.reduce((s, i) => s + Number(i.product.city_price)     * i.quantity, 0),
      total_selling_value: all.reduce((s, i) => s + Number(i.product.reseller_price) * i.quantity, 0),
      potential_profit:    all.reduce((s, i) => s + (Number(i.product.reseller_price) - Number(i.product.city_price)) * i.quantity, 0),
      // Actual from delivered orders
      actual_revenue:  actualRevenue,
      actual_cost:     actualCost,
      actual_profit:   actualRevenue - actualCost,
    }

    // ── Product sales breakdown ──
    const soldItems = await prisma.orderItem.findMany({
      where: {
        order: { seller_id: user.id, status: 'delivered' },
      },
      select: {
        quantity:   true,
        unit_price: true,
        subtotal:   true,
        product:    { select: { id: true, name: true, type: true, city_price: true } },
      },
    })

    // Group by product
    const salesMap = new Map<string, {
      name: string; type: string; units_sold: number; revenue: number; cost: number
    }>()

    for (const item of soldItems) {
      const existing = salesMap.get(item.product.id) || {
        name:       item.product.name,
        type:       item.product.type,
        units_sold: 0,
        revenue:    0,
        cost:       0,
      }
      existing.units_sold += item.quantity
      existing.revenue    += Number(item.subtotal)
      existing.cost       += Number(item.product.city_price) * item.quantity
      salesMap.set(item.product.id, existing)
    }

    const productSales = Array.from(salesMap.entries())
      .map(([product_id, data]) => ({
        product_id,
        ...data,
        profit: data.revenue - data.cost,
      }))
      .sort((a, b) => b.units_sold - a.units_sold)

    return NextResponse.json({
      items,
      summary,
      productSales,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    console.error('[CITY INVENTORY ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH update stock threshold for an inventory item ──
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

    // Make sure it belongs to this city distributor
    const item = await prisma.inventory.findFirst({
      where: { id: inventory_id, owner_id: user.id },
    })
    if (!item) {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 })
    }

    const updated = await prisma.inventory.update({
      where: { id: inventory_id },
      data:  { low_stock_threshold: Math.max(0, parseInt(low_stock_threshold)) },
    })

    return NextResponse.json({ success: true, item: updated })
  } catch (error) {
    console.error('[CITY INVENTORY PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}