import { NextRequest, NextResponse } from 'next/server'
import { PinStatus, Prisma } from '@prisma/client'
import { createAuditLog, formatMemberId } from '@/app/lib/auditLog'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { calculatePackageEconomics } from '@/app/lib/package-economics'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// â”€â”€ Generate unique PIN code â”€â”€
function calculateUpgradeSnapshot(products: Array<{ quantity: number; product: { price: unknown; reseller_price: unknown; city_price: unknown; cost_price: unknown } }>) {
  return products.reduce((total, item) => {
    const srp = Number(item.product.price || 0)
    const reseller = Number(item.product.reseller_price || srp)
    const city = Number(item.product.city_price || item.product.cost_price || 0)
    total.customerPayment += srp * item.quantity
    total.resellerValue += reseller * item.quantity
    total.acquisitionCost += city * item.quantity
    return total
  }, { customerPayment: 0, resellerValue: 0, acquisitionCost: 0 })
}
function generatePinCode(packageName: string): string {
  const prefix = 'HRM'
  const year = new Date().getFullYear()
  const tier = packageName.slice(0, 3).toUpperCase()
  const random = Math.floor(10000 + Math.random() * 90000)
  return `${prefix}-${year}-${tier}-${random}`
}

// â”€â”€ GET all PINs with pagination, search, status filter â”€â”€
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
      created_at: { gte: fromDate, lte: toDate },
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

