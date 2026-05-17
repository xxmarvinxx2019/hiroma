import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const days = Math.min(90, Math.max(7, parseInt(searchParams.get('days') || '30')))

    const since = new Date()
    since.setDate(since.getDate() - days)
    since.setHours(0, 0, 0, 0)

    const [
      // Network
      totalResellers,
      activeResellers,
      suspendedResellers,
      regionalCount,
      provincialCount,
      cityCount,

      // Financial — wallets
      walletStats,
      pendingPayouts,
      pendingPayoutsAmount,
      commissionsPaid,

      // MLM commissions
      totalCommissions,
      directReferralCount,
      binaryPairingCount,
      multilevelCount,
      sponsorPointCount,
      totalPointsEarned,
      totalOverflowCount,

      // Catalog
      totalProducts,
      physicalProducts,
      digitalProducts,
      totalPackages,
      totalPinsGenerated,
      unusedPins,
      usedPins,

      // Sales — admin to distributors (stock assignments)
      adminSalesAll,
      adminSalesPeriod,

      // Sales — all chain delivered orders
      allDeliveredOrders,

      // Daily sold items (last N days)
      dailyOrders,

      // Top products sold
      topProductItems,

      // Per distributor level revenue
      regionalSales,
      provincialSales,
      citySales,

    ] = await Promise.all([
      // Network
      prisma.user.count({ where: { role: 'reseller' } }),
      prisma.user.count({ where: { role: 'reseller', status: 'active' } }),
      prisma.user.count({ where: { role: 'reseller', status: 'suspended' } }),
      prisma.user.count({ where: { role: 'regional' } }),
      prisma.user.count({ where: { role: 'provincial' } }),
      prisma.user.count({ where: { role: 'city' } }),

      // Wallets
      prisma.wallet.aggregate({
        _sum: { balance: true, total_earned: true, total_withdrawn: true },
      }),
      prisma.payout.count({ where: { status: 'pending' } }),
      prisma.payout.aggregate({
        where: { status: 'pending' },
        _sum:  { amount: true },
      }),
      prisma.commission.aggregate({ _sum: { amount: true } }),

      // MLM
      prisma.commission.count(),
      prisma.commission.count({ where: { type: 'direct_referral' } }),
      prisma.commission.count({ where: { type: 'binary_pairing' } }),
      prisma.commission.count({ where: { type: 'multilevel' } }),
      prisma.commission.count({ where: { type: 'sponsor_point' } }),
      prisma.commission.aggregate({ _sum: { points: true } }),
      prisma.commission.count({ where: { is_pair_overflow: true } }),

      // Catalog
      prisma.product.count({ where: { is_active: true } }),
      prisma.product.count({ where: { is_active: true, type: 'physical' } }),
      prisma.product.count({ where: { is_active: true, type: 'digital' } }),
      prisma.package.count({ where: { is_active: true } }),
      prisma.pin.count(),
      prisma.pin.count({ where: { status: 'unused' } }),
      prisma.pin.count({ where: { status: 'used' } }),

      // Admin sales — all time
      prisma.order.aggregate({
        where: { seller_id: user.id, status: 'delivered' },
        _sum:  { total_amount: true },
        _count: { id: true },
      }),

      // Admin sales — within period
      prisma.order.aggregate({
        where: { seller_id: user.id, status: 'delivered', created_at: { gte: since } },
        _sum:  { total_amount: true },
        _count: { id: true },
      }),

      // All delivered orders across the whole chain
      prisma.order.aggregate({
        where: { status: 'delivered' },
        _sum:  { total_amount: true },
        _count: { id: true },
      }),

      // Daily orders for chart (within period)
      prisma.order.findMany({
        where:  { status: 'delivered', created_at: { gte: since } },
        select: { created_at: true, total_amount: true },
        orderBy: { created_at: 'asc' },
      }),

      // Top products
      prisma.orderItem.groupBy({
        by:    ['product_id'],
        where: { order: { status: 'delivered', created_at: { gte: since } } },
        _sum:  { quantity: true, subtotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      }),

      // Revenue per distributor level — regional as buyer
      prisma.order.aggregate({
        where: {
          status:   'delivered',
          buyer:    { role: 'regional' },
          created_at: { gte: since },
        },
        _sum:   { total_amount: true },
        _count: { id: true },
      }),

      // Provincial as buyer
      prisma.order.aggregate({
        where: {
          status:   'delivered',
          buyer:    { role: 'provincial' },
          created_at: { gte: since },
        },
        _sum:   { total_amount: true },
        _count: { id: true },
      }),

      // City as buyer
      prisma.order.aggregate({
        where: {
          status:   'delivered',
          buyer:    { role: 'city' },
          created_at: { gte: since },
        },
        _sum:   { total_amount: true },
        _count: { id: true },
      }),
    ])

    // ── Build daily sales chart data ──
    const dailyMap = new Map<string, { date: string; orders: number; revenue: number; units: number }>()

    // Initialize all days in range
    for (let i = 0; i < days; i++) {
      const d = new Date(since)
      d.setDate(d.getDate() + i)
      const key = d.toISOString().split('T')[0]
      dailyMap.set(key, { date: key, orders: 0, revenue: 0, units: 0 })
    }

    for (const order of dailyOrders) {
      const key = new Date(order.created_at).toISOString().split('T')[0]
      const existing = dailyMap.get(key)
      if (existing) {
        existing.orders  += 1
        existing.revenue += Number(order.total_amount)
      }
    }

    // ── Top products with names ──
    const topProductIds = topProductItems.map((p) => p.product_id)
    const topProductNames = await prisma.product.findMany({
      where:  { id: { in: topProductIds } },
      select: { id: true, name: true, type: true, cost_price: true },
    })
    const productNameMap = new Map(topProductNames.map((p) => [p.id, p]))

    const topProducts = topProductItems.map((item) => {
      const product = productNameMap.get(item.product_id)
      return {
        product_id:  item.product_id,
        name:        product?.name || 'Unknown',
        type:        product?.type || 'physical',
        units_sold:  Number(item._sum.quantity || 0),
        revenue:     Number(item._sum.subtotal  || 0),
      }
    })

    // ── Cost of goods sold (using cost_price) ──
    const allSoldItems = await prisma.orderItem.findMany({
      where: { order: { status: 'delivered', seller_id: user.id } },
      select: {
        quantity: true,
        subtotal: true,
        product:  { select: { cost_price: true } },
      },
    })

    const totalAdminRevenue = Number(adminSalesAll._sum.total_amount || 0)
    const totalAdminCost    = allSoldItems.reduce(
      (s, i) => s + Number(i.product.cost_price) * i.quantity, 0
    )
    const totalAdminProfit  = totalAdminRevenue - totalAdminCost
    const totalUnitsSold    = allSoldItems.reduce((s, i) => s + i.quantity, 0)

    return NextResponse.json({
      report: {
        period: { days, since: since.toISOString() },

        network: {
          totalResellers,
          activeResellers,
          suspendedResellers,
          totalDistributors: regionalCount + provincialCount + cityCount,
          regionalCount,
          provincialCount,
          cityCount,
        },

        financial: {
          totalWalletBalance:   Number(walletStats._sum.balance       || 0),
          totalEarned:          Number(walletStats._sum.total_earned   || 0),
          totalWithdrawn:       Number(walletStats._sum.total_withdrawn || 0),
          totalPendingPayouts:  pendingPayouts,
          totalPendingAmount:   Number(pendingPayoutsAmount._sum.amount || 0),
          totalCommissionsPaid: Number(commissionsPaid._sum.amount || 0),
        },

        sales: {
          // Admin's direct sales (stock assignments)
          adminRevenue:       totalAdminRevenue,
          adminCost:          totalAdminCost,
          adminProfit:        totalAdminProfit,
          adminOrders:        Number(adminSalesAll._count.id || 0),
          adminUnitsSold:     totalUnitsSold,
          // Period
          periodRevenue:      Number(adminSalesPeriod._sum.total_amount || 0),
          periodOrders:       Number(adminSalesPeriod._count.id || 0),
          // Whole chain
          chainRevenue:       Number(allDeliveredOrders._sum.total_amount || 0),
          chainOrders:        Number(allDeliveredOrders._count.id || 0),
          // Per level (period)
          regionalRevenue:    Number(regionalSales._sum.total_amount   || 0),
          regionalOrders:     Number(regionalSales._count.id           || 0),
          provincialRevenue:  Number(provincialSales._sum.total_amount || 0),
          provincialOrders:   Number(provincialSales._count.id         || 0),
          cityRevenue:        Number(citySales._sum.total_amount       || 0),
          cityOrders:         Number(citySales._count.id               || 0),
        },

        mlm: {
          totalCommissions,
          directReferralCount,
          binaryPairingCount,
          multilevelCount,
          sponsorPointCount,
          totalPointsEarned: Number(totalPointsEarned._sum.points || 0),
          totalOverflowCount,
        },

        catalog: {
          totalProducts,
          physicalProducts,
          digitalProducts,
          totalPackages,
          totalPinsGenerated,
          unusedPins,
          usedPins,
        },

        charts: {
          dailySales: Array.from(dailyMap.values()),
          topProducts,
        },
      },
    })
  } catch (error) {
    console.error('[REPORTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}