import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { pin_code } = await req.json()

    if (!pin_code) {
      return NextResponse.json({ error: 'PIN code is required.' }, { status: 400 })
    }

    const pin = await prisma.pin.findUnique({
      where: { pin_code: pin_code.trim().toUpperCase() },
      select: {
        id:           true,
        pin_code:     true,
        status:       true,
        city_dist_id: true,
        package: {
          select: {
            id:    true,
            name:  true,
            price: true,
            products: {
              select: {
                quantity: true,
                product:  { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    })

    if (!pin) {
      return NextResponse.json({ error: 'PIN not found. Please check and try again.' }, { status: 404 })
    }

    if (pin.status !== 'unused') {
      return NextResponse.json({ error: `This PIN has already been ${pin.status}.` }, { status: 400 })
    }

    if (pin.city_dist_id !== user.id) {
      return NextResponse.json({ error: 'This PIN does not belong to your account.' }, { status: 400 })
    }

    // ── Check city distributor has enough inventory for all package products ──
    const packageProductIds = pin.package.products.map((pp) => pp.product.id)

    const inventoryItems = await prisma.inventory.findMany({
      where:  { owner_id: user.id, product_id: { in: packageProductIds } },
      select: { product_id: true, quantity: true },
    })

    const inventoryMap = new Map(inventoryItems.map((i) => [i.product_id, i.quantity]))

    const stockErrors = pin.package.products
      .filter((pp) => (inventoryMap.get(pp.product.id) ?? 0) < pp.quantity)
      .map((pp) => `"${pp.product.name}": need ${pp.quantity}, only ${inventoryMap.get(pp.product.id) ?? 0} in stock`)

    if (stockErrors.length > 0) {
      return NextResponse.json({
        error: `Insufficient inventory for package "${pin.package.name}":\n${stockErrors.join('\n')}`,
      }, { status: 400 })
    }

    return NextResponse.json({ pin })
  } catch (error) {
    console.error('[VERIFY PIN ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}