// â”€â”€ POST generate & sell PINs to city distributor â”€â”€
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { package_id, city_dist_id, quantity, pin_type = 'registration', upgrade_from_package_id } = await req.json()

    if (!package_id || !city_dist_id || !quantity) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }
    if (pin_type !== 'registration' && pin_type !== 'upgrade') return NextResponse.json({ error: 'Invalid PIN type.' }, { status: 400 })
    if (pin_type === 'upgrade' && !upgrade_from_package_id) return NextResponse.json({ error: "Select the reseller's current package for an upgrade PIN." }, { status: 400 })

    if (quantity < 1 || quantity > 50) {
      return NextResponse.json(
        { error: 'Quantity must be between 1 and 50.' },
        { status: 400 }
      )
    }

    // â”€â”€ Get package details â”€â”€
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
            quantity: true,
            product: { select: { price: true, reseller_price: true, city_price: true, cost_price: true } },
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
    // The Admin selects only the origin and target packages. The price is
    // computed and snapshotted now, so later package-price edits are safe.
    const targetEconomics = pkg.products.length > 0 ? calculatePackageEconomics(pkg.products) : { pinAllocation: Number(pkg.price) }
    const targetSnapshot = calculateUpgradeSnapshot(pkg.products)
    let sourcePackageName: string | null = null
    let unitPinPrice = Number(targetEconomics.pinAllocation)
    let upgradeSnapshot: { customerPayment: number; resellerValue: number; acquisitionCost: number; directAllocation: number; binaryAllocation: number; pointsDifference: number } | null = null
    if (pin_type === 'upgrade') {
      const sourcePkg = await prisma.package.findUnique({
        where: { id: upgrade_from_package_id },
        select: { name: true, direct_referral_bonus: true, pairing_bonus_value: true, products: { select: { quantity: true, product: { select: { price: true, reseller_price: true, city_price: true, cost_price: true } } } } },
      })
      if (!sourcePkg) return NextResponse.json({ error: 'Current package was not found.' }, { status: 404 })
      const sourceEconomics = sourcePkg.products.length > 0 ? calculatePackageEconomics(sourcePkg.products) : { pinAllocation: 0 }
      const sourceSnapshot = calculateUpgradeSnapshot(sourcePkg.products)
      unitPinPrice = Number(targetEconomics.pinAllocation) - Number(sourceEconomics.pinAllocation)
      const pointsDifference = Number(pkg.pairing_bonus_value) - Number(sourcePkg.pairing_bonus_value)
      if (unitPinPrice <= 0 || pointsDifference <= 0) return NextResponse.json({ error: 'Upgrade PIN requires a higher target package.' }, { status: 400 })
      sourcePackageName = sourcePkg.name
      upgradeSnapshot = {
        customerPayment: targetSnapshot.customerPayment - sourceSnapshot.customerPayment,
        resellerValue: targetSnapshot.resellerValue - sourceSnapshot.resellerValue,
        acquisitionCost: targetSnapshot.acquisitionCost - sourceSnapshot.acquisitionCost,
        directAllocation: Math.max(0, Number(pkg.direct_referral_bonus) - Number(sourcePkg.direct_referral_bonus)),
        binaryAllocation: Math.max(0, Number(pkg.pairing_bonus_value) * 0.5 - Number(sourcePkg.pairing_bonus_value) * 0.5),
        pointsDifference,
      }
    }

    // â”€â”€ Generate unique PIN codes â”€â”€
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

    // â”€â”€ Create PINs + record as a sale order â”€â”€
    await prisma.$transaction(async (tx) => {

      // 1. Bulk create PINs
      await tx.pin.createMany({
        data: pinCodes.map((pin_code) => ({
          pin_code,
          package_id,
          city_dist_id,
          status: 'unused',
          generated_by: user.id,
          pin_type,
          upgrade_from_package_id: pin_type === 'upgrade' ? upgrade_from_package_id : null,
          pin_allocation_snapshot: unitPinPrice,
          upgrade_customer_payment_snapshot: upgradeSnapshot?.customerPayment ?? null,
          upgrade_reseller_value_snapshot: upgradeSnapshot?.resellerValue ?? null,
          upgrade_acquisition_cost_snapshot: upgradeSnapshot?.acquisitionCost ?? null,
          upgrade_direct_allocation_snapshot: upgradeSnapshot?.directAllocation ?? null,
          upgrade_binary_allocation_snapshot: upgradeSnapshot?.binaryAllocation ?? null,
          upgrade_points_difference_snapshot: upgradeSnapshot?.pointsDifference ?? null,
        })),
      })

      // 2. Record the PIN sale as an order (admin â†’ city distributor)
      // Note: no order_items needed since this is a PIN sale not a product sale
      await tx.order.create({
        data: {
          buyer_id: city_dist_id,
          seller_id: user.id,
          order_type: 'online',
          status: 'delivered',
          total_amount: totalAmount,
          is_cross_purchase: false,
          notes: `PIN sale: ${quantity} Ã— ${pkg.name} package @ â‚±${unitPinPrice.toLocaleString()} each`,
        },
      })

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
      metadata:      { quantity: pinCodes.length, package: pkg.name, city_dist_id, pin_type, upgrade_from_package_id: pin_type === 'upgrade' ? upgrade_from_package_id : null, pin_allocation_snapshot: unitPinPrice },
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
    const detail = error instanceof Error ? error.message : 'Unknown server error'
    return NextResponse.json({ error: 'PIN generation failed: ' + detail }, { status: 500 })
  }
}
// â”€â”€ PATCH â€” cancel PINs (single or bulk) â”€â”€
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pin_ids } = await req.json()

    if (!pin_ids || !Array.isArray(pin_ids) || pin_ids.length === 0) {
      return NextResponse.json({ error: 'pin_ids array is required.' }, { status: 400 })
    }

    if (!pin_ids.every((id): id is string => typeof id === 'string' && UUID_PATTERN.test(id))) {
      return NextResponse.json({ error: 'pin_ids must contain valid PIN identifiers.' }, { status: 400 })
    }

    // Only unused PINs can be cancelled
    const pins = await prisma.pin.findMany({
      where: { id: { in: pin_ids } },
      select: { id: true, status: true, pin_code: true },
    })

    const alreadyUsed = pins.filter((p) => (p.status as string) !== 'unused')
    if (alreadyUsed.length > 0) {
      return NextResponse.json({
        error: `Cannot cancel PINs that are already ${alreadyUsed[0].status}: ${alreadyUsed.map((p) => p.pin_code).join(', ')}`,
      }, { status: 400 })
    }

    const result = await prisma.pin.updateMany({
      where: { id: { in: pin_ids }, status: 'unused' },
      data: { status: 'cancelled' },
    })

    return NextResponse.json({
      success: true,
      message: `${result.count} PIN${result.count > 1 ? 's' : ''} cancelled successfully.`,
      cancelled: result.count,
    })
  } catch (error) {
    console.error('[CANCEL PINS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
