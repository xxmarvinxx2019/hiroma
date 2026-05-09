import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET products available from reseller's city distributor ──
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get city distributor
    const profile = await prisma.resellerProfile.findUnique({
      where: { user_id: user.id },
      select: { city_dist_id: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Reseller profile not found.' }, { status: 404 })
    }

    // Get products that city distributor has in stock (quantity > 0)
    const inventory = await prisma.inventory.findMany({
      where: {
        owner_id: profile.city_dist_id,
        quantity: { gt: 0 },
        product:  { is_active: true },
      },
      select: {
        quantity: true,
        product: {
          select: { id: true, name: true, type: true, reseller_price: true },
        },
      },
      orderBy: { product: { name: 'asc' } },
    })

    const products = inventory.map((i) => ({
      ...i.product,
      price: Number(i.product.reseller_price),
      available_quantity: i.quantity,
    }))

    const mapped = products.map((p: any) => ({ ...p, price: Number(p.reseller_price) }))
    return NextResponse.json({ products: mapped })
  } catch (error) {
    console.error('[RESELLER PRODUCTS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}