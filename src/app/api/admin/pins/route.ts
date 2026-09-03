import { NextRequest, NextResponse } from 'next/server'
import { PinStatus, Prisma } from '@prisma/client'
import { createAuditLog, formatMemberId } from '@/app/lib/auditLog'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import {
  assertUpgradePinIssuanceEconomics,
  calculateUpgradeProductEconomics,
  getUpgradeAcquisitionPrice,
  PackageFundingConfigurationError,
  type UpgradeAcquisitionTier,
} from '@/app/lib/packageUpgradeConfiguration'
import {
  buildRegistrationPinSnapshot,
  RegistrationPinSnapshotError,
  type RegistrationAcquisitionTier,
  type RegistrationPinSnapshot,
} from '@/app/lib/registrationPinSnapshot'
import {
  assessPinIssuanceAgainstBinaryReserve,
  BinaryReserveAdmissionError,
  type BinaryReserveAdmissionDecision,
} from '@/app/lib/binaryReserveAdmission'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ── Generate unique PIN code ──
function generatePinCode(packageName: string): string {
  const prefix = 'HRM'
  const year = new Date().getFullYear()
  const tier = packageName.slice(0, 3).toUpperCase()
  const random = Math.floor(10000 + Math.random() * 90000)
  return `${prefix}-${year}-${tier}-${random}`
}

