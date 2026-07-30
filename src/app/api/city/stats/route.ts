import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const STATS_PERIODS = ['today', 'yesterday', 'this_week', 'this_month', 'this_year', 'all_time', 'custom'] as const
type StatsPeriod = (typeof STATS_PERIODS)[number]
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

function manilaBoundary(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day) - MANILA_OFFSET_MS)
}

function resolveStatsPeriod(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get('period')
  const period: StatsPeriod = STATS_PERIODS.includes(requested as StatsPeriod)
    ? requested as StatsPeriod
    : 'all_time'
  const labels: Record<StatsPeriod, string> = {
    today: 'Today', yesterday: 'Yesterday', this_week: 'This Week',
    this_month: 'This Month', this_year: 'This Year', all_time: 'All Time', custom: 'Custom Range',
  }
  if (period === 'all_time') return { period, label: labels[period], start: null, end: null }

  const now = new Date(Date.now() + MANILA_OFFSET_MS)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = now.getUTCDate()
  if (period === 'custom') {
    const startValue = request.nextUrl.searchParams.get('start')
    const endValue = request.nextUrl.searchParams.get('end')
    const parseDate = (value: string | null) => {
      const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      return match ? manilaBoundary(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
    }
    const start = parseDate(startValue)
    const endDay = parseDate(endValue)
    if (!start || !endDay || endDay < start) return { period: 'all_time' as const, label: 'All Time', start: null, end: null }
    return { period, label: labels[period], start, end: new Date(endDay.getTime() + 24 * 60 * 60 * 1000) }
  }
  if (period === 'today') return { period, label: labels[period], start: manilaBoundary(year, month, day), end: manilaBoundary(year, month, day + 1) }
  if (period === 'yesterday') return { period, label: labels[period], start: manilaBoundary(year, month, day - 1), end: manilaBoundary(year, month, day) }
  if (period === 'this_week') {
    const mondayOffset = (now.getUTCDay() + 6) % 7
    const start = manilaBoundary(year, month, day - mondayOffset)
    return { period, label: labels[period], start, end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) }
  }
  if (period === 'this_month') return { period, label: labels[period], start: manilaBoundary(year, month, 1), end: manilaBoundary(year, month + 1, 1) }
  return { period, label: labels[period], start: manilaBoundary(year, 0, 1), end: manilaBoundary(year + 1, 0, 1) }
}

