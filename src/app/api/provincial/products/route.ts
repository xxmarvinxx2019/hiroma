import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { loadSupplierOrderCatalog, OrderingSupplierChangedError } from '@/app/lib/orderingSupplier'

// ── GET products visible to this city distributor ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'provincial') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (req.nextUrl.searchParams.get('for_ordering') === 'true') {
      const catalog = await prisma.$transaction(tx => loadSupplierOrderCatalog(tx, user.id, 'provincial', req.nextUrl.searchParams.get('supplier_id')), { isolationLevel: 'RepeatableRead' })
      return NextResponse.json(catalog, { headers: { 'Cache-Control': 'private, no-store' } })
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
        provincial_price: true,
        description: true,
        image_url:   true,
      },
    })

    const mapped = products.map((p) => ({ ...p, price: Number(p.provincial_price) }))
    return NextResponse.json({ products: mapped })
  } catch (error) {
    if (error instanceof OrderingSupplierChangedError) return NextResponse.json({ error: error.message }, { status: 409 })
    console.error('[PROVINCIAL PRODUCTS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}