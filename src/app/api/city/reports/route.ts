import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { resolveCityReportPeriod } from '@/app/lib/city-report-period'
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const selectedPeriod = resolveCityReportPeriod(req.nextUrl.searchParams, 'today')
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

    const [orders, paidOrders, registrationSnapshots, registrationCollections, registrations, packageNames, paymentStatusOrders, adjustmentEvents, branchDeposits] = await Promise.all([
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
        select: { total_amount: true, payment_method: true },
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
      prisma.order.findMany({
        where: {
          seller_id: user.id,
          ...(dateFilter ? { created_at: dateFilter } : {}),
        },
        select: { total_amount: true, payment_status: true, status: true },
      }),
      prisma.inventoryAuditEvent.findMany({
        where: {
          owner_id: user.id,
          event_type: 'physical_count_adjustment',
          ...(dateFilter ? { created_at: dateFilter } : {}),
        },
        select: {
          id: true, quantity_delta: true, total_value: true, reason: true,
          actor_name_snapshot: true, created_at: true, reference_id: true,
        },
        orderBy: { created_at: 'desc' },
      }),
      isBranch && !user.is_staff
        ? prisma.branchCashDeposit.findMany({
            where: { branch_id: user.id, ...(dateFilter ? { deposited_at: dateFilter } : {}) },
            select: {
              id: true, reference_number: true, expected_cash_snapshot: true,
              deposit_amount: true, variance_amount: true, status: true, deposited_at: true,
            },
            orderBy: { deposited_at: 'desc' },
          })
        : Promise.resolve([]),
    ])

    const emptySales = () => ({ orders: 0, units: 0, revenue: 0, cost: 0, profit: 0 })
    const memberSales = emptySales()
    const nonMemberSales = emptySales()
    const productMap = new Map<string, {
      id: string
      name: string
      sale_type: 'member' | 'non_member'
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
      const saleType = order.is_non_member_sale ? 'non_member' as const : 'member' as const
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

        const productSaleKey = `${item.product.id}:${saleType}`
        const current = productMap.get(productSaleKey) || {
          id: item.product.id,
          name: item.product.name,
          sale_type: saleType,
          units: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
        }
        current.units += item.quantity
        current.revenue += revenue
        current.cost += cost
        current.profit += revenue - cost
        productMap.set(productSaleKey, current)
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

    const normalizePaymentMethod = (value: string | null) => {
      const recordedMethod = String(value || 'unclassified').trim().toLowerCase() || 'unclassified'

      // Cash on Pickup is cash received at the counter. Keep the original value
      // on the order, but combine it with walk-in cash in this financial report.
      if (['cash', 'cash_on_pickup'].includes(recordedMethod)) {
        return { method: 'cash', label: 'Cash' }
      }
      if (recordedMethod === 'gcash') return { method: 'gcash', label: 'GCash' }
      if (recordedMethod === 'bank_transfer') return { method: 'bank_transfer', label: 'Bank Transfer' }
      if (recordedMethod === 'unclassified') {
        return { method: 'unclassified', label: 'Payment method not recorded' }
      }

      return {
        method: recordedMethod,
        label: recordedMethod.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase()),
      }
    }
    const paymentMethodMap = new Map<string, { method: string; label: string; amount: number; transactions: number }>()
    for (const order of paidOrders) {
      const normalizedMethod = normalizePaymentMethod(order.payment_method)
      const method = normalizedMethod.method
      const current = paymentMethodMap.get(method) || {
        method,
        label: normalizedMethod.label,
        amount: 0,
        transactions: 0,
      }
      current.amount += Number(order.total_amount || 0)
      current.transactions += 1
      paymentMethodMap.set(method, current)
    }
    if (legacyRegistrationCash > 0) {
      paymentMethodMap.set('registration_unclassified', {
        method: 'registration_unclassified',
        label: 'Registration payments (method not recorded)',
        amount: legacyRegistrationCash,
        transactions: registrationSummary.registrations,
      })
    }

    const activePaymentOrders = paymentStatusOrders.filter((order) => order.status !== 'cancelled')
    const paidPaymentOrders = activePaymentOrders.filter((order) => order.payment_status === 'paid')
    const awaitingPaymentOrders = activePaymentOrders.filter((order) => order.payment_status !== 'paid')
    const cancelledPaymentOrders = paymentStatusOrders.filter((order) => order.status === 'cancelled')
    const paymentStatusSummary = {
      paid: {
        orders: paidPaymentOrders.length,
        amount: paidPaymentOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
      },
      awaiting: {
        orders: awaitingPaymentOrders.length,
        amount: awaitingPaymentOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
      },
      cancelled: {
        orders: cancelledPaymentOrders.length,
        amount: cancelledPaymentOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0),
      },
    }

    const addedAdjustmentEvents = adjustmentEvents.filter((event) => event.quantity_delta > 0)
    const removedAdjustmentEvents = adjustmentEvents.filter((event) => event.quantity_delta < 0)
    const adjustmentSummary = {
      physical_count_events: adjustmentEvents.length,
      units_added: addedAdjustmentEvents.reduce((sum, event) => sum + event.quantity_delta, 0),
      units_removed: removedAdjustmentEvents.reduce((sum, event) => sum + Math.abs(event.quantity_delta), 0),
      net_units: adjustmentEvents.reduce((sum, event) => sum + event.quantity_delta, 0),
      value_added: addedAdjustmentEvents.reduce((sum, event) => sum + Math.abs(Number(event.total_value || 0)), 0),
      value_removed: removedAdjustmentEvents.reduce((sum, event) => sum + Math.abs(Number(event.total_value || 0)), 0),
      net_value_change: adjustmentEvents.reduce((sum, event) => sum + Number(event.total_value || 0), 0),
      events: adjustmentEvents.map((event) => ({ ...event, total_value: Number(event.total_value || 0) })),
      refunds: { supported: false, amount: null, note: 'Refunds and returns do not yet have a separate financial ledger, so no unverified amount is included in this report.' },
    }

    const depositStatuses = ['submitted', 'confirmed', 'verified', 'rejected', 'needs_explanation'] as const
    const depositStatusCounts = Object.fromEntries(depositStatuses.map((status) => [
      status,
      branchDeposits.filter((deposit) => deposit.status === status).length,
    ]))
    const depositSummary = isBranch && !user.is_staff ? {
      records: branchDeposits.length,
      expected_cash: branchDeposits.reduce((sum, deposit) => sum + Number(deposit.expected_cash_snapshot), 0),
      deposited: branchDeposits.reduce((sum, deposit) => sum + Number(deposit.deposit_amount), 0),
      variance: branchDeposits.reduce((sum, deposit) => sum + Number(deposit.variance_amount), 0),
      statuses: depositStatusCounts,
      latest: branchDeposits.slice(0, 5).map((deposit) => ({
        ...deposit,
        expected_cash_snapshot: Number(deposit.expected_cash_snapshot),
        deposit_amount: Number(deposit.deposit_amount),
        variance_amount: Number(deposit.variance_amount),
      })),
    } : null

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
      collections: {
        total: collectedRevenue + legacyRegistrationCash,
        methods: [...paymentMethodMap.values()].sort((a, b) => b.amount - a.amount),
        note: legacyRegistrationCash > 0
          ? 'Registration payment methods are not stored in the current registration ledger and are shown separately as not recorded.'
          : 'Payment methods are based on paid product orders in the selected period.',
      },
      payment_status_summary: paymentStatusSummary,
      adjustments: adjustmentSummary,
      deposit_summary: depositSummary,
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
