import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true },
    })
    const isBranch = profile?.dist_level === 'branch'
    const inventoryCost = (product: { cost_price: unknown; city_price: unknown; branch_price: unknown }) =>
      isBranch ? Number(product.branch_price) || Number(product.cost_price) : Number(product.city_price)

    // Business-day boundaries are always Philippine time, even when Vercel runs in UTC.
    const now = new Date()
    const manilaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const manilaYear = manilaNow.getUTCFullYear()
    const manilaMonth = manilaNow.getUTCMonth()
    const manilaDay = manilaNow.getUTCDate()
    const toUtcFromManilaMidnight = (year: number, month: number, day: number) =>
      new Date(Date.UTC(year, month, day) - 8 * 60 * 60 * 1000)
    const today = toUtcFromManilaMidnight(manilaYear, manilaMonth, manilaDay)
    const tomorrow = toUtcFromManilaMidnight(manilaYear, manilaMonth, manilaDay + 1)
    const yesterday = toUtcFromManilaMidnight(manilaYear, manilaMonth, manilaDay - 1)
    const monthStart = toUtcFromManilaMidnight(manilaYear, manilaMonth, 1)

    const [
      totalResellers,
      activeResellers,
      newResellersToday,
      newResellersYesterday,
      newResellersThisMonth,
      unusedPins,
      usedPins,
      totalPinsRequested,
      totalOrders,
      pendingOrders,
      inventory,
      recentResellers,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'reseller', created_by: user.id } }),
      prisma.user.count({ where: { role: 'reseller', created_by: user.id, status: 'active' } }),
      prisma.user.count({ where: { role: 'reseller', created_by: user.id, created_at: { gte: today, lt: tomorrow } } }),
      prisma.user.count({ where: { role: 'reseller', created_by: user.id, created_at: { gte: yesterday, lt: today } } }),
      prisma.user.count({ where: { role: 'reseller', created_by: user.id, created_at: { gte: monthStart } } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'unused' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'used'   } }),
      prisma.pin.count({ where: { city_dist_id: user.id } }),
      prisma.order.count({ where: { buyer_id: user.id } }),
      prisma.order.count({ where: { buyer_id: user.id, status: 'pending' } }),
      prisma.inventory.findMany({
        where:  { owner_id: user.id },
        select: { quantity: true, low_stock_threshold: true, product: { select: { name: true } } },
      }),
      prisma.user.findMany({
        where:   { role: 'reseller', created_by: user.id },
        orderBy: { created_at: 'desc' },
        take:    5,
        select:  {
          id: true, full_name: true, username: true, created_at: true,
          reseller_profile: { select: { package: { select: { name: true } } } },
        },
      }),
    ])

    const lowStockItems = inventory.filter(i => i.quantity <= i.low_stock_threshold).length
    const totalStock    = inventory.reduce((s, i) => s + i.quantity, 0)

    // ── Today's walk-in order sales ──
    const todayWalkInItems = await prisma.orderItem.findMany({
      where:  {
        order: {
          seller_id: user.id,
          status: 'delivered',
          OR: [
            { delivered_at: { gte: today, lt: tomorrow } },
            { delivered_at: null, created_at: { gte: today, lt: tomorrow } },
          ],
        },
      },
      select: { quantity: true, subtotal: true },
    })
    const yesterdayWalkInItems = await prisma.orderItem.findMany({
      where:  {
        order: {
          seller_id: user.id,
          status: 'delivered',
          OR: [
            { delivered_at: { gte: yesterday, lt: today } },
            { delivered_at: null, created_at: { gte: yesterday, lt: today } },
          ],
        },
      },
      select: { quantity: true, subtotal: true },
    })
    const salesRevenueToday     = todayWalkInItems.reduce((s, i) => s + Number(i.subtotal || 0), 0)
    const salesRevenueYesterday = yesterdayWalkInItems.reduce((s, i) => s + Number(i.subtotal || 0), 0)
    const unitsSoldToday        = todayWalkInItems.reduce((s, i) => s + i.quantity, 0)

    // ── Today's PINs used (reseller registrations today) ──
    const pinsUsedToday = await prisma.pin.count({
      where: { city_dist_id: user.id, status: 'used', used_at: { gte: today, lt: tomorrow } },
    })

    // ── All-time product order sales ──
    const deliveredOrders = await prisma.order.findMany({
      where:  { seller_id: user.id, status: 'delivered' },
      select: {
        items: {
          select: {
            quantity: true, subtotal: true, unit_acquisition_cost: true,
            product: { select: { cost_price: true, city_price: true, branch_price: true, name: true } },
          },
        },
      },
    })
    const orderRevenue   = deliveredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + Number(i.subtotal), 0), 0)
    const orderCost      = deliveredOrders.reduce(
      (s, o) => s + o.items.reduce(
        (ss, i) => ss + (i.unit_acquisition_cost == null
          ? inventoryCost(i.product)
          : Number(i.unit_acquisition_cost)) * i.quantity,
        0
      ),
      0
    )
    const orderUnitsSold = deliveredOrders.reduce((s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0)

    // ── Product movement (top products sold) ──
    const productMovement: Record<string, { name: string; qty: number; revenue: number }> = {}
    for (const order of deliveredOrders) {
      for (const item of order.items) {
        const name = item.product.name
        if (!productMovement[name]) productMovement[name] = { name, qty: 0, revenue: 0 }
        productMovement[name].qty     += item.quantity
        productMovement[name].revenue += Number(item.subtotal)
      }
    }
    const topProducts = Object.values(productMovement).sort((a, b) => b.qty - a.qty).slice(0, 10)

    // ── Package (PIN) sales from reseller registrations ──
    const registrationSnapshots = await prisma.registrationFinancial.findMany({
      where: { city_dist_id: user.id },
      select: {
        package_id: true,
        customer_payment: true,
        product_acquisition_cost: true,
        reseller_value: true,
        pin_allocation: true,
      },
    }).catch((error) => {
      console.warn('[CITY STATS] Registration ledger unavailable; using legacy PIN calculations.', error)
      return []
    })
    const registrationRows = registrationSnapshots.map((row) => ({
      package_id: row.package_id,
      customer_payment: Number(row.customer_payment),
      product_acquisition_cost: Number(row.product_acquisition_cost),
      reseller_value: Number(row.reseller_value),
      pin_allocation: Number(row.pin_allocation),
    }))
    if (registrationRows.length === 0) {
      const legacyRegistrations = await prisma.pin.findMany({
        where: { city_dist_id: user.id, status: 'used' },
        select: {
          package_id: true,
          package: {
            select: {
              products: {
                select: {
                  quantity: true,
                  product: {
                    select: {
                      price: true,
                      reseller_price: true,
                      cost_price: true,
                      city_price: true,
                      branch_price: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
      for (const pin of legacyRegistrations) {
        const customerPayment = pin.package.products.reduce(
          (sum, item) => sum + Number(item.product.price || 0) * item.quantity,
          0
        )
        const resellerValue = pin.package.products.reduce(
          (sum, item) => sum + (Number(item.product.reseller_price) || Number(item.product.price)) * item.quantity,
          0
        )
        const productAcquisitionCost = pin.package.products.reduce(
          (sum, item) => sum + inventoryCost(item.product) * item.quantity,
          0
        )
        registrationRows.push({
          package_id: pin.package_id,
          customer_payment: customerPayment,
          product_acquisition_cost: productAcquisitionCost,
          reseller_value: resellerValue,
          pin_allocation: Math.max(0, customerPayment - resellerValue),
        })
      }
    }
    const registrationPackageIds = [...new Set(registrationRows.map((row) => row.package_id))]
    const registrationPackages = await prisma.package.findMany({
      where: { id: { in: registrationPackageIds } },
      select: {
        id: true,
        name: true,
        products: { select: { quantity: true } },
      },
    })
    const registrationPackageMap = new Map(registrationPackages.map((pkg) => [pkg.id, pkg]))

    // Package breakdown
    const packageBreakdown: Record<string, { name: string; count: number; revenue: number }> = {}
    let packageRevenue = 0
    let packageCost = 0
    let packagePinRemittance = 0
    let packageCustomerPayments = 0
    let packageUnitsSold = 0
    for (const registration of registrationRows) {
      const pkg = registrationPackageMap.get(registration.package_id)
      const pname = pkg?.name || 'Package'
      if (!packageBreakdown[pname]) packageBreakdown[pname] = { name: pname, count: 0, revenue: 0 }
      packageBreakdown[pname].count++
      const resellerValue = Number(registration.reseller_value)
      packageBreakdown[pname].revenue += resellerValue
      packageCustomerPayments += Number(registration.customer_payment)
      packageRevenue += resellerValue
      packageCost += Number(registration.product_acquisition_cost)
      packagePinRemittance += Number(registration.pin_allocation)
      packageUnitsSold += (pkg?.products || []).reduce((sum, item) => sum + item.quantity, 0)
    }

    // ── Monthly revenue (last 6 months) ──
    const monthlyRevenue: { month: string; revenue: number; resellers: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d     = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
      const label = d.toLocaleDateString('en-PH', { month: 'short' })

      const mItems = await prisma.orderItem.findMany({
        where:  {
          order: {
            seller_id: user.id,
            status: 'delivered',
            OR: [
              { delivered_at: { gte: start, lte: end } },
              { delivered_at: null, created_at: { gte: start, lte: end } },
            ],
          },
        },
        select: { subtotal: true },
      })
      const mResellers = await prisma.user.count({
        where: { role: 'reseller', created_by: user.id, created_at: { gte: start, lte: end } },
      })
      monthlyRevenue.push({
        month:     label,
        revenue:   mItems.reduce((s, i) => s + Number(i.subtotal || 0), 0),
        resellers: mResellers,
      })
    }

    // ── Recent orders (walk-in) ──
    const recentOrders = await prisma.order.findMany({
      where:   { seller_id: user.id },
      orderBy: { created_at: 'desc' },
      take:    5,
      select:  {
        id: true, order_number: true, status: true,
        total_amount: true, created_at: true,
        buyer: { select: { full_name: true, username: true } },
      },
    })

    const totalRevenue   = orderRevenue + packageRevenue
    const totalCost      = orderCost    + packageCost
    const totalProfit    = totalRevenue - totalCost
    const totalUnitsSold = orderUnitsSold + packageUnitsSold

    // ── Top earners among resellers ──
    const topEarners = (await prisma.resellerProfile.findMany({
      where: { city_dist_id: user.id, user: { status: 'active' } },
      select: {
        user: {
          select: {
            id: true,
            full_name: true,
            username: true,
            wallet: { select: { total_earned: true, balance: true } },
          },
        },
        package: { select: { name: true } },
      },
    }))
      .sort((a, b) => Number(b.user.wallet?.total_earned || 0) - Number(a.user.wallet?.total_earned || 0))
      .slice(0, 5)

    return NextResponse.json({
      stats: {
        accountType: profile?.dist_level || 'city',
        isStaff: Boolean(user.is_staff),
        staffPermissions: user.permissions || [],
        // Today
        salesRevenueToday,
        salesRevenueYesterday,
        unitsSoldToday,
        newResellersToday,
        newResellersYesterday,
        newResellersThisMonth,
        pinsUsedToday,
        // Totals
        totalResellers,
        activeResellers,
        unusedPins,
        usedPins,
        totalPinsRequested,
        totalOrders,
        pendingOrders,
        lowStockItems,
        totalInventoryItems: inventory.length,
        totalStock,
        // Revenue
        totalRevenue,
        totalCost,
        totalProfit,
        totalUnitsSold,
        orderRevenue,
        orderCost,
        orderUnitsSold,
        packageRevenue,
        packageCost,
        packagePinRemittance,
        packageCustomerPayments,
        packageUnitsSold,
        // Lists
        topProducts,
        packageBreakdown: Object.values(packageBreakdown).sort((a, b) => b.count - a.count),
        monthlyRevenue,
        recentResellers,
        recentOrders,
        topEarners: topEarners.map(r => ({
          id: r.user.id,
          full_name: r.user.full_name,
          username: r.user.username,
          total_earned: Number(r.user.wallet?.total_earned || 0),
          balance: Number(r.user.wallet?.balance || 0),
          package_name: r.package?.name || '—',
        })),
        inventoryItems: inventory.map(i => ({ name: (i.product as any).name, quantity: i.quantity, low: i.low_stock_threshold })),
      },
    })
  } catch (error) {
    console.error('[CITY STATS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
