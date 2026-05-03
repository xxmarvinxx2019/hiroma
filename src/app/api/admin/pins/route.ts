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

// ── GET all PINs ──
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const pins = await prisma.pin.findMany({
      orderBy: { created_at: 'desc' },
      take: 100,
      select: {
        id: true,
        pin_code: true,
        status: true,
        created_at: true,
        used_at: true,
        package: { select: { name: true, price: true } },
        city_distributor: { select: { full_name: true, username: true } },
        used_by_user: { select: { full_name: true, username: true } },
      },
    })

    return NextResponse.json({ pins })
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

    // ── Get admin user ──
    const adminUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true },
    })

    if (!adminUser) {
      return NextResponse.json({ error: 'Admin not found.' }, { status: 404 })
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

    // ── Create PINs + record as a sale order in one transaction ──
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

      // 2. Record as a sale order (admin → city distributor)
      // Total = package price × quantity
      const totalAmount = Number(pkg.price) * quantity

      const order = await tx.order.create({
        data: {
          buyer_id: city_dist_id,
          seller_id: user.id,
          order_type: 'online',
          status: 'delivered',
          total_amount: totalAmount,
          is_cross_purchase: false,
          notes: `PIN sale: ${quantity} × ${pkg.name} package`,
        },
      })

      // 3. Add order items — one line per PIN quantity
      await tx.orderItem.create({
        data: {
          order_id: order.id,
          product_id: package_id, // using package_id as reference
          quantity,
          unit_price: Number(pkg.price),
          subtotal: totalAmount,
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
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}