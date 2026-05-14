import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

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
    const status   = searchParams.get('status')   || 'all'
    const search   = searchParams.get('search')   || ''
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const where: any = {
      ...(status !== 'all' && { status }),
      ...(search && {
        OR: [
          { pin_code:         { contains: search, mode: 'insensitive' } },
          { city_distributor: { full_name: { contains: search, mode: 'insensitive' } } },
          { city_distributor: { username:  { contains: search, mode: 'insensitive' } } },
          { used_by_user:     { full_name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    }

    const [total, pins, summaryRaw] = await Promise.all([
      prisma.pin.count({ where }),

      prisma.pin.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, pin_code: true, status: true,
          created_at: true, used_at: true,
          package:          { select: { name: true, price: true } },
          city_distributor: { select: { full_name: true, username: true } },
          used_by_user:     { select: { full_name: true, username: true } },
        },
      }),

      prisma.pin.groupBy({
        by: ['status'],
        _count: { status: true },
      }),
    ])

    const summary = { total: 0, unused: 0, used: 0, expired: 0 }
    for (const row of summaryRaw) {
      summary.total += row._count.status
      if (row.status === 'unused')  summary.unused  = row._count.status
      if (row.status === 'used')    summary.used    = row._count.status
      if (row.status === 'expired') summary.expired = row._count.status
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

    const { package_id, city_dist_id, quantity } = await req.json()

    if (!package_id || !city_dist_id || !quantity) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }

    if (quantity < 1 || quantity > 50) {
      return NextResponse.json(
        { error: 'Quantity must be between 1 and 50.' },
        { status: 400 }
      )
    }

    // ── Get package details ──
    const pkg = await prisma.package.findUnique({
      where: { id: package_id },
      select: { name: true, price: true },
    })

    if (!pkg) {
      return NextResponse.json({ error: 'Package not found.' }, { status: 404 })
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

    const totalAmount = Number(pkg.price) * quantity

    // ── Create PINs + record as a sale order ──
    await prisma.$transaction(async (tx) => {

      // 1. Bulk create PINs
      await tx.pin.createMany({
        data: pinCodes.map((pin_code) => ({
          pin_code,
          package_id,
          city_dist_id,
          status: 'unused',
          generated_by: user.id,
        })),
      })

      // 2. Record the PIN sale as an order (admin → city distributor)
      // Note: no order_items needed since this is a PIN sale not a product sale
      await tx.order.create({
        data: {
          buyer_id: city_dist_id,
          seller_id: user.id,
          order_type: 'online',
          status: 'delivered',
          total_amount: totalAmount,
          is_cross_purchase: false,
          notes: `PIN sale: ${quantity} × ${pkg.name} package @ ₱${Number(pkg.price).toLocaleString()} each`,
        },
      })

    })

    return NextResponse.json({
      success: true,
      pins: pinCodes,
      message: `${quantity} PIN${quantity > 1 ? 's' : ''} generated and sold to city distributor.`,
    })
  } catch (error) {
    console.error('[GENERATE PINS ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please check server logs.' },
      { status: 500 }
    )
  }
}