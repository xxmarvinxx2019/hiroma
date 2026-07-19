import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now        = new Date()
    const today      = new Date(); today.setHours(0, 0, 0, 0)
    const yesterday  = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // ── Get admin user first ──
    const adminUser = await prisma.user.findFirst({
      where:  { role: 'admin' },
      select: { id: true },
    })

    const [
      totalResellers,
      totalDistributors,
      pendingPayouts,
      pendingPayoutsAgg,
      newResellersToday,
      newResellersYesterday,
      totalProducts,
      activePins,
      totalPinsSold,
      recentOrders,
      ordersByStatus,
      newResellersThisMonth,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'reseller' } }),
      prisma.distributorProfile.count({ where: { is_active: true } }),
      prisma.payout.count({ where: { status: 'pending' } }),
      prisma.payout.aggregate({ where: { status: 'pending' }, _sum: { amount: true } }),
      prisma.user.count({ where: { role: 'reseller', created_at: { gte: today } } }),
      prisma.user.count({ where: { role: 'reseller', created_at: { gte: yesterday, lt: today } } }),
      prisma.product.count({ where: { is_active: true } }),
      prisma.pin.count({ where: { status: 'unused' } }),
      prisma.pin.count({ where: { status: { in: ['unused', 'used', 'expired'] } } }),
      prisma.order.findMany({
        where:   { status: { not: 'cancelled' } },
        orderBy: { created_at: 'desc' },
        take:    3,
        select:  {
          id: true, order_number: true, status: true,
          total_amount: true, created_at: true,
          buyer:  { select: { full_name: true, role: true } },
          seller: { select: { full_name: true } },
        },
      }),
      adminUser ? prisma.order.groupBy({
        by:    ['status'],
        where: { seller_id: adminUser.id },
        _count: { status: true },
      }) : Promise.resolve([]),
      prisma.user.count({ where: { role: 'reseller', created_at: { gte: monthStart } } }),
    ])

    // ── Today's PIN revenue ──
    const todayPins = await prisma.pin.findMany({
      where:  { status: { not: 'unused' }, created_at: { gte: today } },
      select: { package: { select: { price: true } } },
    })
    const yesterdayPins = await prisma.pin.findMany({
      where:  { status: { not: 'unused' }, created_at: { gte: yesterday, lt: today } },
      select: { package: { select: { price: true } } },
    })
    const pinRevenueToday     = todayPins.reduce((s, p) => s + Number(p.package?.price || 0), 0)
    const pinRevenueYesterday = yesterdayPins.reduce((s, p) => s + Number(p.package?.price || 0), 0)

    // ── Today's product revenue ──
    let orderRevenueToday     = 0
    let orderRevenueYesterday = 0
    let totalUnitsSoldToday   = 0
    let orderCostToday        = 0

    if (adminUser) {
      const todayItems = await prisma.orderItem.findMany({
        where:  { order: { seller_id: adminUser.id, status: 'delivered', updated_at: { gte: today } } },
        select: { quantity: true, subtotal: true, product: { select: { cost_price: true } } },
      })
      const yesterdayItems = await prisma.orderItem.findMany({
        where:  { order: { seller_id: adminUser.id, status: 'delivered', updated_at: { gte: yesterday, lt: today } } },
        select: { quantity: true, subtotal: true },
      })
      orderRevenueToday     = todayItems.reduce((s, i) => s + Number(i.subtotal || 0), 0)
      orderCostToday        = todayItems.reduce((s, i) => s + Number(i.product?.cost_price || 0) * i.quantity, 0)
      totalUnitsSoldToday   = todayItems.reduce((s, i) => s + i.quantity, 0)
      orderRevenueYesterday = yesterdayItems.reduce((s, i) => s + Number(i.subtotal || 0), 0)
    }

    const totalRevenueToday     = pinRevenueToday     + orderRevenueToday
    const totalRevenueYesterday = pinRevenueYesterday + orderRevenueYesterday
    const netProfitToday        = pinRevenueToday     + (orderRevenueToday - orderCostToday)

    // ── All-time revenue ──
    const allPins = await prisma.pin.findMany({
      where:  { status: { not: 'unused' } },
      select: { package: { select: { price: true } } },
    })
    const pinRevenue = allPins.reduce((s, p) => s + Number(p.package?.price || 0), 0)

    let orderRevenue   = 0
    let orderCost      = 0
    let totalUnitsSold = 0
    if (adminUser) {
      const items = await prisma.orderItem.findMany({
        where:  { order: { seller_id: adminUser.id, status: 'delivered' } },
        select: { quantity: true, subtotal: true, product: { select: { cost_price: true } } },
      })
      orderRevenue   = items.reduce((s, i) => s + Number(i.subtotal || 0), 0)
      orderCost      = items.reduce((s, i) => s + Number(i.product?.cost_price || 0) * i.quantity, 0)
      totalUnitsSold = items.reduce((s, i) => s + i.quantity, 0)
    }

    const orderProfit      = orderRevenue - orderCost
    const totalRevenue     = pinRevenue   + orderRevenue
    const overallNetProfit = pinRevenue   + orderProfit

    const chainOrders  = await prisma.order.aggregate({ where: { status: 'delivered' }, _sum: { total_amount: true } })
    const chainRevenue = Number(chainOrders._sum.total_amount || 0)

    // ── Top products ──
    const topProductsRaw = await prisma.orderItem.groupBy({
      by:      ['product_id'],
      _sum:    { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take:    5,
    })
    const productNames = await prisma.product.findMany({
      where:  { id: { in: topProductsRaw.map(p => p.product_id) } },
      select: { id: true, name: true },
    })
    const nameMap    = new Map(productNames.map(p => [p.id, p.name]))
    const topProducts = topProductsRaw.map(p => ({
      name:       nameMap.get(p.product_id) || 'Unknown',
      total_sold: p._sum.quantity || 0,
      revenue:    Number(p._sum.subtotal || 0),
    }))

    // ── Monthly revenue (last 12 months) ──
    const monthlyRevenue: { month: string; revenue: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const d     = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
      const label = d.toLocaleDateString('en-PH', { month: 'short' })

      const mPins = await prisma.pin.findMany({
        where:  { created_at: { gte: start, lte: end }, status: { not: 'unused' } },
        select: { package: { select: { price: true } } },
      })
      const pinMonthRev = mPins.reduce((s, p) => s + Number(p.package?.price || 0), 0)

      let orderMonthRev = 0
      if (adminUser) {
        const mOrders = await prisma.order.aggregate({
          where: { seller_id: adminUser.id, status: 'delivered', updated_at: { gte: start, lte: end } },
          _sum:  { total_amount: true },
        })
        orderMonthRev = Number(mOrders._sum.total_amount || 0)
      }
      monthlyRevenue.push({ month: label, revenue: pinMonthRev + orderMonthRev })
    }

    // ── Growth vs last month ──
    const lastMonthStart   = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd     = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    const thisMonthStart2  = new Date(now.getFullYear(), now.getMonth(), 1)
    const lastMonthPins    = await prisma.pin.findMany({
      where:  { created_at: { gte: lastMonthStart, lte: lastMonthEnd }, status: { not: 'unused' } },
      select: { package: { select: { price: true } } },
    })
    const thisMonthPins    = await prisma.pin.findMany({
      where:  { created_at: { gte: thisMonthStart2 }, status: { not: 'unused' } },
      select: { package: { select: { price: true } } },
    })
    const lastMonthRevenue = lastMonthPins.reduce((s, p) => s + Number(p.package?.price || 0), 0)
    const thisMonthRevenue = thisMonthPins.reduce((s, p) => s + Number(p.package?.price || 0), 0)
    const growthPct        = lastMonthRevenue > 0
      ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : 0

    // ── Warehouse / inventory ──
    const inventoryItems = await prisma.inventory.findMany({
      where:  adminUser ? { owner_id: adminUser.id } : {},
      select: { quantity: true, low_stock_threshold: true },
    })
    const totalStock  = inventoryItems.reduce((s, i) => s + i.quantity, 0)
    const criticalStock = inventoryItems.filter(i => i.quantity <= i.low_stock_threshold).length

    // ── Regional sales ──
    const regionalSales = await prisma.$queryRaw<{ region_name: string; total: number; count: number }[]>`
      SELECT dp.region_name,
        COUNT(DISTINCT dp.user_id)::int as count,
        COALESCE(SUM(o.total_amount), 0)::float as total
      FROM distributor_profiles dp
      LEFT JOIN orders o ON o.seller_id::text = dp.user_id::text AND o.status = 'delivered'
      WHERE dp.region_name IS NOT NULL AND dp.dist_level = 'regional'
      GROUP BY dp.region_name ORDER BY total DESC LIMIT 10
    `
    const provinceSales = await prisma.$queryRaw<{ province_name: string; total: number; count: number }[]>`
      SELECT dp.province_name,
        COUNT(DISTINCT dp.user_id)::int as count,
        COALESCE(SUM(o.total_amount), 0)::float as total
      FROM distributor_profiles dp
      LEFT JOIN orders o ON o.seller_id::text = dp.user_id::text AND o.status = 'delivered'
      WHERE dp.province_name IS NOT NULL AND dp.dist_level = 'provincial'
      GROUP BY dp.province_name ORDER BY total DESC LIMIT 10
    `
    const citySales = await prisma.$queryRaw<{ city_muni_name: string; total: number; count: number }[]>`
      SELECT dp.city_muni_name,
        COUNT(DISTINCT dp.user_id)::int as count,
        COALESCE(SUM(o.total_amount), 0)::float as total
      FROM distributor_profiles dp
      LEFT JOIN orders o ON o.seller_id::text = dp.user_id::text AND o.status = 'delivered'
      WHERE dp.city_muni_name IS NOT NULL AND dp.dist_level = 'city'
      GROUP BY dp.city_muni_name ORDER BY total DESC LIMIT 10
    `

    return NextResponse.json({
      stats: {
        totalRevenueToday,
        totalRevenueYesterday,
        netProfitToday,
        pinRevenueToday,
        orderRevenueToday,
        totalUnitsSoldToday,
        newResellersToday,
        newResellersYesterday,
        newResellersThisMonth,
        totalResellers,
        totalDistributors,
        pendingPayouts,
        pendingPayoutsAmount: Number(pendingPayoutsAgg._sum.amount || 0),
        totalProducts,
        activePins,
        totalPinsSold,
        pinRevenue,
        orderRevenue,
        orderCost,
        orderProfit,
        totalRevenue,
        overallNetProfit,
        chainRevenue,
        totalUnitsSold,
        topProducts,
        recentOrders,
        ordersByStatus,
        monthlyRevenue,
        lastMonthRevenue,
        thisMonthRevenue,
        growthPct,
        totalStock,
        criticalStock,
        regionalSales,
        provinceSales,
        citySales,
        // backwards compat
        pinsSoldToday:        todayPins.length,
        adminSalesRevenue:    totalRevenue,
        adminSalesCost:       orderCost,
        adminSalesProfit:     overallNetProfit,
        grossProfit:          overallNetProfit,
      },
    })
  } catch (error) {
    console.error('[ADMIN STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}