// ── GET all PINs with pagination, search, status filter ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const status        = searchParams.get('status')        || 'unused'
    const search        = searchParams.get('search')        || ''
    const page          = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize      = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))
    const cityDistId    = searchParams.get('city_dist_id')  || ''
    const dateFrom      = searchParams.get('from')          || ''
    const dateTo        = searchParams.get('to')            || ''
    const allDates      = searchParams.get('all_dates') === 'true'

    const normalizedSearch = search.trim().toLowerCase()
    const searchedStatus = Object.values(PinStatus).find((value) => value === normalizedSearch)
    const searchDateMatch = normalizedSearch.match(/^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))$/)
    const searchDate = searchDateMatch ? new Date(Number(searchDateMatch[1] || searchDateMatch[6]), Number(searchDateMatch[2] || searchDateMatch[4]) - 1, Number(searchDateMatch[3] || searchDateMatch[5])) : null
    const validSearchDate = searchDate && !Number.isNaN(searchDate.getTime()) ? searchDate : null

    if (status !== 'all' && !Object.values(PinStatus).includes(status as PinStatus)) {
      return NextResponse.json({ error: 'Invalid PIN status.' }, { status: 400 })
    }

    const fromDate = validSearchDate || (dateFrom ? new Date(dateFrom) : new Date(new Date().setHours(0, 0, 0, 0)))
    const toDate = validSearchDate ? new Date(new Date(validSearchDate).setHours(23, 59, 59, 999)) : dateTo ? new Date(dateTo + 'T23:59:59') : new Date(new Date().setHours(23, 59, 59, 999))

    const baseWhere: Prisma.PinWhereInput = {
      // PIN management keeps its date-based reporting default. Registration can
      // explicitly request all historical unused PINs, because an unused PIN
      // remains valid regardless of when it was generated.
      ...(!allDates && { created_at: { gte: fromDate, lte: toDate } }),
      ...(cityDistId && { city_dist_id: cityDistId }),
      ...(search && !searchedStatus && !validSearchDate && {
        OR: [
          { pin_code: { contains: search, mode: 'insensitive' } },
          { package: { name: { contains: search, mode: 'insensitive' } } },
          { city_distributor: { full_name: { contains: search, mode: 'insensitive' } } },
          { city_distributor: { username: { contains: search, mode: 'insensitive' } } },
          { used_by_user: { full_name: { contains: search, mode: 'insensitive' } } },
          { used_by_user: { username: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    }
    const where: Prisma.PinWhereInput = {
      ...baseWhere,
      ...((searchedStatus || status !== 'all') && { status: (searchedStatus || status) as PinStatus }),
    }

    const [total, pins, summaryRaw] = await Promise.all([
      prisma.pin.count({ where }),

      prisma.pin.findMany({
        where,
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, pin_code: true, status: true, pin_type: true, upgrade_from_package_id: true, pin_allocation_snapshot: true,
          created_at: true, used_at: true,
          package:          { select: { name: true, price: true } },
          city_distributor: { select: { full_name: true, username: true } },
          used_by_user:     { select: { full_name: true, username: true } },
        },
      }),

      prisma.pin.groupBy({
        by:    ['status'],
        where: baseWhere,
        _count: { status: true },
      }),
    ])

    const summary = { total: 0, unused: 0, used: 0, expired: 0, cancelled: 0 }
    for (const row of summaryRaw) {
      summary.total += row._count.status
      const s = row.status as string
      if (s === 'unused')    summary.unused    = row._count.status
      if (s === 'used')      summary.used      = row._count.status
      if (s === 'expired')   summary.expired   = row._count.status
      if (s === 'cancelled') summary.cancelled = row._count.status
    }

    return NextResponse.json({
      pins,
      summary,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[GET PINS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST generate & sell PINs to city distributor ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { package_id, city_dist_id, quantity, pin_type = 'registration', upgrade_from_package_id } = await req.json()

    if (!package_id || !city_dist_id || quantity == null) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }
    if (pin_type !== 'registration' && pin_type !== 'upgrade') return NextResponse.json({ error: 'Invalid PIN type.' }, { status: 400 })
    if (pin_type === 'upgrade' && !upgrade_from_package_id) return NextResponse.json({ error: "Select the reseller's current package for an upgrade PIN." }, { status: 400 })

    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) {
      return NextResponse.json(
        { error: 'Quantity must be a whole number between 1 and 50.' },
        { status: 400 }
      )
    }

    // ── Get package details ──
    const pkg = await prisma.package.findUnique({
      where:  { id: package_id },
      select: {
        name: true,
        price: true,
        is_active: true,
        direct_referral_bonus: true,
        pairing_bonus_value: true,
        products: {
          select: {
            product_id: true,
            quantity: true,
            product: { select: { price: true, reseller_price: true, city_price: true, branch_price: true, cost_price: true } },
          },
        },
      },
    })

    if (!pkg) {
      return NextResponse.json({ error: 'Package not found.' }, { status: 404 })
    }
    if (!pkg.is_active) {
      return NextResponse.json({ error: 'Cannot generate PINs for an inactive package.' }, { status: 400 })
    }
    const pinRecipient = await prisma.user.findUnique({
      where: { id: city_dist_id },
      select: {
        role: true,
        status: true,
        distributor_profile: { select: { dist_level: true, is_active: true } },
      },
    })
    const recipientLevel: RegistrationAcquisitionTier | null =
      pinRecipient?.role === 'admin' && pinRecipient.status === 'active'
        ? 'admin'
        : pinRecipient?.role === 'city' && pinRecipient.distributor_profile?.is_active
          && (pinRecipient.distributor_profile.dist_level === 'city' || pinRecipient.distributor_profile.dist_level === 'branch')
          ? pinRecipient.distributor_profile.dist_level
          : null
    if (!recipientLevel) {
      return NextResponse.json({ error: 'PIN recipient must be Admin or an active City Distributor/Branch.' }, { status: 400 })
    }

    let registrationSnapshot: RegistrationPinSnapshot | null = null
    let unitPinPrice = Number(pkg.price)
    if (pin_type === 'registration') {
      registrationSnapshot = buildRegistrationPinSnapshot({
        packageId: package_id,
        packageName: pkg.name,
        configuredPinPrice: pkg.price,
        directAllocation: pkg.direct_referral_bonus,
        points: pkg.pairing_bonus_value,
        acquisitionTier: recipientLevel,
        products: pkg.products,
      })
      unitPinPrice = registrationSnapshot.pinAllocation
    }
    let upgradeSnapshot: {
      customerPayment: number
      resellerValue: number
      acquisitionCost: number
      acquisitionTier: UpgradeAcquisitionTier
      directAllocation: number
      binaryAllocation: number
      pointsDifference: number
      productLineCount: number
      units: number
    } | null = null
    let configuredUpgradeProducts: Array<{
      product_id: string
      quantity: number
      srp_snapshot: number
      reseller_price_snapshot: number
      unit_acquisition_cost_snapshot: number
    }> = []
    if (pin_type === 'upgrade') {
      if (
        (recipientLevel !== 'city' && recipientLevel !== 'branch')
      ) {
        return NextResponse.json({ error: 'Upgrade PIN recipient must be an active City Distributor or Branch.' }, { status: 400 })
      }
      const acquisitionTier: UpgradeAcquisitionTier = recipientLevel
      const sourcePkg = await prisma.package.findUnique({
        where: { id: upgrade_from_package_id },
        select: { name: true, direct_referral_bonus: true, pairing_bonus_value: true },
      })
      if (!sourcePkg) return NextResponse.json({ error: 'Current package was not found.' }, { status: 404 })
      const configuredPath = await prisma.packageUpgradePath.findUnique({
        where: {
          from_package_id_to_package_id: {
            from_package_id: upgrade_from_package_id,
            to_package_id: package_id,
          },
        },
        include: {
          products: {
            include: {
              product: { select: { price: true, reseller_price: true, city_price: true, branch_price: true, cost_price: true } },
            },
          },
        },
      })
      if (!configuredPath?.is_active) {
        return NextResponse.json({ error: 'This package upgrade path is not configured or is inactive.' }, { status: 400 })
      }
      const configuredSnapshot = calculateUpgradeProductEconomics(configuredPath.products, acquisitionTier)
      const sealedUpgrade = assertUpgradePinIssuanceEconomics({
        customerPrice: configuredPath.customer_price,
        pinPrice: configuredPath.pin_price,
        sourceDirectAllocation: sourcePkg.direct_referral_bonus,
        targetDirectAllocation: pkg.direct_referral_bonus,
        sourceBinaryPoints: sourcePkg.pairing_bonus_value,
        targetBinaryPoints: pkg.pairing_bonus_value,
        sourceLabel: sourcePkg.name,
        acquisitionTier,
        products: configuredPath.products,
        productEconomics: configuredSnapshot,
      })
      unitPinPrice = sealedUpgrade.pinAllocation
      configuredUpgradeProducts = configuredPath.products.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        srp_snapshot: Number(item.product.price),
        reseller_price_snapshot: Number(item.product.reseller_price) || Number(item.product.price),
        unit_acquisition_cost_snapshot: getUpgradeAcquisitionPrice(item.product, acquisitionTier),
      }))
      upgradeSnapshot = {
        customerPayment: sealedUpgrade.customerPayment,
        resellerValue: sealedUpgrade.resellerValue,
        acquisitionCost: sealedUpgrade.acquisitionCost,
        acquisitionTier,
        directAllocation: sealedUpgrade.directAllocation,
        binaryAllocation: sealedUpgrade.binaryAllocation,
        pointsDifference: sealedUpgrade.pointsDifference,
        productLineCount: sealedUpgrade.productLineCount,
        units: sealedUpgrade.units,
      }
    }

    // ── Generate unique PIN codes ──
    const pinCodes: string[] = []
    const existingPins = new Set(
      (await prisma.pin.findMany({ select: { pin_code: true } })).map(
        (p) => p.pin_code
      )
    )

    while (pinCodes.length < quantity) {
      const code = generatePinCode(pkg.name)
      if (!existingPins.has(code) && !pinCodes.includes(code)) {
        pinCodes.push(code)
      }
    }

    const totalAmount = unitPinPrice * quantity

    let reserveAdmission: BinaryReserveAdmissionDecision | null = null

    // ── Create PINs + record as a sale order ──
    await prisma.$transaction(async (tx) => {
      const requestedBinaryAllocation = quantity * (
        registrationSnapshot?.binaryAllocation
        ?? upgradeSnapshot?.binaryAllocation
        ?? 0
      )
      reserveAdmission = await assessPinIssuanceAgainstBinaryReserve(
        tx,
        requestedBinaryAllocation,
      )

      const paidAt = new Date()
      const fundingOrder = await tx.order.create({
        data: {
          buyer_id: city_dist_id,
          seller_id: user.id,
          order_type: 'online',
          status: 'delivered',
          total_amount: totalAmount,
          is_cross_purchase: false,
          payment_method: 'cash',
          payment_status: 'paid',
          financial_purpose: 'pin_sale',
          paid_at: paidAt,
          delivered_at: paidAt,
          notes: `PIN sale: ${quantity} × ${pkg.name} package @ ₱${unitPinPrice.toLocaleString()} each`,
        },
      })

      // 1. Bulk create PINs
      await tx.pin.createMany({
        data: pinCodes.map((pin_code) => ({
          pin_code,
          package_id,
          city_dist_id,
          status: 'unused',
          generated_by: user.id,
          funding_order_id: fundingOrder.id,
          pin_type,
          upgrade_from_package_id: pin_type === 'upgrade' ? upgrade_from_package_id : null,
          pin_allocation_snapshot: unitPinPrice,
          registration_package_name_snapshot: registrationSnapshot?.packageName ?? null,
          registration_customer_payment_snapshot: registrationSnapshot?.customerPayment ?? null,
          registration_reseller_value_snapshot: registrationSnapshot?.resellerValue ?? null,
          registration_acquisition_cost_snapshot: registrationSnapshot?.acquisitionCost ?? null,
          registration_acquisition_tier_snapshot: registrationSnapshot?.acquisitionTier ?? null,
          registration_direct_allocation_snapshot: registrationSnapshot?.directAllocation ?? null,
          registration_binary_allocation_snapshot: registrationSnapshot?.binaryAllocation ?? null,
          registration_points_snapshot: registrationSnapshot?.points ?? null,
          registration_product_line_count_snapshot: registrationSnapshot?.productLineCount ?? null,
          registration_units_snapshot: registrationSnapshot?.units ?? null,
          upgrade_customer_payment_snapshot: upgradeSnapshot?.customerPayment ?? null,
          upgrade_reseller_value_snapshot: upgradeSnapshot?.resellerValue ?? null,
          upgrade_acquisition_cost_snapshot: upgradeSnapshot?.acquisitionCost ?? null,
          upgrade_acquisition_tier_snapshot: upgradeSnapshot?.acquisitionTier ?? null,
          upgrade_direct_allocation_snapshot: upgradeSnapshot?.directAllocation ?? null,
          upgrade_binary_allocation_snapshot: upgradeSnapshot?.binaryAllocation ?? null,
          upgrade_points_difference_snapshot: upgradeSnapshot?.pointsDifference ?? null,
          upgrade_product_line_count_snapshot: upgradeSnapshot?.productLineCount ?? null,
          upgrade_units_snapshot: upgradeSnapshot?.units ?? null,
        })),
      })

      if (pin_type === 'upgrade') {
        const createdPins = await tx.pin.findMany({
          where: { pin_code: { in: pinCodes } },
          select: { id: true },
        })
        await tx.pinUpgradeProductSnapshot.createMany({
          data: createdPins.flatMap((createdPin) => configuredUpgradeProducts.map((product) => ({
            pin_id: createdPin.id,
            product_id: product.product_id,
            quantity: product.quantity,
            srp_snapshot: product.srp_snapshot,
            reseller_price_snapshot: product.reseller_price_snapshot,
            unit_acquisition_cost_snapshot: product.unit_acquisition_cost_snapshot,
          }))),
        })
      }
      if (pin_type === 'registration' && registrationSnapshot) {
        const createdPins = await tx.pin.findMany({
          where: { pin_code: { in: pinCodes } },
          select: { id: true },
        })
        await tx.pinRegistrationProductSnapshot.createMany({
          data: createdPins.flatMap((createdPin) => registrationSnapshot!.products.map((product) => ({
            pin_id: createdPin.id,
            product_id: product.product_id,
            quantity: product.quantity,
            srp_snapshot: product.srp_snapshot,
            reseller_price_snapshot: product.reseller_price_snapshot,
            unit_acquisition_cost_snapshot: product.unit_acquisition_cost_snapshot,
          }))),
        })
      }

    })

        // Audit log
    createAuditLog({
      user_id:       user.id,
      user_name:     user.full_name || user.username,
      user_role:     user.role,
      member_id:     formatMemberId(user.id, user.role),
      activity_type: 'pin_generated',
      category:      'pin',
      description:   `Generated ${pinCodes.length} PIN(s) for ${pkg.name} package`,
      metadata:      {
        quantity: pinCodes.length,
        package: pkg.name,
        city_dist_id,
        pin_type,
        upgrade_from_package_id: pin_type === 'upgrade' ? upgrade_from_package_id : null,
        pin_allocation_snapshot: unitPinPrice,
        reserve_admission_mode: reserveAdmission?.mode,
        reserve_admission_status: reserveAdmission?.status,
        reserve_admission_reasons: reserveAdmission?.reasons,
      },
      risk_level:    'low',
      status:        'normal',
    })
return NextResponse.json({
      success: true,
      pins: pinCodes,
      message: `${quantity} PIN${quantity > 1 ? 's' : ''} generated and sold to city distributor.`,
    })
  } catch (error) {
    console.error('[GENERATE PINS ERROR]', error)
    if (error instanceof BinaryReserveAdmissionError) {
      return NextResponse.json(
        {
          error: 'PIN issuance is temporarily paused by the protected reserve policy. Contact Finance/Admin.',
          code: error.code,
        },
        { status: 503 },
      )
    }
    const detail = error instanceof Error ? error.message : 'Unknown server error'
    return NextResponse.json(
      { error: 'PIN generation failed: ' + detail },
      {
        status:
          error instanceof RegistrationPinSnapshotError ||
          error instanceof PackageFundingConfigurationError
            ? 400
            : 500,
      },
    )
  }
}
// ── PATCH — cancel PINs (single or bulk) ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pin_ids, reason } = await req.json()

    if (!pin_ids || !Array.isArray(pin_ids) || pin_ids.length === 0) {
      return NextResponse.json({ error: 'pin_ids array is required.' }, { status: 400 })
    }

    if (!pin_ids.every((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id))) {
      return NextResponse.json({ error: 'pin_ids must contain valid PIN identifiers.' }, { status: 400 })
    }

    const uniquePinIds = [...new Set(pin_ids as string[])]
    const cancellationReason = typeof reason === 'string' ? reason.trim() : ''
    if (cancellationReason.length < 3 || cancellationReason.length > 500) {
      return NextResponse.json({ error: 'Cancellation reason must be between 3 and 500 characters.' }, { status: 400 })
    }

    // Only unused PINs can be cancelled
    const pins = await prisma.pin.findMany({
      where: { id: { in: uniquePinIds } },
      select: { id: true, status: true, pin_code: true },
    })

    if (pins.length !== uniquePinIds.length) {
      return NextResponse.json({ error: 'One or more selected PINs no longer exist. Refresh and try again.' }, { status: 409 })
    }

    const alreadyUsed = pins.filter((p) => (p.status as string) !== 'unused')
    if (alreadyUsed.length > 0) {
      return NextResponse.json({
        error: `Cannot cancel PINs that are already ${alreadyUsed[0].status}: ${alreadyUsed.map((p) => p.pin_code).join(', ')}`,
      }, { status: 400 })
    }

    const now = new Date()
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.pin.updateMany({
        where: { id: { in: uniquePinIds }, status: 'unused' },
        data: {
          status: 'cancelled',
          cancelled_at: now,
          cancelled_by: user.id,
          cancellation_reason: cancellationReason,
        },
      })

      if (updated.count !== uniquePinIds.length) {
        throw new Error('PIN_CANCELLATION_CONFLICT')
      }

      return updated
    })

    createAuditLog({
      user_id: user.id,
      user_name: user.full_name || user.username,
      user_role: user.role,
      member_id: formatMemberId(user.id, user.role),
      activity_type: 'pin_cancelled',
      category: 'pin',
      description: `Permanently cancelled ${result.count} unused PIN${result.count > 1 ? 's' : ''}.`,
      metadata: { pin_ids: uniquePinIds, pin_codes: pins.map((pin) => pin.pin_code), reason: cancellationReason },
      risk_level: 'warning',
      status: 'completed',
    })

    return NextResponse.json({
      success: true,
      message: `${result.count} PIN${result.count > 1 ? 's' : ''} cancelled successfully.`,
      cancelled: result.count,
    })
  } catch (error) {
    console.error('[CANCEL PINS ERROR]', error)
    if (error instanceof Error && error.message === 'PIN_CANCELLATION_CONFLICT') {
      return NextResponse.json({ error: 'A selected PIN changed status while cancellation was being processed. Nothing was cancelled; refresh and try again.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
