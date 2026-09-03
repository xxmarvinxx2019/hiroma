import { NextRequest, NextResponse } from 'next/server'
import { PinStatus, Prisma } from '@prisma/client'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
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
          generated_by_actor_id: true,
          cancellation_disposition: true, cancellation_reference: true, cancellation_amount: true,
          package:          { select: { name: true, price: true } },
          city_distributor: { select: { full_name: true, username: true } },
          used_by_user:     { select: { full_name: true, username: true } },
          funding_order: { select: { order_number: true, payment_method: true, payment_reference: true, paid_at: true } },
          funding_pin_request: { select: { id: true, payment_method: true, payment_reference: true, status: true } },
          funding_pin_transfer: { select: { reference_number: true, status: true, sale_value: true, received_at: true } },
        },
      }),

      prisma.pin.groupBy({
        by:    ['status'],
        where: baseWhere,
        _count: { status: true },
      }),
    ])

    const summary = { total: 0, in_transit: 0, unused: 0, used: 0, expired: 0, cancelled: 0 }
    for (const row of summaryRaw) {
      summary.total += row._count.status
      const s = row.status as string
      if (s === 'in_transit') summary.in_transit = row._count.status
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

    const {
      package_id,
      city_dist_id,
      quantity,
      pin_type = 'registration',
      upgrade_from_package_id,
      workflow,
      payment_method,
      payment_reference,
      payment_sender_name,
      payment_datetime,
      notes,
    } = await req.json()

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
        role: true, full_name: true, username: true,
        status: true,
        distributor_profile: { select: { dist_level: true, is_active: true } },
      },
    })
    const recipientLevel: RegistrationAcquisitionTier | null =
      pinRecipient?.role === 'city' && pinRecipient.status === 'active' && pinRecipient.distributor_profile?.is_active
          && (pinRecipient.distributor_profile.dist_level === 'city' || pinRecipient.distributor_profile.dist_level === 'branch')
        ? pinRecipient.distributor_profile.dist_level
        : null
    if (!recipientLevel) {
      return NextResponse.json({ error: 'PIN recipient must be an active City Distributor or Hiroma Branch.' }, { status: 400 })
    }

    const expectedWorkflow = recipientLevel === 'branch' ? 'internal_transfer' : 'paid_sale'
    if (workflow !== expectedWorkflow) {
      return NextResponse.json({
        error: recipientLevel === 'branch'
          ? 'Hiroma Branch PINs must use the zero-revenue internal transfer workflow.'
          : 'City Distributor PINs require a paid sale workflow.',
      }, { status: 400 })
    }

    const actorId = user.actor_id || user.id
    const actorName = user.actor_name || user.full_name || user.username
    const paymentMethod = typeof payment_method === 'string' ? payment_method.trim() : ''
    const paymentReference = typeof payment_reference === 'string' ? payment_reference.trim() : ''
    const paymentSenderName = typeof payment_sender_name === 'string' ? payment_sender_name.trim() : ''
    const paymentEvidenceAt = payment_datetime ? new Date(payment_datetime) : null
    const issuanceNotes = typeof notes === 'string' ? notes.trim() : ''
    if (issuanceNotes.length > 500) {
      return NextResponse.json({ error: 'Notes may not exceed 500 characters.' }, { status: 400 })
    }
    if (expectedWorkflow === 'paid_sale') {
      if (
        !['cash', 'gcash', 'bank_transfer'].includes(paymentMethod)
        || paymentReference.length < 3 || paymentReference.length > 120
        || paymentSenderName.length < 2 || paymentSenderName.length > 120
        || !paymentEvidenceAt || Number.isNaN(paymentEvidenceAt.getTime())
        || paymentEvidenceAt.getTime() > Date.now() + 5 * 60 * 1000
      ) {
        return NextResponse.json({
          error: 'Paid City PIN sales require method, official reference, payer name, and a valid payment time.',
        }, { status: 400 })
      }
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

    // A City issuance is a paid sale. A Branch issuance is a zero-revenue
    // custody transfer whose PINs remain unusable until Branch receiving.
    const issuance = await prisma.$transaction(async (tx) => {
      const requestedBinaryAllocation = quantity * (
        registrationSnapshot?.binaryAllocation
        ?? upgradeSnapshot?.binaryAllocation
        ?? 0
      )
      const reserveAdmission: BinaryReserveAdmissionDecision = await assessPinIssuanceAgainstBinaryReserve(
        tx,
        requestedBinaryAllocation,
      )

      const paidAt = new Date()
      const sourceId = crypto.randomUUID()
      const sourceReference = expectedWorkflow === 'paid_sale'
        ? `PIN-${sourceId.slice(0, 8).toUpperCase()}`
        : `PTR-${sourceId.slice(0, 8).toUpperCase()}`
      const fundingOrder = expectedWorkflow === 'paid_sale'
        ? await tx.order.create({
            data: {
              id: sourceId,
              order_number: sourceReference,
              buyer_id: city_dist_id,
              seller_id: user.id,
              order_type: 'online',
              status: 'delivered',
              total_amount: totalAmount,
              is_cross_purchase: false,
              payment_method: paymentMethod,
              payment_reference: paymentReference,
              payment_sender_name: paymentSenderName,
              payment_status: 'paid',
              payment_evidence_at: paymentEvidenceAt!,
              payment_recorded_by_actor_id: actorId,
              payment_verified_by_actor_id: actorId,
              financial_purpose: 'pin_sale',
              paid_at: paidAt,
              delivered_at: paidAt,
              notes: `PIN sale: ${quantity} × ${pkg.name} package @ ₱${unitPinPrice.toLocaleString()} each${issuanceNotes ? ` | ${issuanceNotes}` : ''}`,
            },
          })
        : null
      const fundingTransfer = expectedWorkflow === 'internal_transfer'
        ? await tx.pinTransfer.create({
            data: {
              id: sourceId,
              reference_number: sourceReference,
              admin_id: user.id,
              recipient_id: city_dist_id,
              initiated_by_actor_id: actorId,
              package_id,
              pin_type,
              upgrade_from_package_id: pin_type === 'upgrade' ? upgrade_from_package_id : null,
              quantity,
              unit_allocation: unitPinPrice,
              reference_value: totalAmount,
              sale_value: 0,
              status: 'in_transit',
              notes: issuanceNotes || null,
            },
          })
        : null

      await tx.pin.createMany({
        data: pinCodes.map((pin_code) => ({
          pin_code,
          package_id,
          city_dist_id,
          status: expectedWorkflow === 'internal_transfer' ? 'in_transit' : 'unused',
          generated_by: user.id,
          generated_by_actor_id: actorId,
          funding_order_id: fundingOrder?.id ?? null,
          funding_pin_transfer_id: fundingTransfer?.id ?? null,
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
      if (fundingTransfer) {
        await tx.notification.create({
          data: {
            user_id: city_dist_id,
            type: 'pin_transfer_in_transit',
            title: 'Incoming PIN transfer',
            message: `${quantity} ${pkg.name} PIN(s) were dispatched under ${sourceReference}. Receive the complete batch before the PINs can be used.`,
            amount: totalAmount,
            entity_type: 'pin_transfer',
            entity_id: fundingTransfer.id,
            action_url: '/dashboard/city/pin-requests',
          },
        })
      }
      await createRequiredAuditLog(tx, {
        user_id: actorId,
        user_name: actorName,
        user_role: user.role,
        member_id: formatMemberId(actorId, user.role),
        activity_type: expectedWorkflow === 'paid_sale' ? 'pin_sale_recorded' : 'branch_pin_transfer_dispatched',
        category: 'pin',
        description: expectedWorkflow === 'paid_sale'
          ? `Recorded paid sale and issued ${pinCodes.length} PIN(s) to ${pinRecipient.full_name}.`
          : `Dispatched ${pinCodes.length} PIN(s) to Branch ${pinRecipient.full_name}; no sale recorded and PINs remain in transit.`,
        metadata: {
          owner_admin_id: user.id,
          source_id: sourceId,
          reference_number: sourceReference,
          transaction_type: expectedWorkflow,
          sale_value: expectedWorkflow === 'paid_sale' ? totalAmount : 0,
          reference_value: totalAmount,
          quantity: pinCodes.length,
          package: pkg.name,
          recipient_id: city_dist_id,
          pin_type,
          upgrade_from_package_id: pin_type === 'upgrade' ? upgrade_from_package_id : null,
          pin_allocation_snapshot: unitPinPrice,
          payment_method: expectedWorkflow === 'paid_sale' ? paymentMethod : null,
          payment_reference: expectedWorkflow === 'paid_sale' ? paymentReference : null,
          reserve_admission_mode: reserveAdmission.mode,
          reserve_admission_status: reserveAdmission.status,
          reserve_admission_reasons: reserveAdmission.reasons,
        },
        risk_level: 'low',
        status: 'completed',
        ...getClientInfo(req),
      })
      return { sourceId, sourceReference, reserveAdmission }
    })

    return NextResponse.json({
      success: true,
      pins: pinCodes,
      transaction_type: expectedWorkflow,
      reference_number: issuance.sourceReference,
      source_id: issuance.sourceId,
      sale_value: expectedWorkflow === 'paid_sale' ? totalAmount : 0,
      reference_value: totalAmount,
      pin_status: expectedWorkflow === 'paid_sale' ? 'unused' : 'in_transit',
      message: expectedWorkflow === 'paid_sale'
        ? `${quantity} PIN${quantity > 1 ? 's' : ''} issued under paid receipt ${issuance.sourceReference}.`
        : `${quantity} PIN${quantity > 1 ? 's' : ''} dispatched under ${issuance.sourceReference}; usable only after Branch receiving.`,
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

    const { pin_ids, reason, disposition, disposition_reference } = await req.json()

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
    const cancellationDisposition = typeof disposition === 'string' ? disposition.trim() : ''
    const cancellationReference = typeof disposition_reference === 'string' ? disposition_reference.trim() : ''
    if (!['refunded', 'credited', 'retained'].includes(cancellationDisposition)) {
      return NextResponse.json({ error: 'Select whether the cancelled value was refunded, credited, or retained.' }, { status: 400 })
    }
    if (['refunded', 'credited'].includes(cancellationDisposition) && (cancellationReference.length < 3 || cancellationReference.length > 120)) {
      return NextResponse.json({ error: 'Refunded or credited cancellations require a reference.' }, { status: 400 })
    }

    // Only unused PINs can be cancelled
    const pins = await prisma.pin.findMany({
      where: { id: { in: uniquePinIds } },
      select: { id: true, status: true, pin_code: true, pin_allocation_snapshot: true },
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
    const actorId = user.actor_id || user.id
    const actorName = user.actor_name || user.full_name || user.username
    const cancellationAmount = pins.reduce((sum, pin) => sum + Number(pin.pin_allocation_snapshot || 0), 0)
    const result = await prisma.$transaction(async (tx) => {
      let updatedCount = 0
      for (const pin of pins) {
        const updated = await tx.pin.updateMany({
          where: { id: pin.id, status: 'unused' },
          data: {
            status: 'cancelled',
            cancelled_at: now,
            cancelled_by: actorId,
            cancellation_reason: cancellationReason,
            cancellation_disposition: cancellationDisposition,
            cancellation_reference: cancellationReference || null,
            cancellation_amount: Number(pin.pin_allocation_snapshot || 0),
          },
        })
        if (updated.count !== 1) throw new Error('PIN_CANCELLATION_CONFLICT')
        updatedCount += 1
      }

      await createRequiredAuditLog(tx, {
        user_id: actorId,
        user_name: actorName,
        user_role: user.role,
        member_id: formatMemberId(actorId, user.role),
        activity_type: 'pin_cancelled',
        category: 'pin',
        description: `Permanently cancelled ${updatedCount} unused PIN${updatedCount > 1 ? 's' : ''} with ${cancellationDisposition} disposition.`,
        metadata: {
          owner_admin_id: user.id,
          pin_ids: uniquePinIds,
          pin_codes: pins.map((pin) => pin.pin_code),
          reason: cancellationReason,
          disposition: cancellationDisposition,
          disposition_reference: cancellationReference || null,
          disposition_amount: cancellationAmount,
        },
        risk_level: 'warning',
        status: 'completed',
        ...getClientInfo(req),
      })
      return { count: updatedCount }
    })

    return NextResponse.json({
      success: true,
      message: `${result.count} PIN${result.count > 1 ? 's' : ''} cancelled successfully.`,
      cancelled: result.count,
      disposition: cancellationDisposition,
      disposition_amount: cancellationAmount,
    })
  } catch (error) {
    console.error('[CANCEL PINS ERROR]', error)
    if (error instanceof Error && error.message === 'PIN_CANCELLATION_CONFLICT') {
      return NextResponse.json({ error: 'A selected PIN changed status while cancellation was being processed. Nothing was cancelled; refresh and try again.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