export async function GET(req: NextRequest) {
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
    const selectedPeriod = resolveStatsPeriod(req)
    const dateFilter = selectedPeriod.start && selectedPeriod.end
      ? { gte: selectedPeriod.start, lt: selectedPeriod.end }
      : undefined
    const inventoryCost = (product: { cost_price: unknown; city_price: unknown; branch_price: unknown }) =>
      isBranch ? Number(product.branch_price) || Number(product.cost_price) : Number(product.city_price) || Number(product.cost_price)

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
      where:  {
        seller_id: user.id,
        status: 'delivered',
        ...(dateFilter ? {
          OR: [
            { delivered_at: dateFilter },
            { delivered_at: null, created_at: dateFilter },
          ],
        } : {}),
      },
      select: {
        is_non_member_sale: true,
        buyer: { select: { role: true } },
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
    const orderProfit = orderRevenue - orderCost

    // Keep product orders separate from package registrations. A product order is
    // revenue for the City Distributor; a package registration also contains a
    // prepaid PIN allocation is excluded from City revenue, cost, and profit.
    const summarizeProductOrders = (orders: typeof deliveredOrders) => orders.reduce(
      (summary, order) => {
        for (const item of order.items) {
          const revenue = Number(item.subtotal || 0)
          const unitCost = item.unit_acquisition_cost == null
            ? inventoryCost(item.product)
            : Number(item.unit_acquisition_cost)
          summary.revenue += revenue
          summary.cost += unitCost * item.quantity
          summary.units += item.quantity
        }
        return summary
      },
      { revenue: 0, cost: 0, profit: 0, units: 0 }
    )
    const resellerProductOrders = summarizeProductOrders(
      deliveredOrders.filter(order => !order.is_non_member_sale && order.buyer.role === 'reseller')
    )
    const walkInProductOrders = summarizeProductOrders(
      deliveredOrders.filter(order => order.is_non_member_sale || order.buyer.role !== 'reseller')
    )
    resellerProductOrders.profit = resellerProductOrders.revenue - resellerProductOrders.cost
    walkInProductOrders.profit = walkInProductOrders.revenue - walkInProductOrders.cost
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
      where: { city_dist_id: user.id, ...(dateFilter ? { created_at: dateFilter } : {}) },
      select: {
        pin_id: true,
        package_id: true,
        customer_payment: true,
        product_acquisition_cost: true,
        reseller_value: true,
        pin_allocation: true,
        registration_profit: true,
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
      registration_profit: Number(row.registration_profit),
    }))
    let ledgerFormulaMismatches = registrationRows.filter((row) =>
      Math.abs(row.registration_profit - (row.reseller_value - row.product_acquisition_cost)) > 0.009
    ).length
    let legacyRegistrationRows = 0
    let unclassifiedUsedPins = 0
    {
      const snapshottedPinIds = new Set(registrationSnapshots.map((row) => row.pin_id))
      const legacyRegistrations = await prisma.pin.findMany({
        where: { city_dist_id: user.id, status: 'used', ...(dateFilter ? { used_at: dateFilter } : {}) },
        select: {
          id: true,
          package_id: true,
          reseller_profile: { select: { user_id: true } },
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
        if (snapshottedPinIds.has(pin.id)) continue
        if (!pin.reseller_profile) {
          unclassifiedUsedPins += 1
          continue
        }
        legacyRegistrationRows += 1
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
          registration_profit: resellerValue - productAcquisitionCost,
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

    // Monthly table: every row is intersected with the selected reporting range.
    const monthlyRevenue: { month: string; revenue: number; resellers: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthStartDate = new Date(d.getFullYear(), d.getMonth(), 1)
      const monthEndDate = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
      const label = d.toLocaleDateString('en-PH', { month: 'short' })
      const start = dateFilter ? new Date(Math.max(monthStartDate.getTime(), dateFilter.gte.getTime())) : monthStartDate
      const end = dateFilter ? new Date(Math.min(monthEndDate.getTime(), dateFilter.lt.getTime() - 1)) : monthEndDate
      if (end < start) {
        monthlyRevenue.push({ month: label, revenue: 0, resellers: 0 })
        continue
      }
      const mItems = await prisma.orderItem.findMany({
        where: {
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
        month: label,
        revenue: mItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0),
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

    const registrationProductProfit = packageRevenue - packageCost
    const combinedProductRevenue = orderRevenue + packageRevenue
    const combinedProductCost = orderCost + packageCost
    const combinedProductProfit = orderProfit + registrationProductProfit
    const totalCustomerCashCollected = orderRevenue + packageCustomerPayments
    // Legacy aliases retained for existing dashboard consumers. They refer only
    // to recognized product value and must not be presented as total cash collected.
    const totalRevenue = combinedProductRevenue
    const totalCost = combinedProductCost
    const totalProfit = combinedProductProfit
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
        financialIntegrity: {
          ledger_rows: registrationSnapshots.length,
          legacy_reconstructed_rows: legacyRegistrationRows,
          unclassified_used_pins: unclassifiedUsedPins,
          ledger_formula_mismatches: ledgerFormulaMismatches,
        },
        period: {
          value: selectedPeriod.period,
          label: selectedPeriod.label,
          start: selectedPeriod.start?.toISOString() || null,
          end: selectedPeriod.end?.toISOString() || null,
        },
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
        orderProfit,
        orderUnitsSold,
        resellerProductOrders,
        walkInProductOrders,
        registrationCount: registrationRows.length,
        packageRevenue,
        packageCost,
        packagePinRemittance,
        packageCustomerPayments,
        packageUnitsSold,
        registrationProductProfit,
        combinedProductRevenue,
        combinedProductCost,
        combinedProductProfit,
        totalCustomerCashCollected,
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
