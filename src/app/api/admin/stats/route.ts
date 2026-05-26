import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [
      totalResellers, totalDistributors,
      pendingPayouts, pendingPayoutsAmount,
      pinsSoldToday, newResellersToday,
      totalProducts, activePins, totalPinsSold,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'reseller' } }),
      prisma.distributorProfile.count({ where: { is_active: true } }),
      prisma.payout.count({ where: { status: 'pending' } }),
      prisma.payout.aggregate({ where: { status: 'pending' }, _sum: { amount: true } }),
      prisma.pin.count({ where: { status: { in: ['unused', 'used', 'expired'] }, created_at: { gte: today } } }),
      prisma.user.count({ where: { role: 'reseller', created_at: { gte: today } } }),
      prisma.product.count({ where: { is_active: true } }),
      prisma.pin.count({ where: { status: 'unused' } }),
      prisma.pin.count({ where: { status: { in: ['unused', 'used', 'expired'] } } }),
    ])

    // ── PIN sales revenue ──
    // ALL assigned PINs = sold (regardless of used/unused/expired)
    // Revenue = package price × all assigned PINs
    const allPins = await prisma.pin.findMany({
      where:  { status: { in: ['unused', 'used', 'expired'] } },
      select: {
        created_at: true,
        package: { select: { price: true } },
      },
    })

    let pinRevenue      = 0
    let pinRevenueToday = 0
    const pinCost       = 0  // PIN itself has no production cost — pure revenue

    for (const pin of allPins) {
      if (!pin.package) continue
      const amt = Number(pin.package.price || 0)
      pinRevenue += amt
      if (pin.created_at && new Date(pin.created_at) >= today) {
        pinRevenueToday += amt
      }
    }

    // ── Product order sales (admin as seller, delivered) ──
    const adminUser = await prisma.user.findFirst({
      where:  { role: 'admin', username: { not: 'hiroma' } },
      select: { id: true },
    })

    let orderRevenue = 0
    let orderCost    = 0
    let totalUnitsSold = 0

    if (adminUser) {
      const adminOrderItems = await prisma.orderItem.findMany({
        where:  { order: { seller_id: adminUser.id, status: 'delivered' } },
        select: { quantity: true, subtotal: true, product: { select: { cost_price: true } } },
      })
      orderRevenue   = adminOrderItems.reduce((s, i) => s + Number(i.subtotal || 0), 0)
      orderCost      = adminOrderItems.reduce((s, i) => s + Number(i.product.cost_price || 0) * i.quantity, 0)
      totalUnitsSold = adminOrderItems.reduce((s, i) => s + i.quantity, 0)
    }

    // ── Overall Net Profit = PIN profit + order profit ──
    const pinProfit        = pinRevenue              // 100% margin — PIN has no cost
    const orderProfit      = orderRevenue - orderCost  // direct order profit
    const totalRevenue     = pinRevenue   + orderRevenue
    const totalCost        = orderCost                 // only order items have cost
    const overallNetProfit = pinProfit    + orderProfit

    // ── Chain revenue = all delivered orders across all levels ──
    const chainRevenueAgg = await prisma.order.aggregate({
      where: { status: 'delivered' },
      _sum:  { total_amount: true },
    })
    const chainRevenue = Number(chainRevenueAgg._sum.total_amount || 0)

    // ── Top selling products ──
    const topProductsRaw = await prisma.orderItem.groupBy({
      by:      ['product_id'],
      where:   { order: { status: 'delivered' } },
      _sum:    { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    })

    const topProductDetails = await prisma.product.findMany({
      where:  { id: { in: topProductsRaw.map((p) => p.product_id) } },
      select: { id: true, name: true, cost_price: true },
    })
    const productMap = new Map(topProductDetails.map((p) => [p.id, p]))

    const topProducts = topProductsRaw.map((p) => {
      const product = productMap.get(p.product_id)
      const revenue = Number(p._sum.subtotal  || 0)
      const cost    = Number(product?.cost_price || 0) * Number(p._sum.quantity || 0)
      return {
        product_id: p.product_id,
        name:       product?.name || '—',
        units_sold: Number(p._sum.quantity || 0),
        revenue,
        cost,
        profit: revenue - cost,
      }
    })

    return NextResponse.json({
      stats: {
        totalResellers,
        totalDistributors,
        pendingPayouts,
        pendingPayoutsAmount:  Number(pendingPayoutsAmount._sum.amount || 0),
        pinsSoldToday,
        newResellersToday,
        totalProducts,
        activePins,
        totalPinRevenue:       pinRevenueToday,  // today only — shown on dashboard card
        totalPinsSold,
        totalUnitsSold,
        totalRevenue,
        totalCost,
        grossProfit:           overallNetProfit,
        topProducts,
        adminSalesRevenue:     totalRevenue,
        adminSalesCost:        totalCost,
        adminSalesProfit:      overallNetProfit,
        productNetProfit:      orderProfit,
        totalPinSalesRevenue:  pinRevenue,
        pinRevenue,
        pinCost,
        pinProfit,
        orderRevenue,
        orderCost,
        orderProfit,
        overallNetProfit,
        chainRevenue,
      },
    })
  } catch (error) {
    console.error('[ADMIN STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}