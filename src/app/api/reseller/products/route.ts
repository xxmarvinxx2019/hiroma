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

    const { searchParams } = req.nextUrl
    const requestedCityDistId = searchParams.get('city_dist_id')

    let cityDistId = requestedCityDistId

    if (!cityDistId) {
      const profile = await prisma.resellerProfile.findUnique({
        where:  { user_id: user.id },
        select: { city_dist_id: true },
      })
      if (!profile) {
        return NextResponse.json({ error: 'Reseller profile not found.' }, { status: 404 })
      }
      cityDistId = profile.city_dist_id
    }

    // Validate city distributor
    const cityDist = await prisma.user.findFirst({
      where:  { id: cityDistId, role: 'city', status: 'active' },
      select: { id: true, full_name: true },
    })

    if (!cityDist) {
      return NextResponse.json({ error: 'City distributor not found or inactive.' }, { status: 404 })
    }

    // Get products in stock
    const inventory = await prisma.inventory.findMany({
      where: {
        owner_id: cityDistId,
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

    return NextResponse.json({ products, city_dist: cityDist })
  } catch (error) {
    console.error('[RESELLER PRODUCTS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}