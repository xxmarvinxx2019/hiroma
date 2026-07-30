import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const BINARY_POINT_TO_PESO = 0.5
const commissionTypes = ['direct_referral', 'binary_pairing', 'multilevel'] as const
const MANILA_OFFSET = '+08:00'

type ReportRange = 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'this_year' | 'previous_year' | 'custom'

type BinaryMovement = {
  allocation: number
  paid_to_members: number
  flushout_to_hiroma: number
  remaining_reserve: number
}

type AllocationGroup = {
  binary_commission_allocation: number
  allocation_snapshot_source: string
  registrations: number
}

type DirectRegistration = {
  reseller_id: string
  package_id: string
  customer_payment: number
  product_acquisition_cost: number
  reseller_value: number
  pin_allocation: number
  package_name_snapshot: string
  direct_referral_allocation: number
  binary_commission_allocation: number
  allocation_snapshot_source: string
  created_at: Date
}

type PayoutFunding = {
  commission_id: string
  funded_amount: number
  unfunded_amount: number
  funded_from_selected_period: number
  funded_from_older_reserve: number
  source_lots: number
  oldest_reserve_at: Date | null
  funding_sources: string | null
}

type OutstandingReserveLot = {
  registration_financial_id: string
  source_reseller: string
  source_username: string
  package_name: string
  original_amount: number
  remaining_amount: number
  allocated_at: Date
  age_days: number
  snapshot_source: string
}

type OutstandingReserveSummary = {
  total_available: number
  lot_count: number
}

type NewPackageReserveAllocation = {
  registration_financial_id: string
  source_reseller: string
  source_username: string
  package_name: string
  allocated_amount: number
  current_remaining_amount: number
  allocated_at: Date
  reserve_lot_created: boolean
}

function toNumber(value: unknown) {
  return Number(value || 0)
}

