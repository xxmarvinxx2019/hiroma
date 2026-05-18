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
      prisma.user.count({ where: { role: { in: ['regional', 'provincial', 'city'] } } }),
      prisma.payout.count({ where: { status: 'pending' } }),
      prisma.payout.aggregate({ where: { status: 'pending' }, _sum: { amount: true } }),
      prisma.pin.count({ where: { status: 'used', used_at: { gte: today } } }),
      prisma.user.count({ where: { role: 'reseller', created_at: { gte: today } } }),
      prisma.product.count({ where: { is_active: true } }),
      prisma.pin.count({ where: { status: 'unused' } }),
      prisma.order.aggregate({
        where: { notes: { contains: 'PIN sale' } },
        _sum:  { total_amount: true },
      }),
      prisma.pin.count(),
    ])

    // ── Product sales & cost data ──
    const productSalesData = await prisma.orderItem.aggregate({
      where: { order: { status: 'delivered' } },
      _sum:  { quantity: true, subtotal: true },
    })

    const soldItems = await prisma.orderItem.findMany({
      where:  { order: { status: 'delivered' } },
      select: { quantity: true, product: { select: { cost_price: true } } },
    })

    const totalCost      = soldItems.reduce((sum, item) => sum + Number(item.product.cost_price) * item.quantity, 0)
    const totalRevenue   = Number(productSalesData._sum.subtotal  || 0)
    const totalUnitsSold = Number(productSalesData._sum.quantity  || 0)
    const grossProfit    = totalRevenue - totalCost

    // ── Top selling products ──
    const topProducts = await prisma.orderItem.groupBy({
      by:      ['product_id'],
      where:   { order: { status: 'delivered' } },
      _sum:    { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    })

    const topProductIds     = topProducts.map((p) => p.product_id)
    const topProductDetails = await prisma.product.findMany({
      where:  { id: { in: topProductIds } },
      select: { id: true, name: true, cost_price: true },
    })
    const productMap = new Map(topProductDetails.map((p) => [p.id, p]))

    const topProductsFormatted = topProducts.map((p) => {
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

    // ── PIN revenue today ──
    const pinRevenueToday = await prisma.order.aggregate({
      where: { notes: { contains: 'PIN sale' }, created_at: { gte: today } },
      _sum:  { total_amount: true },
    })

    // ── Admin stock assignment revenue covers BOTH products AND PINs ──
    // PINs are assigned to city distributors as part of stock assignments
    // So adminSalesRevenue already includes PIN revenue — no separate calculation needed
    const adminUser = await prisma.user.findFirst({
      where:  { role: 'admin' },
      select: { id: true },
    })

    let adminSalesRevenue = 0
    let adminSalesCost    = 0

    if (adminUser) {
      const adminOrders = await prisma.order.findMany({
        where:  { seller_id: adminUser.id, status: 'delivered' },
        select: {
          items: {
            select: {
              quantity: true,
              subtotal: true,
              product:  { select: { cost_price: true } },
            },
          },
        },
      })
      adminSalesRevenue = adminOrders.reduce(
        (s, o) => s + o.items.reduce((ss, i) => ss + Number(i.subtotal), 0), 0
      )
      adminSalesCost = adminOrders.reduce(
        (s, o) => s + o.items.reduce((ss, i) => ss + Number(i.product.cost_price) * i.quantity, 0), 0
      )
    }

    const productNetProfit = adminSalesRevenue - adminSalesCost
    const adminSalesProfit = productNetProfit

    // ── Chain revenue = all delivered orders across all levels ──
    const chainRevenueAgg = await prisma.order.aggregate({
      where: { status: 'delivered' },
      _sum:  { total_amount: true },
    })
    const chainRevenue = Number(chainRevenueAgg._sum.total_amount || 0)

    // ── Overall Profit = admin revenue minus production cost ──
    // PIN + Product assignments are all in adminSalesRevenue
    const overallNetProfit = productNetProfit
    const totalPinSalesRevenue = 0 // included in adminSalesRevenue

    return NextResponse.json({
      stats: {
        totalResellers,
        totalDistributors,
        pendingPayouts,
        pendingPayoutsAmount:    Number(pendingPayoutsAmount._sum.amount || 0),
        pinsSoldToday,
        newResellersToday,
        totalProducts,
        activePins,
        totalPinRevenue:         Number(totalPinRevenue._sum.total_amount || 0),
        totalPinRevenueToday:    Number(pinRevenueToday._sum.total_amount || 0),
        totalPinsSold,
        // Product sales & profitability
        totalUnitsSold,
        totalRevenue,
        totalCost,
        grossProfit,
        topProducts: topProductsFormatted,
        // Overall profit summary
        adminSalesRevenue,
        adminSalesCost,
        adminSalesProfit,
        productNetProfit,
        totalPinSalesRevenue,
        overallNetProfit,
        chainRevenue,
      },
    })
  } catch (error) {
    console.error('[ADMIN STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}