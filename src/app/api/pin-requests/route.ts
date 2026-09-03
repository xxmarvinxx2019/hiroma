import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'
import { claimPendingPinRequestAndCreatePins } from '@/app/lib/pinRequestApproval'
import {
  buildRegistrationPinSnapshot,
  parseRegistrationPinSnapshot,
  RegistrationPinSnapshotError,
  type RegistrationAcquisitionTier,
} from '@/app/lib/registrationPinSnapshot'
import {
  assessPinIssuanceAgainstBinaryReserve,
  BinaryReserveAdmissionError,
} from '@/app/lib/binaryReserveAdmission'

// ── Generate unique PIN code ──
function generatePinCode(packageName: string): string {
  const prefix  = 'HRM'
  const year    = new Date().getFullYear()
  const tier    = packageName.slice(0, 3).toUpperCase()
  const random  = Math.floor(10000 + Math.random() * 90000)
  return `${prefix}-${year}-${tier}-${random}`
}

// ── GET ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['admin', 'city'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const status   = searchParams.get('status')   || 'all'
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))
    const search   = searchParams.get('search')   || ''

    const where: any = {
      ...(user.role === 'city' && { city_dist_id: user.id }),
      ...(status !== 'all'     && { status }),
      ...(search && {
        OR: [
          { city_dist: { full_name: { contains: search, mode: 'insensitive' } } },
          { city_dist: { username:  { contains: search, mode: 'insensitive' } } },
          { package:   { name:      { contains: search, mode: 'insensitive' } } },
        ],
      }),
    }

    const [total, requests, summaryRaw] = await Promise.all([
      prisma.pinRequest.count({ where }),
      prisma.pinRequest.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select: {
          id: true, quantity: true, total_amount: true,
          payment_method: true, payment_reference: true,
          payment_sender_name: true, payment_datetime: true,
          payment_status: true, status: true, notes: true,
          created_at: true, updated_at: true,
          city_dist: { select: { id: true, full_name: true, username: true } },
          package:   { select: { id: true, name: true, price: true } },
        },
      }),
      prisma.pinRequest.groupBy({
        by:    ['status'],
        where: user.role === 'city' ? { city_dist_id: user.id } : {},
        _count: { status: true },
      }),
    ])

    const summary = { total: 0, pending: 0, approved: 0, rejected: 0 }
    for (const row of summaryRaw) {
      summary.total += row._count.status
      if (row.status === 'pending')  summary.pending  = row._count.status
      if (row.status === 'approved') summary.approved = row._count.status
      if (row.status === 'rejected') summary.rejected = row._count.status
    }

    return NextResponse.json({
      requests, summary,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[PIN REQUESTS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST — city dist creates a PIN request ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      package_id, quantity, notes,
      payment_method, payment_reference, payment_sender_name, payment_datetime,
    } = await req.json()

    if (!package_id || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) {
      return NextResponse.json(
        { error: 'Package is required and quantity must be a whole number between 1 and 50.' },
        { status: 400 },
      )
    }

    const pkg = await prisma.package.findUnique({
      where:  { id: package_id },
      select: {
        id: true,
        name: true,
        price: true,
        is_active: true,
        direct_referral_bonus: true,
        pairing_bonus_value: true,
        products: {
          select: {
            product_id: true,
            quantity: true,
            product: {
              select: {
                price: true,
                reseller_price: true,
                city_price: true,
                branch_price: true,
                cost_price: true,
              },
            },
          },
        },
      },
    })

    if (!pkg || !pkg.is_active) {
      return NextResponse.json({ error: 'Package not found or inactive.' }, { status: 400 })
    }
    const paymentMethod = typeof payment_method === 'string' ? payment_method.trim() : ''
    const paymentReference = typeof payment_reference === 'string' ? payment_reference.trim() : ''
    const paymentSenderName = typeof payment_sender_name === 'string' ? payment_sender_name.trim() : ''
    const paymentDatetime = payment_datetime ? new Date(payment_datetime) : null
    if (
      !['gcash', 'bank_transfer'].includes(paymentMethod)
      || paymentReference.length < 3 || paymentReference.length > 120
      || paymentSenderName.length < 2 || paymentSenderName.length > 120
      || !paymentDatetime || Number.isNaN(paymentDatetime.getTime())
      || paymentDatetime.getTime() > Date.now() + 5 * 60 * 1000
    ) {
      return NextResponse.json({
        error: 'PIN requests require GCash/bank payment reference, sender name, and valid payment time.',
      }, { status: 400 })
    }

    const distributor = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true, is_active: true },
    })
    const acquisitionTier: RegistrationAcquisitionTier | null =
      distributor?.is_active
        && (distributor.dist_level === 'city' || distributor.dist_level === 'branch')
        ? distributor.dist_level
        : null
    if (!acquisitionTier) {
      return NextResponse.json({ error: 'Only an active City Distributor or Branch may request registration PINs.' }, { status: 403 })
    }
    if (acquisitionTier === 'branch') {
      return NextResponse.json({
        error: 'Hiroma Branch PINs are received through Admin internal transfer, not a paid PIN request.',
      }, { status: 403 })
    }

    const registrationSnapshot = buildRegistrationPinSnapshot({
      packageId: pkg.id,
      packageName: pkg.name,
      configuredPinPrice: pkg.price,
      directAllocation: pkg.direct_referral_bonus,
      points: pkg.pairing_bonus_value,
      acquisitionTier,
      products: pkg.products,
    })
    const total_amount = registrationSnapshot.pinAllocation * quantity

    const request = await prisma.pinRequest.create({
      data: {
        city_dist_id:        user.id,
        package_id,
        quantity,
        total_amount,
        payment_method:      paymentMethod,
        payment_reference:   paymentReference,
        payment_sender_name: paymentSenderName,
        payment_datetime:    paymentDatetime,
        payment_status:      'pending',
        status:              'pending',
        notes:               notes?.trim() || null,
        registration_snapshot: registrationSnapshot as unknown as Prisma.InputJsonValue,
      },
    })

    return NextResponse.json({ success: true, request })
  } catch (error) {
    console.error('[PIN REQUESTS POST ERROR]', error)
    const detail = error instanceof Error ? error.message : 'Something went wrong.'
    return NextResponse.json(
      { error: error instanceof RegistrationPinSnapshotError ? detail : 'Something went wrong.' },
      { status: error instanceof RegistrationPinSnapshotError ? 400 : 500 },
    )
  }
}