function dateKeyInManila(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

function mondayFor(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return shiftDateKey(dateKey, weekday === 0 ? -6 : 1 - weekday)
}

function monthStart(dateKey: string) { return `${dateKey.slice(0, 7)}-01` }
function monthEnd(dateKey: string) { return shiftDateKey(shiftDateKey(monthStart(dateKey), 32).slice(0, 7) + '-01', -1) }
function dateBoundary(dateKey: string, end = false) { return new Date(`${dateKey}T${end ? '23:59:59.999' : '00:00:00.000'}${MANILA_OFFSET}`) }

function resolvePeriod(searchParams: URLSearchParams) {
  const requested = searchParams.get('range') || 'this_month'
  const range: ReportRange = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'previous_year', 'custom'].includes(requested)
    ? requested as ReportRange
    : 'this_month'
  const today = dateKeyInManila(new Date())
  let from = today
  let to = today
  let label = 'Today'

  if (range === 'yesterday') { from = to = shiftDateKey(today, -1); label = 'Yesterday' }
  if (range === 'this_week') { from = mondayFor(today); to = shiftDateKey(from, 6); label = 'This Week' }
  if (range === 'last_week') { to = shiftDateKey(mondayFor(today), -1); from = shiftDateKey(to, -6); label = 'Last Week' }
  if (range === 'this_month') { from = monthStart(today); to = monthEnd(today); label = 'This Month' }
  if (range === 'last_month') { to = shiftDateKey(monthStart(today), -1); from = monthStart(to); label = 'Last Month' }
  if (range === 'this_year') { from = `${today.slice(0, 4)}-01-01`; to = `${today.slice(0, 4)}-12-31`; label = 'This Year' }
  if (range === 'previous_year') { const year = Number(today.slice(0, 4)) - 1; from = `${year}-01-01`; to = `${year}-12-31`; label = 'Previous Year' }
  if (range === 'custom') {
    const customFrom = searchParams.get('from') || ''
    const customTo = searchParams.get('to') || ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(customTo) || customFrom > customTo) {
      throw new Error('Choose a valid custom start and end date.')
    }
    from = customFrom; to = customTo; label = 'Custom Range'
  }
  return { range, label, from, to, since: dateBoundary(from), until: dateBoundary(to, true) }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const selectedPeriod = resolvePeriod(req.nextUrl.searchParams)
    const { since, until } = selectedPeriod
    const period = { gte: since, lte: until }

    const [allAllocationGroups, periodAllocationGroups, profiles, binaryAll, binaryPeriod] = await Promise.all([
      prisma.$queryRaw<AllocationGroup[]>`
        SELECT
          "binary_commission_allocation"::float AS binary_commission_allocation,
          "allocation_snapshot_source",
          COUNT(*)::int AS registrations
        FROM "registration_financials"
        GROUP BY "binary_commission_allocation", "allocation_snapshot_source"
      `,
      prisma.$queryRaw<AllocationGroup[]>`
        SELECT
          "binary_commission_allocation"::float AS binary_commission_allocation,
          "allocation_snapshot_source",
          COUNT(*)::int AS registrations
        FROM "registration_financials"
        WHERE "created_at" >= ${since} AND "created_at" <= ${until}
        GROUP BY "binary_commission_allocation", "allocation_snapshot_source"
      `,
      prisma.resellerProfile.findMany({
        select: {
          left_points: true,
          right_points: true,
          package: { select: { name: true, pairing_bonus_value: true } },
        },
      }),
      prisma.commission.groupBy({
        by: ['is_pair_overflow'],
        where: { type: 'binary_pairing' },
        _sum: { amount: true },
      }),
      prisma.commission.groupBy({
        by: ['is_pair_overflow'],
        where: { type: 'binary_pairing', created_at: period },
        _sum: { amount: true },
      }),
    ])

    const allocationFor = (groups: AllocationGroup[]) => groups.reduce(
      (total, group) => total + toNumber(group.registrations) * toNumber(group.binary_commission_allocation),
      0
    )
    const qualityFor = (groups: AllocationGroup[]) => groups.reduce((total, group) => {
      const count = toNumber(group.registrations)
      if (group.allocation_snapshot_source === 'registration') total.exact_registrations += count
      else total.estimated_legacy_registrations += count
      return total
    }, { exact_registrations: 0, estimated_legacy_registrations: 0 })
    const movementsFor = (allocation: number, rows: typeof binaryAll): BinaryMovement => {
      const paid = toNumber(rows.find((row) => !row.is_pair_overflow)?._sum.amount)
      const flushout = toNumber(rows.find((row) => row.is_pair_overflow)?._sum.amount)
      return { allocation, paid_to_members: paid, flushout_to_hiroma: flushout, remaining_reserve: allocation - paid - flushout }
    }

    // These are only registrations personally completed by the Admin account.
    // City registrations are intentionally excluded because their product margin belongs to City.
    const registrations = await prisma.$queryRaw<DirectRegistration[]>`
      SELECT
        "reseller_id"::text AS reseller_id,
        "package_id"::text AS package_id,
        "customer_payment"::float AS customer_payment,
        "product_acquisition_cost"::float AS product_acquisition_cost,
        "reseller_value"::float AS reseller_value,
        "pin_allocation"::float AS pin_allocation,
        "package_name_snapshot",
        "direct_referral_allocation"::float AS direct_referral_allocation,
        "binary_commission_allocation"::float AS binary_commission_allocation,
        "allocation_snapshot_source",
        "created_at"
      FROM "registration_financials"
      WHERE "city_dist_id"::text = ${user.id}
        AND "created_at" >= ${since} AND "created_at" <= ${until}
    `

    const resellerIds = registrations.map((registration) => registration.reseller_id)
    const commissions = resellerIds.length
      ? await prisma.commission.groupBy({
          by: ['source_user_id', 'type'],
          where: { source_user_id: { in: resellerIds }, type: { in: [...commissionTypes] }, is_pair_overflow: false, created_at: period },
          _sum: { amount: true },
        })
      : []
    const binaryPayoutEvents = resellerIds.length
      ? await prisma.commission.findMany({
          where: {
            source_user_id: { in: resellerIds },
            type: 'binary_pairing',
            is_pair_overflow: false,
            created_at: period,
          },
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            amount: true,
            points: true,
            created_at: true,
            source_user_id: true,
            source_user: { select: { full_name: true, username: true } },
            user: {
              select: {
                full_name: true,
                username: true,
                reseller_profile: { select: { package: { select: { name: true } } } },
              },
            },
          },
        })
      : []
    const [payoutFundingRows, newPackageReserveAllocations, outstandingReserveLots, outstandingReserveSummary, allTimeReserveSummary] = await Promise.all([
      prisma.$queryRaw<PayoutFunding[]>`
        SELECT
          c."id" AS commission_id,
          COALESCE(SUM(rc."amount") FILTER (WHERE rc."is_unfunded" = false), 0)::float AS funded_amount,
          COALESCE(SUM(rc."amount") FILTER (WHERE rc."is_unfunded" = true), 0)::float AS unfunded_amount,
          COALESCE(SUM(rc."amount") FILTER (
            WHERE rc."is_unfunded" = false
              AND lot."allocated_at" >= ${since} AND lot."allocated_at" <= ${until}
          ), 0)::float AS funded_from_selected_period,
          COALESCE(SUM(rc."amount") FILTER (
            WHERE rc."is_unfunded" = false
              AND (lot."allocated_at" < ${since} OR lot."allocated_at" > ${until})
          ), 0)::float AS funded_from_older_reserve,
          COUNT(DISTINCT rc."reserve_lot_id") FILTER (WHERE rc."reserve_lot_id" IS NOT NULL)::int AS source_lots,
          MIN(lot."allocated_at") FILTER (WHERE lot."id" IS NOT NULL) AS oldest_reserve_at,
          STRING_AGG(DISTINCT CONCAT(COALESCE(funding_user."full_name", 'Unknown'), ' / ', funding_rf."package_name_snapshot", ' / ', TO_CHAR(lot."allocated_at", 'YYYY-MM-DD')), ' | ')
            FILTER (WHERE lot."id" IS NOT NULL) AS funding_sources
        FROM "commissions" c
        INNER JOIN "registration_financials" trigger_rf ON trigger_rf."reseller_id"::text = c."source_user_id"::text
        LEFT JOIN "binary_reserve_consumptions" rc ON rc."commission_id" = c."id"
        LEFT JOIN "binary_reserve_lots" lot ON lot."id" = rc."reserve_lot_id"
        LEFT JOIN "registration_financials" funding_rf ON funding_rf."id" = lot."registration_financial_id"
        LEFT JOIN "users" funding_user ON funding_user."id" = funding_rf."reseller_id"
        WHERE c."type" = 'binary_pairing'
          AND c."is_pair_overflow" = false
          AND trigger_rf."city_dist_id"::text = ${user.id}
          AND trigger_rf."created_at" >= ${since} AND trigger_rf."created_at" <= ${until}
          AND c."created_at" >= ${since} AND c."created_at" <= ${until}
        GROUP BY c."id"
        ORDER BY MIN(c."created_at") DESC
      `,
      prisma.$queryRaw<NewPackageReserveAllocation[]>`
        SELECT
          rf."id"::text AS registration_financial_id,
          COALESCE(u."full_name", 'Unknown reseller') AS source_reseller,
          COALESCE(u."username", 'â€”') AS source_username,
          rf."package_name_snapshot" AS package_name,
          rf."binary_commission_allocation"::float AS allocated_amount,
          COALESCE(lot."remaining_amount", 0)::float AS current_remaining_amount,
          rf."created_at" AS allocated_at,
          (lot."id" IS NOT NULL) AS reserve_lot_created
        FROM "registration_financials" rf
        LEFT JOIN "users" u ON u."id" = rf."reseller_id"
        LEFT JOIN "binary_reserve_lots" lot ON lot."registration_financial_id" = rf."id"
        WHERE rf."city_dist_id"::text = ${user.id}
          AND rf."created_at" >= ${since} AND rf."created_at" <= ${until}
        ORDER BY rf."created_at" DESC, rf."id" DESC
      `,
      prisma.$queryRaw<OutstandingReserveLot[]>`
        SELECT
          rf."id"::text AS registration_financial_id,
          COALESCE(u."full_name", 'Unknown reseller') AS source_reseller,
          COALESCE(u."username", '—') AS source_username,
          rf."package_name_snapshot" AS package_name,
          lot."original_amount"::float AS original_amount,
          lot."remaining_amount"::float AS remaining_amount,
          lot."allocated_at",
          GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - lot."allocated_at")) / 86400))::int AS age_days,
          lot."snapshot_source"
        FROM "binary_reserve_lots" lot
        INNER JOIN "registration_financials" rf ON rf."id" = lot."registration_financial_id"
        LEFT JOIN "users" u ON u."id" = rf."reseller_id"
        WHERE lot."remaining_amount" > 0
          AND lot."allocated_at" >= ${since} AND lot."allocated_at" <= ${until}
        ORDER BY lot."allocated_at" ASC, lot."id" ASC
        LIMIT 100
      `,
      prisma.$queryRaw<OutstandingReserveSummary[]>`
        SELECT
          COALESCE(SUM("remaining_amount"), 0)::float AS total_available,
          COUNT(*)::int AS lot_count
        FROM "binary_reserve_lots"
        WHERE "remaining_amount" > 0
          AND "allocated_at" >= ${since} AND "allocated_at" <= ${until}
      `,
      prisma.$queryRaw<OutstandingReserveSummary[]>`
        SELECT
          COALESCE(SUM("remaining_amount"), 0)::float AS total_available,
          COUNT(*)::int AS lot_count
        FROM "binary_reserve_lots"
        WHERE "remaining_amount" > 0
      `,
    ])

    const payoutsByReseller = new Map<string, { direct: number; binary: number; multilevel: number }>()
    for (const commission of commissions) {
      if (!commission.source_user_id) continue
      const current = payoutsByReseller.get(commission.source_user_id) || { direct: 0, binary: 0, multilevel: 0 }
      const amount = toNumber(commission._sum.amount)
      if (commission.type === 'direct_referral') current.direct += amount
      if (commission.type === 'binary_pairing') current.binary += amount
      if (commission.type === 'multilevel') current.multilevel += amount
      payoutsByReseller.set(commission.source_user_id, current)
    }

    const byPackage = new Map<string, {
      package_name: string; registrations: number; customer_cash: number; product_allocation: number; source_cost: number
      pin_allocation: number; direct: number; binary: number; multilevel: number; planned_direct: number; planned_binary: number
    }>()
    for (const registration of registrations) {
      const current = byPackage.get(registration.package_id) || {
        package_name: registration.package_name_snapshot || 'Package', registrations: 0, customer_cash: 0, product_allocation: 0, source_cost: 0,
        pin_allocation: 0, direct: 0, binary: 0, multilevel: 0, planned_direct: 0, planned_binary: 0,
      }
      const payout = payoutsByReseller.get(registration.reseller_id) || { direct: 0, binary: 0, multilevel: 0 }
      current.registrations += 1
      current.customer_cash += toNumber(registration.customer_payment)
      current.product_allocation += toNumber(registration.reseller_value)
      current.source_cost += toNumber(registration.product_acquisition_cost)
      current.pin_allocation += toNumber(registration.pin_allocation)
      current.direct += payout.direct
      current.binary += payout.binary
      current.multilevel += payout.multilevel
      current.planned_direct += toNumber(registration.direct_referral_allocation)
      current.planned_binary += toNumber(registration.binary_commission_allocation)
      byPackage.set(registration.package_id, current)
    }

    const packageRows = [...byPackage.values()].map((row) => {
      const commission_expense = row.direct + row.binary + row.multilevel
      const planned_mlm = row.planned_direct + row.planned_binary
      return {
        ...row,
        product_margin: row.product_allocation - row.source_cost,
        gross_before_mlm: row.customer_cash - row.source_cost,
        planned_mlm,
        planned_net_profit: row.customer_cash - row.source_cost - planned_mlm,
        commission_expense,
        net_profit: row.customer_cash - row.source_cost - commission_expense,
      }
    }).sort((a, b) => b.planned_net_profit - a.planned_net_profit)

    const total = packageRows.reduce((sum, row) => {
      for (const key of Object.keys(sum) as Array<keyof typeof sum>) sum[key] += row[key] as never
      return sum
    }, {
      registrations: 0, customer_cash: 0, product_allocation: 0, source_cost: 0, pin_allocation: 0, direct: 0, binary: 0,
      multilevel: 0, planned_direct: 0, planned_binary: 0, product_margin: 0, gross_before_mlm: 0, planned_mlm: 0,
      planned_net_profit: 0, commission_expense: 0, net_profit: 0,
    })

    const registrationByReseller = new Map(registrations.map((registration) => [registration.reseller_id, registration]))
    const fundingByCommission = new Map(payoutFundingRows.map((funding) => [funding.commission_id, funding]))
    const binaryPayoutTrace = binaryPayoutEvents.map((event) => {
      const registration = event.source_user_id ? registrationByReseller.get(event.source_user_id) : undefined
      const funding = fundingByCommission.get(event.id)
      const registeredAt = registration?.created_at ? new Date(registration.created_at) : null
      const paidAt = new Date(event.created_at)
      const daysAfterRegistration = registeredAt
        ? Math.max(0, Math.floor((paidAt.getTime() - registeredAt.getTime()) / (1000 * 60 * 60 * 24)))
        : null
      return {
        id: event.id,
        source_reseller: event.source_user?.full_name || 'Unknown reseller',
        source_username: event.source_user?.username || '—',
        source_package: registration?.package_name_snapshot || 'Unknown package',
        registered_at: registeredAt?.toISOString() || null,
        recipient: event.user.full_name,
        recipient_username: event.user.username,
        recipient_package: event.user.reseller_profile?.package?.name || 'No reseller package',
        paid_at: paidAt.toISOString(),
        days_after_registration: daysAfterRegistration,
        points: toNumber(event.points),
        amount: toNumber(event.amount),
        funded_amount: toNumber(funding?.funded_amount),
        unfunded_amount: toNumber(funding?.unfunded_amount),
        funded_from_selected_period: toNumber(funding?.funded_from_selected_period),
        funded_from_older_reserve: toNumber(funding?.funded_from_older_reserve),
        source_lots: toNumber(funding?.source_lots),
        oldest_reserve_at: funding?.oldest_reserve_at ? new Date(funding.oldest_reserve_at).toISOString() : null,
        funding_sources: funding?.funding_sources || null,
      }
    })
    const payoutTraceTotals = binaryPayoutTrace.reduce((sum, event) => {
      sum.paid += event.amount
      sum.funded += event.funded_amount
      sum.unfunded += event.unfunded_amount
      sum.from_selected_period += event.funded_from_selected_period
      sum.from_older_reserve += event.funded_from_older_reserve
      return sum
    }, { paid: 0, funded: 0, unfunded: 0, from_selected_period: 0, from_older_reserve: 0 })
    const newPackageReserveTotals = newPackageReserveAllocations.reduce((sum, allocation) => {
      sum.allocated += toNumber(allocation.allocated_amount)
      sum.current_remaining += toNumber(allocation.current_remaining_amount)
      if (!allocation.reserve_lot_created) sum.missing_lot_count += 1
      return sum
    }, { allocated: 0, current_remaining: 0, missing_lot_count: 0 })

    const directOrders = await prisma.order.findMany({
      where: { seller_id: user.id, status: 'delivered', created_at: period },
      select: { total_amount: true, items: { select: { quantity: true, unit_acquisition_cost: true, product: { select: { cost_price: true } } } } },
    })
    const productOrders = directOrders.reduce((sum, order) => {
      sum.revenue += toNumber(order.total_amount)
      for (const item of order.items) {
        sum.units += item.quantity
        sum.cost += toNumber(item.unit_acquisition_cost ?? item.product.cost_price) * item.quantity
      }
      return sum
    }, { orders: directOrders.length, units: 0, revenue: 0, cost: 0 })

    const cityRegistrations = await prisma.registrationFinancial.aggregate({
      where: { city_dist_id: { not: user.id }, created_at: period },
      _sum: { customer_payment: true, pin_allocation: true, registration_profit: true },
      _count: { id: true },
    })

    let leftPoints = 0
    let rightPoints = 0
    let matchedPointsWaiting = 0
    let potentialPayable = 0
    for (const profile of profiles) {
      const left = toNumber(profile.left_points)
      const right = toNumber(profile.right_points)
      const pointsPerPair = toNumber(profile.package.pairing_bonus_value)
      leftPoints += left
      rightPoints += right
      const matchable = Math.min(left, right)
      matchedPointsWaiting += matchable * 2
      if (pointsPerPair > 0) potentialPayable += Math.floor(matchable / pointsPerPair) * pointsPerPair * BINARY_POINT_TO_PESO
    }

    return NextResponse.json({
      period: { range: selectedPeriod.range, label: selectedPeriod.label, from: selectedPeriod.from, to: selectedPeriod.to, since: since.toISOString(), until: until.toISOString() },
      direct_registration: total,
      package_rows: packageRows,
      binary_reserve: {
        all_time: movementsFor(allocationFor(allAllocationGroups), binaryAll),
        selected_period: movementsFor(allocationFor(periodAllocationGroups), binaryPeriod),
        note: 'Reserve is immutable package binary allocation less normal binary payouts and binary flushout. New registrations save their exact allocation at registration time.',
      },
      ledger_quality: qualityFor(allAllocationGroups),
      binary_payout_trace: {
        planned_binary_allocation: total.planned_binary,
        actual_binary_paid: payoutTraceTotals.paid,
        funded_from_selected_period: payoutTraceTotals.from_selected_period,
        funded_from_older_reserve: payoutTraceTotals.from_older_reserve,
        unfunded_amount: payoutTraceTotals.unfunded,
        event_count: binaryPayoutEvents.length,
        events: binaryPayoutTrace,
        note: 'Exact reconciliation: payout rows total = funding from selected-period reserve lots + funding from older reserve lots + any unfunded amount. Package allocation is reserve added by these registrations; FIFO may use older lots first.',
      },
      new_package_reserve_allocations: {
        allocations: newPackageReserveAllocations.map((allocation) => ({
          ...allocation,
          allocated_amount: toNumber(allocation.allocated_amount),
          current_remaining_amount: toNumber(allocation.current_remaining_amount),
          allocated_at: new Date(allocation.allocated_at).toISOString(),
        })),
        ...newPackageReserveTotals,
        note: 'Admin-direct registrations only. One row per reseller registered directly by Hiroma/Admin in the selected period. This is reserve set aside for future binary events, not an additional payment.',
      },
      outstanding_binary_reserve: {
        selected_period_available: toNumber(outstandingReserveSummary[0]?.total_available),
        selected_period_lot_count: toNumber(outstandingReserveSummary[0]?.lot_count),
        all_time_available: toNumber(allTimeReserveSummary[0]?.total_available),
        all_time_lot_count: toNumber(allTimeReserveSummary[0]?.lot_count),
        lots: outstandingReserveLots,
        note: 'The table only shows reserve lots allocated in the selected period. All-time available reserve includes older lots that remain unspent. Neither amount is the same as unmatched carryover points.',
      },
      unmatched_points: {
        left_points: leftPoints,
        right_points: rightPoints,
        total_points: leftPoints + rightPoints,
        cash_equivalent: (leftPoints + rightPoints) * BINARY_POINT_TO_PESO,
        matched_points_waiting: matchedPointsWaiting,
        potential_payable: potentialPayable,
        note: 'Unmatched points are network volume, not a cash liability. Matched points waiting should normally be zero because cap-excess pairs are flushed, not carried forward.',
      },
      direct_product_orders: { ...productOrders, profit: productOrders.revenue - productOrders.cost },
      city_registration_context: {
        registrations: cityRegistrations._count.id,
        customer_cash: toNumber(cityRegistrations._sum.customer_payment),
        pin_allocation: toNumber(cityRegistrations._sum.pin_allocation),
        city_profit: toNumber(cityRegistrations._sum.registration_profit),
      },
    })
  } catch (error) {
    console.error('[REPORT TESTING ERROR]', error)
    return NextResponse.json({ error: 'Unable to load report testing data.' }, { status: 500 })
  }
}
