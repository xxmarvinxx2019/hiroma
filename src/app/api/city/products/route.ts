import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

async function resolveSupplier(cityUserId: string) {
  const cityProfile = await prisma.distributorProfile.findUnique({
    where: { user_id: cityUserId },
    select: {
      region_code: true, province_code: true, parent_dist_id: true,
      parent: {
        include: {
          user: { select: { id: true } },
          parent: { include: { user: { select: { id: true } } } },
        },
      },
    },
  })

  if (cityProfile?.parent?.dist_level === 'provincial' && cityProfile.parent.is_active)
    return cityProfile.parent.user.id

  if (cityProfile?.parent?.dist_level === 'regional' && cityProfile.parent.is_active)
    return cityProfile.parent.user.id

  if (cityProfile?.province_code) {
    const provincial = await prisma.distributorProfile.findFirst({
      where: { dist_level: 'provincial', province_code: cityProfile.province_code, is_active: true },
      select: { user_id: true },
    })
    if (provincial) return provincial.user_id
  }

  if (cityProfile?.region_code) {
    const regional = await prisma.distributorProfile.findFirst({
      where: { dist_level: 'regional', region_code: cityProfile.region_code, is_active: true },
      select: { user_id: true },
    })
    if (regional) return regional.user_id
  }

  const admin = await prisma.user.findFirst({
    where: { role: 'admin' }, select: { id: true },
  })
  return admin?.id || null
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const forOrdering  = searchParams.get('for_ordering') === 'true'
    const forReseller  = searchParams.get('for_reseller') === 'true'

    // ── For walk-in reseller orders: return city dist's own inventory ──
    if (forReseller) {
      const inventory = await prisma.inventory.findMany({
        where: { owner_id: user.id, quantity: { gt: 0 } },
        select: {
          quantity: true,
          product: {
            select: {
              id: true, name: true, type: true,
              reseller_price: true, is_active: true,
            },
          },
        },
      })

      const products = inventory
        .filter((i) => i.product.is_active)
        .map((i) => ({
          id:                 i.product.id,
          name:               i.product.name,
          type:               i.product.type,
          price:              Number(i.product.reseller_price),
          available_quantity: i.quantity,
        }))

      return NextResponse.json({ products })
    }

    // ── For ordering from supplier: return supplier's inventory ──
    if (forOrdering) {
      const supplierId = await resolveSupplier(user.id)
      if (!supplierId) return NextResponse.json({ products: [] })

      const inventory = await prisma.inventory.findMany({
        where: { owner_id: supplierId, quantity: { gt: 0 } },
        select: {
          quantity: true,
          product: {
            select: {
              id: true, name: true, type: true,
              city_price: true, is_active: true,
            },
          },
        },
      })

      const products = inventory
        .filter((i) => i.product.is_active)
        .map((i) => ({
          id:                 i.product.id,
          name:               i.product.name,
          type:               i.product.type,
          price:              Number(i.product.city_price),
          available_quantity: i.quantity,
        }))

      return NextResponse.json({ products })
    }

    // ── Default: return all active products visible to city dist (no stock check) ──
    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { id: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Distributor profile not found.' }, { status: 404 })
    }

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
        ...(hiddenProductIds.length > 0 && { id: { notIn: hiddenProductIds } }),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, type: true,
        city_price: true, description: true, image_url: true,
      },
    })

    const mapped = products.map((p: any) => ({ ...p, price: Number(p.city_price) }))
    return NextResponse.json({ products: mapped })
  } catch (error) {
    console.error('[CITY PRODUCTS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}