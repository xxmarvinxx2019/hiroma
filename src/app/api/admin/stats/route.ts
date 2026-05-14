import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
      totalResellers,
      totalDistributors,
      pendingPayouts,
      pendingPayoutsAmount,
      pinsSoldToday,
      newResellersToday,
      totalProducts,
      activePins,
      totalPinRevenue,
      totalPinsSold,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'reseller' } }),
      prisma.user.count({
        where: { role: { in: ['regional', 'provincial', 'city'] } },
      }),
      prisma.payout.count({ where: { status: 'pending' } }),
      prisma.payout.aggregate({
        where: { status: 'pending' },
        _sum: { amount: true },
      }),
      prisma.pin.count({
        where: { status: 'used', used_at: { gte: today } },
      }),
      prisma.user.count({
        where: { role: 'reseller', created_at: { gte: today } },
      }),
      prisma.product.count({ where: { is_active: true } }),
      prisma.pin.count({ where: { status: 'unused' } }),
      // Total PIN revenue from orders
      prisma.order.aggregate({
        where: { notes: { contains: 'PIN sale' } },
        _sum: { total_amount: true },
      }),
      // Total PINs ever generated
      prisma.pin.count(),
    ])

    // ── Product sales & cost data ──
    // Total units sold across all delivered orders
    const productSalesData = await prisma.orderItem.aggregate({
      where: { order: { status: 'delivered' } },
      _sum:  { quantity: true, subtotal: true },
    })

    // Total cost of products sold
    // Join order items with product cost_price
    const soldItems = await prisma.orderItem.findMany({
      where: { order: { status: 'delivered' } },
      select: {
        quantity: true,
        product:  { select: { cost_price: true } },
      },
    })

    const totalCost = soldItems.reduce(
      (sum, item) => sum + Number(item.product.cost_price) * item.quantity,
      0
    )

    const totalRevenue  = Number(productSalesData._sum.subtotal  || 0)
    const totalUnitsSold = Number(productSalesData._sum.quantity || 0)
    const grossProfit    = totalRevenue - totalCost

    // Top selling products
    const topProducts = await prisma.orderItem.groupBy({
      by:      ['product_id'],
      where:   { order: { status: 'delivered' } },
      _sum:    { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    })

    const topProductIds = topProducts.map((p) => p.product_id)
    const topProductDetails = await prisma.product.findMany({
      where:  { id: { in: topProductIds } },
      select: { id: true, name: true, cost_price: true },
    })
    const productMap = new Map(topProductDetails.map((p) => [p.id, p]))

    const topProductsFormatted = topProducts.map((p) => {
      const product   = productMap.get(p.product_id)
      const revenue   = Number(p._sum.subtotal  || 0)
      const cost      = Number(product?.cost_price || 0) * Number(p._sum.quantity || 0)
      return {
        product_id:   p.product_id,
        name:         product?.name || '—',
        units_sold:   Number(p._sum.quantity || 0),
        revenue,
        cost,
        profit:       revenue - cost,
      }
    })

    // PIN revenue today
    const pinRevenueToday = await prisma.order.aggregate({
      where: {
        notes: { contains: 'PIN sale' },
        created_at: { gte: today },
      },
      _sum: { total_amount: true },
    })

    return NextResponse.json({
      stats: {
        totalResellers,
        totalDistributors,
        pendingPayouts,
        pendingPayoutsAmount: Number(pendingPayoutsAmount._sum.amount || 0),
        pinsSoldToday,
        newResellersToday,
        totalProducts,
        activePins,
        totalPinRevenue: Number(totalPinRevenue._sum.total_amount || 0),
        totalPinRevenueToday: Number(pinRevenueToday._sum.total_amount || 0),
        totalPinsSold,
        // Product sales & profitability
        totalUnitsSold,
        totalRevenue,
        totalCost,
        grossProfit,
        topProducts: topProductsFormatted,
      },
    })
  } catch (error) {
    console.error('[ADMIN STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}