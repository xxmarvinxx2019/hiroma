import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    // for_reseller=true → use reseller_price (walk-in orders)
    // default          → use city_price (city dist ordering from supplier)
    const forReseller = searchParams.get('for_reseller') === 'true'

    const profile = await prisma.distributorProfile.findUnique({
      where:  { user_id: user.id },
      select: { id: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Distributor profile not found.' }, { status: 404 })
    }

    const visibilityRules = await prisma.productAreaVisibility.findMany({
      where:  { distributor_id: profile.id },
      select: { product_id: true, is_visible: true },
    })

    const hiddenProductIds = visibilityRules
      .filter((r) => !r.is_visible)
      .map((r) => r.product_id)

    const products = await prisma.product.findMany({
      where: {
        is_active: true,
        ...(hiddenProductIds.length > 0 && { id: { notIn: hiddenProductIds } }),
      },
      orderBy: { name: 'asc' },
      select: {
        id:              true,
        name:            true,
        type:            true,
        city_price:      true,
        reseller_price:  true,
        description:     true,
        image_url:       true,
      },
    })

    // Get city distributor's inventory quantities
    const productIds = products.map((p) => p.id)
    const inventory  = await prisma.inventory.findMany({
      where:  { owner_id: user.id, product_id: { in: productIds } },
      select: { product_id: true, quantity: true },
    })

    const inventoryMap = new Map(inventory.map((i) => [i.product_id, i.quantity]))

    const mapped = products.map((p) => ({
      id:                 p.id,
      name:               p.name,
      type:               p.type,
      description:        p.description,
      image_url:          p.image_url,
      // Use reseller_price for walk-in orders, city_price for supplier orders
      price:              forReseller ? Number(p.reseller_price) : Number(p.city_price),
      available_quantity: inventoryMap.get(p.id) ?? 0,
    }))

    // For walk-in: only show products actually in stock
    const filtered = forReseller
      ? mapped.filter((p) => p.available_quantity > 0)
      : mapped

    return NextResponse.json({ products: filtered })
  } catch (error) {
    console.error('[CITY PRODUCTS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}