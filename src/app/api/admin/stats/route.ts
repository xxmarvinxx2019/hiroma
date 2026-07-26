import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

async function getDigitalPinRevenue(gte?: Date, lt?: Date) {
  try {
    const result = await prisma.registrationFinancial.aggregate({
      where: gte || lt ? { created_at: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } } : {},
      _sum: { pin_allocation: true },
    })
    return Number(result._sum.pin_allocation || 0)
  } catch (error) {
    console.warn('[ADMIN STATS] Registration ledger unavailable; using legacy PIN calculations.', error)
    const pins = await prisma.pin.findMany({
      where: {
        status: 'used',
        ...(gte || lt ? { used_at: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } } : {}),
      },
      select: {
        package: {
          select: {
            products: {
              select: {
                quantity: true,
                product: { select: { price: true, reseller_price: true } },
              },
            },
          },
        },
      },
    })
    return pins.reduce((total, pin) => total + pin.package.products.reduce((sum, item) => {
      const srp = Number(item.product.price || 0)
      const resellerPrice = Number(item.product.reseller_price) || srp
      return sum + Math.max(0, srp - resellerPrice) * item.quantity
    }, 0), 0)
  }
}

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
      digitalCommissionTodayRaw,
      digitalCommissionYesterdayRaw,
      digitalCommissionAllTimeRaw,
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
      resellerSales,
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
        select: {
          id: true,
          order_number: true,
          status: true,
          total_amount: true,
          created_at: true,
          buyer: {
            select: {
              full_name: true,
              role: true,
              distributor_profile: { select: { dist_level: true } },
            },
          },
          seller: { select: { full_name: true } },
        },
      }),
      // Digital PIN revenue is recognized when a reseller registration consumes a PIN.
      getDigitalPinRevenue(today).then((total) => [{ total }]),
      getDigitalPinRevenue(yesterday, today).then((total) => [{ total }]),
      getDigitalPinRevenue().then((total) => [{ total }]),
      // Only paid MLM commissions are digital expenses. Overflow retained by Hiroma
      // is not treated as an expense of the company.
      prisma.$queryRaw<{ total: number }[]>`
        SELECT COALESCE(SUM(amount), 0)::float AS total
        FROM commissions
        WHERE type IN ('direct_referral', 'binary_pairing', 'multilevel')
          AND is_pair_overflow = false AND created_at >= ${today}
      `,
      prisma.$queryRaw<{ total: number }[]>`
        SELECT COALESCE(SUM(amount), 0)::float AS total
        FROM commissions
        WHERE type IN ('direct_referral', 'binary_pairing', 'multilevel')
          AND is_pair_overflow = false
          AND created_at >= ${yesterday} AND created_at < ${today}
      `,
      prisma.$queryRaw<{ total: number }[]>`
        SELECT COALESCE(SUM(amount), 0)::float AS total
        FROM commissions
        WHERE type IN ('direct_referral', 'binary_pairing', 'multilevel')
          AND is_pair_overflow = false
      `,
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
      // Monthly digital PIN revenue from completed registrations.
      prisma.$queryRaw<{ month: string; pin_rev: number; prod_rev: number }[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'Mon') AS month,
          COALESCE(SUM(pin_allocation), 0)::float AS pin_rev,
          0::float AS prod_rev
        FROM registration_financials
        WHERE created_at >= ${yearStart}
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
      `.catch(async () => {
        const rows: { month: string; pin_rev: number; prod_rev: number }[] = []
        for (let month = 0; month < 12; month++) {
          const start = new Date(now.getFullYear(), month, 1)
          const end = new Date(now.getFullYear(), month + 1, 1)
          rows.push({
            month: start.toLocaleDateString('en-PH', { month: 'short' }),
            pin_rev: await getDigitalPinRevenue(start, end),
            prod_rev: 0,
          })
        }
        return rows
      }),
      // Top products
      prisma.$queryRaw<{ name: string; total_sold: number; revenue: number }[]>`
        SELECT p.name, SUM(oi.quantity)::int AS total_sold, COALESCE(SUM(oi.subtotal), 0)::float AS revenue
        FROM order_items oi JOIN products p ON p.id = oi.product_id
        GROUP BY p.id, p.name ORDER BY total_sold DESC LIMIT 5
      `,
      // Top city distributors: delivered product sales plus registration profit.
      // Keep separate counts for the dashboard transaction breakdown.
      prisma.$queryRaw<{ id: string; full_name: string; username: string; pin_rev: number; prod_rev: number; pin_count: number; prod_count: number }[]>`
        SELECT
          dp.user_id::text AS id,
          u.full_name,
          u.username,
          COALESCE(registrations.pin_rev, 0)::float AS pin_rev,
          COALESCE(sales.prod_rev, 0)::float AS prod_rev,
          COALESCE(registrations.pin_count, 0)::int AS pin_count,
          COALESCE(sales.prod_count, 0)::int AS prod_count
        FROM distributor_profiles dp
        JOIN users u ON u.id = dp.user_id
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(o.total_amount), 0) AS prod_rev,
            COUNT(*)::int AS prod_count
          FROM orders o
          WHERE o.seller_id = dp.user_id AND o.status = 'delivered'
        ) sales ON true
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(registration_profit), 0) AS pin_rev,
            COUNT(*)::int AS pin_count
          FROM (
            SELECT rf.registration_profit
            FROM registration_financials rf
            WHERE rf.city_dist_id = dp.user_id
            UNION ALL
            SELECT SUM(
              (
                COALESCE(NULLIF(prod.reseller_price, 0), prod.price) -
                COALESCE(NULLIF(prod.city_price, 0), prod.cost_price)
              ) * pp.quantity
            )
            FROM pins p
            JOIN package_products pp ON pp.package_id = p.package_id
            JOIN products prod ON prod.id = pp.product_id
            WHERE p.city_dist_id = dp.user_id
              AND p.status = 'used'
              AND NOT EXISTS (SELECT 1 FROM registration_financials rf WHERE rf.pin_id = p.id)
            GROUP BY p.id
          ) registration_values
        ) registrations ON true
        WHERE dp.dist_level = 'city'
        ORDER BY (pin_rev + prod_rev) DESC
        LIMIT 5
      `.catch((error) => {
        console.warn('[ADMIN STATS] Top-city registration ledger unavailable.', error)
        return []
      }),
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
        SELECT
          dp.city_muni_name,
          COUNT(DISTINCT dp.user_id)::int AS count,
          COALESCE(SUM(COALESCE(sales.product_revenue, 0) + COALESCE(registrations.registration_revenue, 0)), 0)::float AS total
        FROM distributor_profiles dp
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(o.total_amount), 0) AS product_revenue
          FROM orders o
          WHERE o.seller_id = dp.user_id AND o.status = 'delivered'
        ) sales ON true
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(registration_profit), 0) AS registration_revenue
          FROM (
            SELECT rf.registration_profit
            FROM registration_financials rf
            WHERE rf.city_dist_id = dp.user_id
            UNION ALL
            SELECT SUM(
              (
                COALESCE(NULLIF(prod.reseller_price, 0), prod.price) -
                COALESCE(NULLIF(prod.city_price, 0), prod.cost_price)
              ) * pp.quantity
            )
            FROM pins p
            JOIN package_products pp ON pp.package_id = p.package_id
            JOIN products prod ON prod.id = pp.product_id
            WHERE p.city_dist_id = dp.user_id
              AND p.status = 'used'
              AND NOT EXISTS (SELECT 1 FROM registration_financials rf WHERE rf.pin_id = p.id)
            GROUP BY p.id
          ) registration_values
        ) registrations ON true
        WHERE dp.city_muni_name IS NOT NULL AND dp.dist_level = 'city'
        GROUP BY dp.city_muni_name ORDER BY total DESC LIMIT 10
      `.catch((error) => {
        console.warn('[ADMIN STATS] City ranking registration ledger unavailable.', error)
        return []
      }),
      // Reseller performance — credited commission income
      prisma.$queryRaw<{ full_name: string; total: number; count: number }[]>`
        SELECT
          u.full_name,
          COUNT(c.id)::int AS count,
          COALESCE(SUM(c.amount), 0)::float AS total
        FROM users u
        JOIN commissions c ON c.user_id = u.id
        WHERE u.role = 'reseller' AND u.status = 'active'
        GROUP BY u.id, u.full_name
        ORDER BY total DESC
        LIMIT 10
      `,
    ])

    // ── Compute values ──
    const pinRevenueToday     = Number(pinRevenueRaw[0]?.total     || 0)
    const pinRevenueYesterday = Number(pinYesterdayRaw[0]?.total   || 0)
    const pinRevenue          = Number(pinAllTimeRaw[0]?.total     || 0)
    const digitalCommissionExpenseToday = Number(digitalCommissionTodayRaw[0]?.total || 0)
    const digitalCommissionExpenseYesterday = Number(digitalCommissionYesterdayRaw[0]?.total || 0)
    const digitalCommissionExpense = Number(digitalCommissionAllTimeRaw[0]?.total || 0)
    const orderRevenueToday   = Number(productTodayRaw[0]?.revenue || 0)
    const orderCostToday      = Number(productTodayRaw[0]?.cost    || 0)
    const totalUnitsSoldToday = Number(productTodayRaw[0]?.units   || 0)
    const orderRevenueYesterday = Number(productYesterdayRaw[0]?.revenue || 0)
    const orderRevenue        = Number(productAllTimeRaw[0]?.revenue || 0)
    const orderCost           = Number(productAllTimeRaw[0]?.cost   || 0)
    const totalUnitsSold      = Number(productAllTimeRaw[0]?.units  || 0)
    const totalStock          = Number(inventoryRaw[0]?.total_stock || 0)
    const criticalStock       = Number(inventoryRaw[0]?.critical    || 0)

    const distributionGrossProfitToday = orderRevenueToday - orderCostToday
    const digitalNetToday = pinRevenueToday - digitalCommissionExpenseToday
    const totalRevenueToday     = pinRevenueToday + orderRevenueToday
    const totalRevenueYesterday = pinRevenueYesterday + orderRevenueYesterday
    const netProfitToday        = distributionGrossProfitToday + digitalNetToday
    const orderProfit           = orderRevenue - orderCost
    const digitalNet            = pinRevenue - digitalCommissionExpense
    const totalRevenue          = pinRevenue + orderRevenue
    const overallNetProfit      = digitalNet + orderProfit

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
      pin_orders:  Number(r.pin_count  || 0),
      prod_orders: Number(r.prod_count || 0),
    }))

    return NextResponse.json({
      stats: {
        totalRevenueToday, totalRevenueYesterday, netProfitToday,
        pinRevenueToday, pinRevenueYesterday,
        digitalCommissionExpenseToday, digitalCommissionExpenseYesterday,
        digitalNetToday, distributionGrossProfitToday,
        orderRevenueToday, totalUnitsSoldToday,
        newResellersToday, newResellersYesterday, newResellersThisMonth,
        totalResellers, totalDistributors,
        pendingPayouts:       pendingPayoutsAgg._count.id,
        pendingPayoutsAmount: Number(pendingPayoutsAgg._sum.amount || 0),
        totalProducts, activePins,
        pinRevenue, digitalCommissionExpense, digitalNet,
        orderRevenue, orderCost, orderProfit,
        distributionGrossProfit: orderProfit,
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
        regionalSales, provinceSales, citySales, resellerSales,
        pinsSoldToday: 0,
      },
    })
  } catch (error) {
    console.error('[ADMIN STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
