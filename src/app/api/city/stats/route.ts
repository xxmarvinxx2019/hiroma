import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [
      totalResellers,
      activeResellers,
      unusedPins,
      usedPins,
      totalOrders,
      pendingOrders,
      inventory,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'reseller', created_by: user.id } }),
      prisma.user.count({ where: { role: 'reseller', created_by: user.id, status: 'active' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'unused' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'used' } }),
      prisma.order.count({ where: { buyer_id: user.id } }),
      prisma.order.count({ where: { buyer_id: user.id, status: 'pending' } }),
      prisma.inventory.findMany({
        where: { owner_id: user.id },
        select: { quantity: true, low_stock_threshold: true },
      }),
    ])

    const lowStockItems = inventory.filter(
      (i) => i.quantity <= i.low_stock_threshold
    ).length

    // ── Sales summary ──
    const deliveredSales = await prisma.order.findMany({
      where: { seller_id: user.id, status: 'delivered' },
      select: {
        items: {
          select: {
            quantity: true, subtotal: true,
            product: { select: { city_price: true } },
          },
        },
      },
    })

    const totalRevenue   = deliveredSales.reduce((s, o) => s + o.items.reduce((ss, i) => ss + Number(i.subtotal), 0), 0)
    const totalCost      = deliveredSales.reduce((s, o) => s + o.items.reduce((ss, i) => ss + Number(i.product.city_price) * i.quantity, 0), 0)
    const totalProfit    = totalRevenue - totalCost
    const totalUnitsSold = deliveredSales.reduce((s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0)

    return NextResponse.json({
      stats: {
        totalResellers,
        activeResellers,
        unusedPins,
        usedPins,
        totalOrders,
        pendingOrders,
        lowStockItems,
        totalInventoryItems: inventory.length,
        totalRevenue,
        totalCost,
        totalProfit,
        totalUnitsSold,
      },
    })
  } catch (error) {
    console.error('[CITY STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}