// ── PATCH — admin approves/rejects + confirms payment ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, status, payment_status } = await req.json()

    if (!id || !['approved', 'rejected'].includes(String(status))) {
      return NextResponse.json({ error: 'Request ID required.' }, { status: 400 })
    }

    const request = await prisma.pinRequest.findUnique({
      where:  { id },
      select: {
        id: true, quantity: true, status: true, registration_snapshot: true,
        city_dist_id: true,
        package: { select: { id: true, name: true, price: true } },
      },
    })

    if (!request) {
      return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
    }

    if (request.status === 'approved' || request.status === 'rejected') {
      return NextResponse.json({ error: 'Request already finalized.' }, { status: 400 })
    }

    // If approved → generate and assign PINs to city dist
    if (status === 'approved') {
      if (payment_status !== 'paid') {
        return NextResponse.json(
          { error: 'Confirm full payment before issuing funded registration PINs.' },
          { status: 400 },
        )
      }
      const snapshot = parseRegistrationPinSnapshot(request.registration_snapshot)
      if (snapshot.packageId !== request.package.id) {
        return NextResponse.json({ error: 'PIN request snapshot does not match its package.' }, { status: 409 })
      }
      const pins = []
      const actorId = user.actor_id || user.id
      const actorName = user.actor_name || user.full_name || user.username
      const existingCodes = new Set<string>()

      for (let i = 0; i < request.quantity; i++) {
        let pinCode: string
        let attempts = 0

        // Ensure unique PIN code
        do {
          pinCode = generatePinCode(request.package.name)
          attempts++
        } while (existingCodes.has(pinCode) && attempts < 10)

        existingCodes.add(pinCode)
        pins.push({
          pin_code:      pinCode,
          package_id:    request.package.id,
          city_dist_id:  request.city_dist_id,
          status:        'unused',
          generated_by:  user.id,
          generated_by_actor_id: actorId,
          pin_type:       'registration',
          pin_allocation_snapshot: snapshot.pinAllocation,
          registration_package_name_snapshot: snapshot.packageName,
          registration_customer_payment_snapshot: snapshot.customerPayment,
          registration_reseller_value_snapshot: snapshot.resellerValue,
          registration_acquisition_cost_snapshot: snapshot.acquisitionCost,
          registration_acquisition_tier_snapshot: snapshot.acquisitionTier,
          registration_direct_allocation_snapshot: snapshot.directAllocation,
          registration_binary_allocation_snapshot: snapshot.binaryAllocation,
          registration_points_snapshot: snapshot.points,
          registration_product_line_count_snapshot: snapshot.productLineCount,
          registration_units_snapshot: snapshot.units,
        })
      }

      const approval = await prisma.$transaction(async (tx) => {
        const reserveAdmission = await assessPinIssuanceAgainstBinaryReserve(
          tx,
          snapshot.binaryAllocation * request.quantity,
        )
        const approved = await claimPendingPinRequestAndCreatePins(tx, {
          requestId: id,
          paymentStatus: payment_status,
          pins,
          registrationProducts: snapshot.products,
          updatedAt: new Date(),
          approvedByActorId: actorId,
        })
        if (approved) {
          await createRequiredAuditLog(tx, {
            user_id: actorId,
            user_name: actorName,
            user_role: user.role,
            activity_type: 'pin_request_approved',
            category: 'pin',
            description: `Approved paid PIN request and issued ${pins.length} registration PIN(s).`,
            metadata: {
              owner_admin_id: user.id,
              request_id: id,
              recipient_id: request.city_dist_id,
              quantity: pins.length,
              package_id: request.package.id,
              payment_status,
              reserve_admission_mode: reserveAdmission.mode,
              reserve_admission_status: reserveAdmission.status,
            },
            status: 'completed',
            ...getClientInfo(req),
          })
        }
        return { approved, reserveAdmission }
      })

      if (!approval.approved) {
        return NextResponse.json(
          { error: 'Request already finalized.' },
          { status: 409 },
        )
      }

      console.log(`[PIN REQUEST] Generated ${pins.length} PINs for city dist ${request.city_dist_id}`)
    } else {
      const actorId = user.actor_id || user.id
      const actorName = user.actor_name || user.full_name || user.username
      const rejected = await prisma.$transaction(async (tx) => {
        const now = new Date()
        const result = await tx.pinRequest.updateMany({
          where: { id, status: 'pending' },
          data: {
            status: 'rejected',
            rejected_by_actor_id: actorId,
            rejected_at: now,
            updated_at: now,
          },
        })
        if (result.count === 1) {
          await createRequiredAuditLog(tx, {
            user_id: actorId,
            user_name: actorName,
            user_role: user.role,
            activity_type: 'pin_request_rejected',
            category: 'pin',
            description: 'Rejected a pending paid PIN request.',
            metadata: { owner_admin_id: user.id, request_id: id, recipient_id: request.city_dist_id },
            status: 'completed',
            risk_level: 'warning',
            ...getClientInfo(req),
          })
        }
        return result
      })
      if (rejected.count !== 1) {
        return NextResponse.json({ error: 'Request already finalized.' }, { status: 409 })
      }
    }

    return NextResponse.json({
      success: true,
      message: status === 'approved'
        ? `${request.quantity} PINs generated and assigned successfully.`
        : `Request ${status}.`,
    })
  } catch (error) {
    console.error('[PIN REQUESTS PATCH ERROR]', error)
    if (error instanceof BinaryReserveAdmissionError) {
      return NextResponse.json(
        {
          error: 'PIN release is temporarily paused by the protected reserve policy. Contact Finance/Admin.',
          code: error.code,
        },
        { status: 503 },
      )
    }
    const detail = error instanceof Error ? error.message : 'Something went wrong.'
    return NextResponse.json(
      { error: error instanceof RegistrationPinSnapshotError ? detail : 'Something went wrong.' },
      { status: error instanceof RegistrationPinSnapshotError ? 409 : 500 },
    )
  }
}
