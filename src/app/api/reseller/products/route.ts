import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET products from a specific city distributor's inventory ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sellerId = req.nextUrl.searchParams.get('seller_id') || req.nextUrl.searchParams.get('city_dist_id')
    if (!sellerId) {
      return NextResponse.json({ error: 'seller_id is required.' }, { status: 400 })
    }

    // Validate city distributor
    const seller = await prisma.user.findFirst({
      where:  { id: sellerId, role: { in: ['city', 'admin'] }, status: 'active' },
      select: { id: true, full_name: true, role: true },
    })

    if (!seller) {
      return NextResponse.json({ error: 'The selected Hiroma fulfillment location is unavailable.' }, { status: 404 })
    }

    // Get products in stock
    const inventory = await prisma.inventory.findMany({
      where: {
        owner_id: sellerId,
        quantity: { gt: 0 },
        product:  { is_active: true },
      },
      select: {
        quantity: true,
        product: {
          select: {
            id:             true,
            name:           true,
            type:           true,
            reseller_price: true,
            description:    true,
          },
        },
      },
      orderBy: { product: { name: 'asc' } },
    })

    const products = inventory.map((i) => ({
      id:                 i.product.id,
      name:               i.product.name,
      type:               i.product.type,
      description:        i.product.description,
      price:              Number(i.product.reseller_price),
      available_quantity: i.quantity,
    }))

    return NextResponse.json({ products, seller })
  } catch (error) {
    console.error('[RESELLER PRODUCTS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
