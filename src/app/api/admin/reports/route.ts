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
    const days     = Math.min(90, Math.max(7, parseInt(searchParams.get('days') || '30')))
    const dateFrom = searchParams.get('dateFrom') || ''
    const dateTo   = searchParams.get('dateTo')   || ''

    // ── Date range ──
    let since: Date
    let until: Date = new Date()
    until.setHours(23, 59, 59, 999)

    if (dateFrom) {
      since = new Date(dateFrom)
      since.setHours(0, 0, 0, 0)
    } else {
      since = new Date()
      since.setDate(since.getDate() - days)
      since.setHours(0, 0, 0, 0)
    }

    if (dateTo) {
      until = new Date(dateTo)
      until.setHours(23, 59, 59, 999)
    }

    const periodFilter = { gte: since, lte: until }

    const [
      // Network
      totalResellers, activeResellers, suspendedResellers,
      regionalCount, provincialCount, cityCount,

      // Financial
      walletStats, pendingPayouts, pendingPayoutsAmount, commissionsPaid,

      // MLM
      totalCommissions, directReferralCount, binaryPairingCount,
      multilevelCount, sponsorPointCount, totalPointsEarned, totalOverflowCount,

      // Catalog
      totalProducts, physicalProducts, digitalProducts,
      totalPackages, totalPinsGenerated, unusedPins, usedPins,

      // Admin sales
      adminSalesAll, adminSalesPeriod, allDeliveredOrders,

      // Daily orders for chart
      dailyOrders,

      // Top products
      topProductItems,

      // Per distributor level
      regionalSales, provincialSales, citySales,

      // PIN sales breakdown
      pinSalesByPackage,

      // Product sales breakdown (period)
      productSalesItems,

      // Reseller orders (product sales from resellers to city)
      resellerOrderItems,

    ] = await Promise.all([
      // Network
      prisma.user.count({ where: { role: 'reseller' } }),
      prisma.user.count({ where: { role: 'reseller', status: 'active' } }),
      prisma.user.count({ where: { role: 'reseller', status: 'suspended' } }),
      prisma.user.count({ where: { role: 'regional' } }),
      prisma.user.count({ where: { role: 'provincial' } }),
      prisma.user.count({ where: { role: 'city' } }),

      // Wallets
      prisma.wallet.aggregate({ _sum: { balance: true, total_earned: true, total_withdrawn: true } }),
      prisma.payout.count({ where: { status: 'pending' } }),
      prisma.payout.aggregate({ where: { status: 'pending' }, _sum: { amount: true } }),
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
      prisma.pin.count({ where: { status: 'unused' } }),  // available
      prisma.pin.count({ where: { status: { in: ['unused', 'used', 'expired'] } } }),

      // Admin sales
      prisma.order.aggregate({
        where: { seller_id: user.id, status: 'delivered' },
        _sum: { total_amount: true }, _count: { id: true },
      }),
      prisma.order.aggregate({
        where: { seller_id: user.id, status: 'delivered', created_at: periodFilter },
        _sum: { total_amount: true }, _count: { id: true },
      }),
      prisma.order.aggregate({
        where: { status: 'delivered' },
        _sum: { total_amount: true }, _count: { id: true },
      }),

      // Daily chart
      prisma.order.findMany({
        where:   { status: 'delivered', created_at: periodFilter },
        select:  { created_at: true, total_amount: true },
        orderBy: { created_at: 'asc' },
      }),

      // Top products
      prisma.orderItem.groupBy({
        by:    ['product_id'],
        where: { order: { status: 'delivered', created_at: periodFilter } },
        _sum:  { quantity: true, subtotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 10,
      }),

      // Per level
      prisma.order.aggregate({
        where: { status: 'delivered', buyer: { role: 'regional' }, created_at: periodFilter },
        _sum: { total_amount: true }, _count: { id: true },
      }),
      prisma.order.aggregate({
        where: { status: 'delivered', buyer: { role: 'provincial' }, created_at: periodFilter },
        _sum: { total_amount: true }, _count: { id: true },
      }),
      prisma.order.aggregate({
        where: { status: 'delivered', buyer: { role: 'city' }, created_at: periodFilter },
        _sum: { total_amount: true }, _count: { id: true },
      }),

      // PIN sales breakdown by package (period)
      prisma.pin.groupBy({
        by:    ['package_id'],
        where: { status: { in: ['unused', 'used', 'expired'] }, created_at: periodFilter },
        _count: { id: true },
      }),

      // Product sales breakdown (period) — distributor orders
      prisma.orderItem.groupBy({
        by:    ['product_id'],
        where: { order: { status: 'delivered', created_at: periodFilter } },
        _sum:  { quantity: true, subtotal: true },
        orderBy: { _sum: { subtotal: 'desc' } },
      }),

      // Reseller product orders (city as seller)
      prisma.orderItem.groupBy({
        by:    ['product_id'],
        where: { order: { status: 'delivered', buyer: { role: 'reseller' }, created_at: periodFilter } },
        _sum:  { quantity: true, subtotal: true },
        orderBy: { _sum: { subtotal: 'desc' } },
      }),
    ])

    // ── Build daily sales chart ──
    const dailyMap = new Map<string, { date: string; orders: number; revenue: number }>()
    const totalDays = Math.ceil((until.getTime() - since.getTime()) / (1000 * 60 * 60 * 24)) + 1
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(since)
      d.setDate(d.getDate() + i)
      const key = d.toISOString().split('T')[0]
      dailyMap.set(key, { date: key, orders: 0, revenue: 0 })
    }
    for (const order of dailyOrders) {
      const key = new Date(order.created_at).toISOString().split('T')[0]
      const existing = dailyMap.get(key)
      if (existing) { existing.orders += 1; existing.revenue += Number(order.total_amount) }
    }

    // ── Top products with names ──
    const allProductIds = [
      ...topProductItems.map((p) => p.product_id),
      ...productSalesItems.map((p) => p.product_id),
      ...resellerOrderItems.map((p) => p.product_id),
    ]
    const productDetails = await prisma.product.findMany({
      where:  { id: { in: [...new Set(allProductIds)] } },
      select: { id: true, name: true, type: true, cost_price: true, reseller_price: true },
    })
    const productMap = new Map(productDetails.map((p) => [p.id, p]))

    const topProducts = topProductItems.map((item) => {
      const product = productMap.get(item.product_id)
      return {
        product_id: item.product_id,
        name:       product?.name || 'Unknown',
        type:       product?.type || 'physical',
        units_sold: Number(item._sum.quantity || 0),
        revenue:    Number(item._sum.subtotal  || 0),
      }
    })

    // ── Product sales breakdown ──
    const productSalesBreakdown = productSalesItems.map((item) => {
      const product = productMap.get(item.product_id)
      const units   = Number(item._sum.quantity || 0)
      const revenue = Number(item._sum.subtotal  || 0)
      const cost    = Number(product?.cost_price ?? 0) * units
      return {
        product_id: item.product_id,
        name:       product?.name || 'Unknown',
        type:       product?.type || 'physical',
        units_sold: units,
        revenue,
        cost,
        profit: revenue - cost,
      }
    })

    // Reseller product sales
    const resellerProductSales = resellerOrderItems.map((item) => {
      const product = productMap.get(item.product_id)
      const units   = Number(item._sum.quantity || 0)
      const revenue = Number(item._sum.subtotal  || 0)
      return {
        product_id: item.product_id,
        name:       product?.name || 'Unknown',
        type:       product?.type || 'physical',
        units_sold: units,
        revenue,
      }
    })

    // ── PIN sales breakdown by package ──
    // Package total value = PIN price + (SRP × qty per product)
    const pinPackageIds = pinSalesByPackage.map((p) => p.package_id)
    const packageDetails = await prisma.package.findMany({
      where:  { id: { in: pinPackageIds } },
      select: {
        id: true, name: true, price: true,
        products: {
          select: {
            quantity: true,
            product:  { select: { price: true } },  // price = SRP
          },
        },
      },
    })
    const packageMap = new Map(packageDetails.map((p) => [p.id, p]))

    const pinSalesBreakdown = pinSalesByPackage.map((item) => {
      const pkg        = packageMap.get(item.package_id)
      const count      = Number(item._count.id || 0)
      const pinPrice   = Number(pkg?.price || 0)
      const productsValue = (pkg?.products || []).reduce((s: number, pp: any) => {
        return s + Number(pp.product?.price || 0) * pp.quantity
      }, 0)
      const packageValue = pinPrice + productsValue  // total value per package sold
      const revenue      = count * pinPrice              // PIN sales revenue = PIN price only
      return {
        package_id:      item.package_id,
        package_name:    pkg?.name || 'Unknown',
        pins_sold:       count,
        pin_price:       pinPrice,
        products_value:  productsValue,
        package_value:   packageValue,
        revenue,
      }
    }).sort((a, b) => b.revenue - a.revenue)

    const totalPinRevenue     = pinSalesBreakdown.reduce((s, p) => s + p.revenue, 0)
    const totalPinsSoldPeriod = pinSalesBreakdown.reduce((s, p) => s + p.pins_sold, 0)

    // ── Admin cost of goods ──
    const allSoldItems = await prisma.orderItem.findMany({
      where:  { order: { status: 'delivered', seller_id: user.id } },
      select: { quantity: true, subtotal: true, product: { select: { cost_price: true } } },
    })
    const totalAdminRevenue = Number(adminSalesAll._sum.total_amount || 0)
    const totalAdminCost    = allSoldItems.reduce((s, i) => s + Number(i.product.cost_price || 0) * Number(i.quantity), 0)
    const totalAdminProfit  = totalAdminRevenue - totalAdminCost
    const totalUnitsSold    = allSoldItems.reduce((s, i) => s + i.quantity, 0)

    // ── Overall sales summary ──
    const totalProductRevenue  = productSalesBreakdown.reduce((s, p) => s + p.revenue, 0)
    const totalProductCost     = productSalesBreakdown.reduce((s, p) => s + p.cost, 0)
    const totalProductProfit   = totalProductRevenue - totalProductCost
    const totalProductUnitsSold = productSalesBreakdown.reduce((s, p) => s + p.units_sold, 0)
    const overallRevenue       = totalProductRevenue + totalPinRevenue
    const overallProfit        = totalProductProfit + totalPinRevenue // pins are pure revenue

    return NextResponse.json({
      report: {
        period: {
          days,
          since:     since.toISOString(),
          until:     until.toISOString(),
          dateFrom:  dateFrom || null,
          dateTo:    dateTo   || null,
        },

        network: {
          totalResellers, activeResellers, suspendedResellers,
          totalDistributors: regionalCount + provincialCount + cityCount,
          regionalCount, provincialCount, cityCount,
        },

        financial: {
          totalWalletBalance:   Number(walletStats._sum.balance        || 0),
          totalEarned:          Number(walletStats._sum.total_earned    || 0),
          totalWithdrawn:       Number(walletStats._sum.total_withdrawn || 0),
          totalPendingPayouts:  pendingPayouts,
          totalPendingAmount:   Number(pendingPayoutsAmount._sum.amount || 0),
          totalCommissionsPaid: Number(commissionsPaid._sum.amount      || 0),
        },

        sales: {
          adminRevenue:      totalAdminRevenue,
          adminCost:         totalAdminCost,
          adminProfit:       totalAdminProfit,
          adminOrders:       Number(adminSalesAll._count.id   || 0),
          adminUnitsSold:    totalUnitsSold,
          periodRevenue:     Number(adminSalesPeriod._sum.total_amount || 0),
          periodOrders:      Number(adminSalesPeriod._count.id         || 0),
          chainRevenue:      Number(allDeliveredOrders._sum.total_amount || 0),
          chainOrders:       Number(allDeliveredOrders._count.id         || 0),
          regionalRevenue:   Number(regionalSales._sum.total_amount   || 0),
          regionalOrders:    Number(regionalSales._count.id           || 0),
          provincialRevenue: Number(provincialSales._sum.total_amount || 0),
          provincialOrders:  Number(provincialSales._count.id         || 0),
          cityRevenue:       Number(citySales._sum.total_amount       || 0),
          cityOrders:        Number(citySales._count.id               || 0),
        },

        mlm: {
          totalCommissions, directReferralCount, binaryPairingCount,
          multilevelCount, sponsorPointCount,
          totalPointsEarned: Number(totalPointsEarned._sum.points || 0),
          totalOverflowCount,
        },

        catalog: {
          totalProducts, physicalProducts, digitalProducts,
          totalPackages, totalPinsGenerated, unusedPins, usedPins,
        },

        // ── NEW ──
        overview: {
          totalProductRevenue, totalProductCost, totalProductProfit, totalProductUnitsSold,
          totalPinRevenue, totalPinsSoldPeriod,
          overallRevenue, overallProfit,
        },

        productSales: {
          breakdown:      productSalesBreakdown,
          resellerOrders: resellerProductSales,
        },

        pinSales: {
          breakdown:      pinSalesBreakdown,
          totalRevenue:   totalPinRevenue,
          totalPinsSold:  totalPinsSoldPeriod,
        },

        charts: {
          dailySales:  Array.from(dailyMap.values()),
          topProducts,
        },
      },
    })
  } catch (error) {
    console.error('[REPORTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}