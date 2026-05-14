import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET products visible to this city distributor ──
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get this city distributor's profile id
    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { id: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Distributor profile not found.' }, { status: 404 })
    }

    // Get products that are:
    // 1. Active
    // 2. Either visible via ProductAreaVisibility OR have no visibility rule (visible to all)
    const visibilityRules = await prisma.productAreaVisibility.findMany({
      where: { distributor_id: profile.id },
      select: { product_id: true, is_visible: true },
    })

    const hiddenProductIds = visibilityRules
      .filter((r) => !r.is_visible)
      .map((r) => r.product_id)

    const products = await prisma.product.findMany({
      where: {
        is_active: true,
        ...(hiddenProductIds.length > 0 && {
          id: { notIn: hiddenProductIds },
        }),
      },
      orderBy: { name: 'asc' },
      select: {
        id:          true,
        name:        true,
        type:        true,
        city_price: true,
        description: true,
        image_url:   true,
      },
    })

    const mapped = products.map((p: any) => ({ ...p, price: Number(p.city_price) }))
    return NextResponse.json({ products: mapped })
  } catch (error) {
    console.error('[CITY PRODUCTS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}