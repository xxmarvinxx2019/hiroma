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
    const yearStart  = new Date(now.getFullYear(), 0, 1)

    // ── Admin user ──
    const adminUser = await prisma.user.findFirst({
      where:  { role: 'admin' },
      select: { id: true },
    })
    const adminId = adminUser?.id

    // ── Run all independent queries in parallel ──
    const [
      totalResellers,
      totalDistributors,
      pendingPayoutsAgg,
      newResellersToday,
      newResellersYesterday,
      newResellersThisMonth,
      totalProducts,
      activePins,
      ordersByStatus,
      recentOrders,
      // Revenue aggregates via raw SQL (single queries instead of findMany+reduce)
      pinRevenueRaw,
      pinYesterdayRaw,
      pinAllTimeRaw,
      productTodayRaw,
      productYesterdayRaw,
      productAllTimeRaw,
      inventoryRaw,
      monthlyRaw,
      topProductsRaw,
      topCityRaw,
      regionalSales,
      provinceSales,
      citySales,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'reseller' } }),
      prisma.distributorProfile.count({ where: { is_active: true } }),
      prisma.payout.aggregate({ where: { status: 'pending' }, _sum: { amount: true }, _count: { id: true } }),
      prisma.user.count({ where: { role: 'reseller', created_at: { gte: today } } }),
      prisma.user.count({ where: { role: 'reseller', created_at: { gte: yesterday, lt: today } } }),
      prisma.user.count({ where: { role: 'reseller', created_at: { gte: monthStart } } }),
      prisma.product.count({ where: { is_active: true } }),
      prisma.pin.count({ where: { status: 'unused' } }),
      adminId ? prisma.order.groupBy({ by: ['status'], where: { seller_id: adminId }, _count: { status: true } }) : Promise.resolve([]),
      prisma.order.findMany({
        where: { status: { not: 'cancelled' } }, orderBy: { created_at: 'desc' }, take: 3,
        select: { id: true, order_number: true, status: true, total_amount: true, created_at: true,
          buyer: { select: { full_name: true, role: true } }, seller: { select: { full_name: true } } },
      }),
      // PIN revenue today via raw SQL
      adminId ? prisma.$queryRaw<{ total: number }[]>`
        SELECT COALESCE(SUM(total_amount), 0)::float AS total FROM orders
        WHERE seller_id::text = ${adminId} AND notes LIKE 'PIN sale:%' AND created_at >= ${today}
      ` : Promise.resolve([{ total: 0 }]),
      // PIN revenue yesterday
      adminId ? prisma.$queryRaw<{ total: number }[]>`
        SELECT COALESCE(SUM(total_amount), 0)::float AS total FROM orders
        WHERE seller_id::text = ${adminId} AND notes LIKE 'PIN sale:%'
          AND created_at >= ${yesterday} AND created_at < ${today}
      ` : Promise.resolve([{ total: 0 }]),
      // PIN revenue all time
      adminId ? prisma.$queryRaw<{ total: number }[]>`
        SELECT COALESCE(SUM(total_amount), 0)::float AS total FROM orders
        WHERE seller_id::text = ${adminId} AND notes LIKE 'PIN sale:%'
      ` : Promise.resolve([{ total: 0 }]),
      // Product revenue today
      adminId ? prisma.$queryRaw<{ revenue: number; cost: number; units: number }[]>`
        SELECT
          COALESCE(SUM(oi.subtotal), 0)::float AS revenue,
          COALESCE(SUM(p.cost_price * oi.quantity), 0)::float AS cost,
          COALESCE(SUM(oi.quantity), 0)::int AS units
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.seller_id::text = ${adminId} AND o.status = 'delivered' AND o.updated_at >= ${today}
      ` : Promise.resolve([{ revenue: 0, cost: 0, units: 0 }]),
      // Product revenue yesterday
      adminId ? prisma.$queryRaw<{ revenue: number }[]>`
        SELECT COALESCE(SUM(oi.subtotal), 0)::float AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.seller_id::text = ${adminId} AND o.status = 'delivered'
          AND o.updated_at >= ${yesterday} AND o.updated_at < ${today}
      ` : Promise.resolve([{ revenue: 0 }]),
      // Product revenue all time
      adminId ? prisma.$queryRaw<{ revenue: number; cost: number; units: number }[]>`
        SELECT
          COALESCE(SUM(oi.subtotal), 0)::float AS revenue,
          COALESCE(SUM(p.cost_price * oi.quantity), 0)::float AS cost,
          COALESCE(SUM(oi.quantity), 0)::int AS units
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.seller_id::text = ${adminId} AND o.status = 'delivered'
      ` : Promise.resolve([{ revenue: 0, cost: 0, units: 0 }]),
      // Inventory summary
      adminId ? prisma.$queryRaw<{ total_stock: number; critical: number; total_items: number }[]>`
        SELECT
          COALESCE(SUM(quantity), 0)::int AS total_stock,
          COUNT(CASE WHEN quantity <= low_stock_threshold THEN 1 END)::int AS critical,
          COUNT(*)::int AS total_items
        FROM inventory WHERE owner_id::text = ${adminId}
      ` : Promise.resolve([{ total_stock: 0, critical: 0, total_items: 0 }]),
      // Monthly revenue - last 12 months in ONE query
      adminId ? prisma.$queryRaw<{ month: string; pin_rev: number; prod_rev: number }[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS month,
          COALESCE(SUM(CASE WHEN notes LIKE 'PIN sale:%' THEN total_amount ELSE 0 END), 0)::float AS pin_rev,
          0::float AS prod_rev
        FROM orders
        WHERE seller_id::text = ${adminId} AND created_at >= ${yearStart}
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
      ` : Promise.resolve([]),
      // Top products
      prisma.$queryRaw<{ name: string; total_sold: number; revenue: number }[]>`
        SELECT p.name, SUM(oi.quantity)::int AS total_sold, COALESCE(SUM(oi.subtotal), 0)::float AS revenue
        FROM order_items oi JOIN products p ON p.id = oi.product_id
        GROUP BY p.id, p.name ORDER BY total_sold DESC LIMIT 5
      `,
      // Top city dists - PIN + product in ONE query
      prisma.$queryRaw<{ id: string; full_name: string; username: string; pin_rev: number; prod_rev: number }[]>`
        SELECT * FROM (
          SELECT
            dp.user_id::text AS id,
            u.full_name,
            u.username,
            COALESCE(SUM(CASE WHEN o.notes LIKE 'PIN sale:%' THEN o.total_amount ELSE 0 END), 0)::float AS pin_rev,
            COALESCE(SUM(CASE WHEN o.notes NOT LIKE 'PIN sale:%' AND o.status = 'delivered' THEN o.total_amount ELSE 0 END), 0)::float AS prod_rev
          FROM distributor_profiles dp
          JOIN users u ON u.id = dp.user_id
          LEFT JOIN orders o ON (o.buyer_id = dp.user_id OR o.seller_id = dp.user_id)
          WHERE dp.dist_level = 'city'
          GROUP BY dp.user_id, u.full_name, u.username
        ) sub
        ORDER BY (pin_rev + prod_rev) DESC
        LIMIT 5
      `,
      // Regional sales
      prisma.$queryRaw<{ region_name: string; total: number; count: number }[]>`
        SELECT dp.region_name,
          COUNT(DISTINCT dp.user_id)::int as count,
          COALESCE(SUM(o.total_amount), 0)::float as total
        FROM distributor_profiles dp
        LEFT JOIN orders o ON o.seller_id::text = dp.user_id::text AND o.status = 'delivered'
        WHERE dp.region_name IS NOT NULL AND dp.dist_level = 'regional'
        GROUP BY dp.region_name ORDER BY total DESC LIMIT 10
      `,
      // Province sales
      prisma.$queryRaw<{ province_name: string; total: number; count: number }[]>`
        SELECT dp.province_name,
          COUNT(DISTINCT dp.user_id)::int as count,
          COALESCE(SUM(o.total_amount), 0)::float as total
        FROM distributor_profiles dp
        LEFT JOIN orders o ON o.seller_id::text = dp.user_id::text AND o.status = 'delivered'
        WHERE dp.province_name IS NOT NULL AND dp.dist_level = 'provincial'
        GROUP BY dp.province_name ORDER BY total DESC LIMIT 10
      `,
      // City sales
      prisma.$queryRaw<{ city_muni_name: string; total: number; count: number }[]>`
        SELECT dp.city_muni_name,
          COUNT(DISTINCT dp.user_id)::int as count,
          COALESCE(SUM(o.total_amount), 0)::float as total
        FROM distributor_profiles dp
        LEFT JOIN orders o ON o.seller_id::text = dp.user_id::text AND o.status = 'delivered'
        WHERE dp.city_muni_name IS NOT NULL AND dp.dist_level = 'city'
        GROUP BY dp.city_muni_name ORDER BY total DESC LIMIT 10
      `,
    ])

    // ── Compute values ──
    const pinRevenueToday     = Number(pinRevenueRaw[0]?.total     || 0)
    const pinRevenueYesterday = Number(pinYesterdayRaw[0]?.total   || 0)
    const pinRevenue          = Number(pinAllTimeRaw[0]?.total     || 0)
    const orderRevenueToday   = Number(productTodayRaw[0]?.revenue || 0)
    const orderCostToday      = Number(productTodayRaw[0]?.cost    || 0)
    const totalUnitsSoldToday = Number(productTodayRaw[0]?.units   || 0)
    const orderRevenueYesterday = Number(productYesterdayRaw[0]?.revenue || 0)
    const orderRevenue        = Number(productAllTimeRaw[0]?.revenue || 0)
    const orderCost           = Number(productAllTimeRaw[0]?.cost   || 0)
    const totalUnitsSold      = Number(productAllTimeRaw[0]?.units  || 0)
    const totalStock          = Number(inventoryRaw[0]?.total_stock || 0)
    const criticalStock       = Number(inventoryRaw[0]?.critical    || 0)

    const totalRevenueToday     = pinRevenueToday + orderRevenueToday
    const totalRevenueYesterday = pinRevenueYesterday + orderRevenueYesterday
    const netProfitToday        = pinRevenueToday + (orderRevenueToday - orderCostToday)
    const orderProfit           = orderRevenue - orderCost
    const totalRevenue          = pinRevenue + orderRevenue
    const overallNetProfit      = pinRevenue + orderProfit

    // Monthly revenue - fill all 12 months
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const monthMap   = new Map((monthlyRaw as any[]).map(r => [r.month, Number(r.pin_rev || 0)]))
    const monthlyRevenue = monthNames.map(m => ({ month: m, revenue: monthMap.get(m) || 0 }))

    // Growth
    const thisMonthName  = now.toLocaleDateString('en-PH', { month: 'short' })
    const lastMonthName  = new Date(now.getFullYear(), now.getMonth() - 1).toLocaleDateString('en-PH', { month: 'short' })
    const thisMonthRev   = monthMap.get(thisMonthName) || 0
    const lastMonthRev   = monthMap.get(lastMonthName) || 0
    const growthPct      = lastMonthRev > 0 ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100) : 0

    // Top city dists
    const topCityDistsOverall = (topCityRaw as any[]).map(r => ({
      id:          r.id,
      full_name:   r.full_name,
      username:    r.username,
      revenue:     Number(r.pin_rev || 0) + Number(r.prod_rev || 0),
      pin_orders:  0,
      prod_orders: 0,
    }))

    return NextResponse.json({
      stats: {
        totalRevenueToday, totalRevenueYesterday, netProfitToday,
        pinRevenueToday, pinRevenueYesterday,
        orderRevenueToday, totalUnitsSoldToday,
        newResellersToday, newResellersYesterday, newResellersThisMonth,
        totalResellers, totalDistributors,
        pendingPayouts:       pendingPayoutsAgg._count.id,
        pendingPayoutsAmount: Number(pendingPayoutsAgg._sum.amount || 0),
        totalProducts, activePins,
        pinRevenue, orderRevenue, orderCost, orderProfit,
        totalRevenue, overallNetProfit,
        chainRevenue: totalRevenue,
        totalUnitsSold,
        topProducts:        topProductsRaw as any[],
        recentOrders,
        ordersByStatus,
        monthlyRevenue,
        lastMonthRevenue:   lastMonthRev,
        thisMonthRevenue:   thisMonthRev,
        growthPct,
        totalStock, criticalStock,
        topCityDistsOverall,
        regionalSales, provinceSales, citySales,
        pinsSoldToday: 0,
      },
    })
  } catch (error) {
    console.error('[ADMIN STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}