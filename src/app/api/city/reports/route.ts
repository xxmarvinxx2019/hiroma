import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const REPORT_PERIODS = ['today', 'yesterday', 'this_week', 'this_month', 'this_year', 'all_time', 'custom'] as const
type ReportPeriod = (typeof REPORT_PERIODS)[number]

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

function manilaBoundary(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day) - MANILA_OFFSET_MS)
}

function resolveReportPeriod(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get('period')
  const period: ReportPeriod = REPORT_PERIODS.includes(requested as ReportPeriod)
    ? requested as ReportPeriod
    : 'today'
  const labels: Record<ReportPeriod, string> = {
    today: 'Today', yesterday: 'Yesterday', this_week: 'This Week',
    this_month: 'This Month', this_year: 'This Year', all_time: 'All Time', custom: 'Custom Range',
  }
  if (period === 'all_time') return { period, label: labels[period], start: null, end: null }

  const manilaNow = new Date(Date.now() + MANILA_OFFSET_MS)
  const year = manilaNow.getUTCFullYear()
  const month = manilaNow.getUTCMonth()
  const day = manilaNow.getUTCDate()
  if (period === 'custom') {
    const parseDate = (value: string | null) => {
      const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      return match ? manilaBoundary(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
    }
    const start = parseDate(request.nextUrl.searchParams.get('start'))
    const endDay = parseDate(request.nextUrl.searchParams.get('end'))
    if (!start || !endDay || endDay < start) return { period: 'all_time' as const, label: 'All Time', start: null, end: null }
    return { period, label: labels[period], start, end: new Date(endDay.getTime() + 24 * 60 * 60 * 1000) }
  }
  if (period === 'today') return { period, label: labels[period], start: manilaBoundary(year, month, day), end: manilaBoundary(year, month, day + 1) }
  if (period === 'yesterday') return { period, label: labels[period], start: manilaBoundary(year, month, day - 1), end: manilaBoundary(year, month, day) }
  if (period === 'this_week') {
    const mondayOffset = (manilaNow.getUTCDay() + 6) % 7
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

    const selectedPeriod = resolveReportPeriod(req)
    const dateFilter = selectedPeriod.start && selectedPeriod.end
      ? { gte: selectedPeriod.start, lt: selectedPeriod.end }
      : undefined
    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true, coverage_area: true },
    })
    const isBranch = profile?.dist_level === 'branch'
    let registrationLedgerAvailable = true
    const acquisitionCost = (product: {
      cost_price: unknown
      city_price: unknown
      branch_price: unknown
    }) => isBranch
      ? Number(product.branch_price) || Number(product.cost_price)
      : Number(product.city_price) || Number(product.cost_price)

    const [orders, paidOrders, registrationSnapshots, registrationCollections, registrations, packageNames] = await Promise.all([
      prisma.order.findMany({
        where: {
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
          id: true,
          created_at: true,
          delivered_at: true,
          total_amount: true,
          payment_status: true,
          is_non_member_sale: true,
          items: {
            select: {
              quantity: true,
              subtotal: true,
              unit_acquisition_cost: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  cost_price: true,
                  city_price: true,
                  branch_price: true,
                },
              },
            },
          },
        },
        orderBy: { delivered_at: 'asc' },
      }),
      prisma.order.findMany({
        where: {
          seller_id: user.id,
          payment_status: 'paid',
          ...(dateFilter ? {
            OR: [
              { paid_at: dateFilter },
              { paid_at: null, created_at: dateFilter },
            ],
          } : {}),
        },
        select: { total_amount: true },
      }),
      prisma.registrationFinancial.findMany({
        where: {
          city_dist_id: user.id,
          ...(dateFilter ? { created_at: dateFilter } : {}),
        },
        select: {
          pin_id: true,
          package_id: true,
          customer_payment: true,
          product_acquisition_cost: true,
          reseller_value: true,
          pin_allocation: true,
          registration_profit: true,
          payment_status: true,
          paid_at: true,
        },
      }).catch((error) => {
        registrationLedgerAvailable = false
        console.warn('[CITY REPORTS] Registration ledger unavailable; using legacy PIN calculations.', error)
        return []
      }),
      prisma.registrationFinancial.findMany({
        where: {
          city_dist_id: user.id,
          payment_status: 'paid',
          ...(dateFilter ? {
            OR: [
              { paid_at: dateFilter },
              { paid_at: null, created_at: dateFilter },
            ],
          } : {}),
        },
        select: { customer_payment: true },
      }).catch(() => []),
      prisma.pin.findMany({
        where: {
          city_dist_id: user.id,
          status: 'used',
          ...(dateFilter ? { used_at: dateFilter } : {}),
        },
        select: {
          id: true,
          used_at: true,
          reseller_profile: { select: { user_id: true } },
          package: {
            select: {
              id: true,
              name: true,
              price: true,
              products: {
                select: {
                  quantity: true,
                  product: {
                    select: {
                      cost_price: true,
                      city_price: true,
                      branch_price: true,
                      price: true,
                      reseller_price: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.package.findMany({ select: { id: true, name: true } }),
    ])

    const emptySales = () => ({ orders: 0, units: 0, revenue: 0, cost: 0, profit: 0 })
    const memberSales = emptySales()
    const nonMemberSales = emptySales()
    const productMap = new Map<string, {
      id: string
      name: string
      units: number
      revenue: number
      cost: number
      profit: number
    }>()
    const collectedRevenue = paidOrders.reduce(
      (sum, order) => sum + Number(order.total_amount || 0),
      0
    )
    let outstandingRevenue = 0

    for (const order of orders) {
      const bucket = order.is_non_member_sale ? nonMemberSales : memberSales
      bucket.orders += 1
      const orderRevenue = Number(order.total_amount || 0)
      if (order.payment_status !== 'paid') outstandingRevenue += orderRevenue

      for (const item of order.items) {
        const revenue = Number(item.subtotal || 0)
        const historicalUnitCost = item.unit_acquisition_cost == null
          ? acquisitionCost(item.product)
          : Number(item.unit_acquisition_cost)
        const cost = historicalUnitCost * item.quantity
        bucket.units += item.quantity
        bucket.revenue += revenue
        bucket.cost += cost
        bucket.profit += revenue - cost

        const current = productMap.get(item.product.id) || {
          id: item.product.id,
          name: item.product.name,
          units: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        }
        current.units += item.quantity
        current.revenue += revenue
        current.cost += cost
        current.profit += revenue - cost
        productMap.set(item.product.id, current)
      }
    }

    let ledgerFormulaMismatches = 0
    let legacyReconstructedRows = 0
    let unclassifiedUsedPins = 0
    const packageMap = new Map<string, {
      id: string
      name: string
      registrations: number
      customer_payment: number
      revenue: number
      cost: number
      acquisition_cost: number
      pin_allocation: number
      reseller_value: number
      profit: number
    }>()
    const packageNameMap = new Map(packageNames.map((pkg) => [pkg.id, pkg.name]))
    for (const snapshot of registrationSnapshots) {
      const current = packageMap.get(snapshot.package_id) || {
        id: snapshot.package_id,
        name: packageNameMap.get(snapshot.package_id) || 'Package',
        registrations: 0,
        customer_payment: 0,
        revenue: 0,
        cost: 0,
        acquisition_cost: 0,
        pin_allocation: 0,
        reseller_value: 0,
        profit: 0,
      }
      current.registrations += 1
      current.customer_payment += Number(snapshot.customer_payment)
      current.revenue += Number(snapshot.reseller_value)
      current.acquisition_cost += Number(snapshot.product_acquisition_cost)
      current.pin_allocation += Number(snapshot.pin_allocation)
      current.reseller_value += Number(snapshot.reseller_value)
      current.cost += Number(snapshot.product_acquisition_cost)
      const calculatedProfit = Number(snapshot.reseller_value) - Number(snapshot.product_acquisition_cost)
      if (Math.abs(Number(snapshot.registration_profit) - calculatedProfit) > 0.009) ledgerFormulaMismatches += 1
      current.profit += calculatedProfit
      packageMap.set(snapshot.package_id, current)
    }
    const snapshottedPinIds = new Set(registrationSnapshots.map((snapshot) => snapshot.pin_id))
    for (const pin of registrations) {
      if (snapshottedPinIds.has(pin.id)) continue
      if (!pin.reseller_profile) {
        unclassifiedUsedPins += 1
        continue
      }
      legacyReconstructedRows += 1
      const revenue = pin.package.products.reduce(
        (sum, item) => sum + Number(item.product.price || 0) * item.quantity,
        0
      )
      const resellerValue = pin.package.products.reduce(
        (sum, item) => sum + (Number(item.product.reseller_price) || Number(item.product.price)) * item.quantity,
        0
      )
      const productAcquisitionCost = pin.package.products.reduce(
        (sum, item) => sum + acquisitionCost(item.product) * item.quantity,
        0
      )
      const pinAllocation = Math.max(0, revenue - resellerValue)
      const current = packageMap.get(pin.package.id) || {
        id: pin.package.id,
        name: pin.package.name,
        registrations: 0,
        customer_payment: 0,
        revenue: 0,
        cost: 0,
        acquisition_cost: 0,
        pin_allocation: 0,
        reseller_value: 0,
        profit: 0,
      }
      current.registrations += 1
      current.customer_payment += revenue
      current.revenue += resellerValue
      current.cost += productAcquisitionCost
      current.acquisition_cost += productAcquisitionCost
      current.pin_allocation += pinAllocation
      current.reseller_value += resellerValue
      current.profit += resellerValue - productAcquisitionCost
      packageMap.set(pin.package.id, current)
    }

    const registrationSummary = [...packageMap.values()].reduce(
      (summary, row) => ({
        registrations: summary.registrations + row.registrations,
        customer_payment: summary.customer_payment + row.customer_payment,
        revenue: summary.revenue + row.revenue,
        cost: summary.cost + row.cost,
        acquisition_cost: summary.acquisition_cost + row.acquisition_cost,
        pin_allocation: summary.pin_allocation + row.pin_allocation,
        reseller_value: summary.reseller_value + row.reseller_value,
        profit: summary.profit + row.profit,
      }),
      {
        registrations: 0,
        customer_payment: 0,
        revenue: 0,
        cost: 0,
        acquisition_cost: 0,
        pin_allocation: 0,
        reseller_value: 0,
        profit: 0,
      }
    )
    const productRevenue = memberSales.revenue + nonMemberSales.revenue
    const productCost = memberSales.cost + nonMemberSales.cost
    const productProfit = memberSales.profit + nonMemberSales.profit
    let collectedRegistrationCash = 0
    for (const row of registrationCollections) {
      collectedRegistrationCash += Number(row.customer_payment || 0)
    }
    const legacyRegistrationCash = registrationLedgerAvailable
      ? collectedRegistrationCash
      : registrationSummary.customer_payment

    return NextResponse.json({
      account: {
        type: isBranch ? 'branch' : 'city',
        coverage_area: profile?.coverage_area || '',
      },
      period: {
        value: selectedPeriod.period,
        label: selectedPeriod.label,
        start: selectedPeriod.start?.toISOString() || null,
        end: selectedPeriod.end?.toISOString() || null,
      },
      liquidation: {
        gross_revenue: productRevenue + registrationSummary.revenue,
        total_cost: productCost + registrationSummary.cost,
        net_profit: productProfit + registrationSummary.profit,
        collected_cash_total: collectedRevenue + legacyRegistrationCash,
        collected_product_cash: collectedRevenue,
        collected_registration_cash: legacyRegistrationCash,
        outstanding_product_sales: outstandingRevenue,
        total_orders: orders.length,
        total_units: memberSales.units + nonMemberSales.units,
      },
      member_sales: memberSales,
      non_member_sales: nonMemberSales,
      registrations: registrationSummary,
      financial_integrity: {
        ledger_rows: registrationSnapshots.length,
        legacy_reconstructed_rows: legacyReconstructedRows,
        unclassified_used_pins: unclassifiedUsedPins,
        ledger_formula_mismatches: ledgerFormulaMismatches,
      },
      products: [...productMap.values()].sort((a, b) => b.revenue - a.revenue),
      packages: [...packageMap.values()].sort((a, b) => b.revenue - a.revenue),
      notes: {
        sales_basis: 'Orders delivered within the selected period',
        collection_basis: 'Product and registration payments collected within the selected period',
        registration_basis: 'City/Branch product revenue is reseller value; PIN allocation was prepaid when the PIN was purchased, is consumed on registration, and is not City/Branch revenue, cost, or profit',
        cost_basis: `Historical ${isBranch ? 'Branch' : 'City Distributor'} acquisition price captured when each order was created`,
        registration_data_source: registrationLedgerAvailable
          ? 'Financial ledger snapshots'
          : 'Legacy used-PIN records calculated from current configured prices',
      },
    })
  } catch (error) {
    console.error('[CITY REPORTS ERROR]', error)
    return NextResponse.json({ error: 'Unable to generate the report.' }, { status: 500 })
  }
}
