import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET all packages ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))
    const search   = searchParams.get('search') || ''
    const active   = searchParams.get('active') === 'true'

    const where: Record<string, unknown> = {
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
      ...(active && { is_active: true }),
    }

    const total    = await prisma.package.count({ where })
    const packages = await prisma.package.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      include: {
        products: {
          include: {
            product: { select: { name: true, price: true, reseller_price: true } },
          },
        },
      },
    })

    // Fetch daily_product_pairing_cap via raw SQL and merge
    const ids  = packages.map(p => p.id)
    let caps: {
      id: string
      daily_product_pairing_cap: number
      product_binary_cap_enabled: boolean
      direct_referral_cap_enabled: boolean
      daily_referral_cap: number
      binary_pair_cap_enabled: boolean
      daily_binary_pair_cap: number
    }[] = []

    if (ids.length > 0) {
      try {
        caps = await prisma.$queryRaw`
          SELECT id::text,
                 COALESCE(daily_product_pairing_cap, 50)::int AS daily_product_pairing_cap,
                 COALESCE(product_binary_cap_enabled, true) AS product_binary_cap_enabled,
                 COALESCE(direct_referral_cap_enabled, true) AS direct_referral_cap_enabled,
                 COALESCE(daily_referral_cap, 10)::int AS daily_referral_cap,
                 COALESCE(binary_pair_cap_enabled, true) AS binary_pair_cap_enabled,
                 COALESCE(daily_binary_pair_cap, 10)::int AS daily_binary_pair_cap
          FROM packages
          WHERE id::text = ANY(${ids}::text[])
        `
      } catch (capError) {
        // Keep existing package records visible while a newly added cap migration
        // is still pending. The package rows themselves are not missing.
        console.warn('[PACKAGES CAP CONFIG FALLBACK]', capError)
        caps = packages.map((pkg) => ({
          id: pkg.id,
          daily_product_pairing_cap: 50,
          product_binary_cap_enabled: true,
          direct_referral_cap_enabled: true,
          daily_referral_cap: 10,
          binary_pair_cap_enabled: true,
          daily_binary_pair_cap:
            pkg.name.toLowerCase() === 'gold'
              ? 50
              : pkg.name.toLowerCase() === 'silver'
                ? 30
                : 10,
        }))
      }
    }
    const capMap = new Map(caps.map(c => [c.id, c.daily_product_pairing_cap]))

    const packagesWithCap = packages.map(p => ({
      ...p,
      daily_product_pairing_cap: capMap.get(p.id) ?? 50,
      product_binary_cap_enabled: caps.find(c => c.id === p.id)?.product_binary_cap_enabled ?? true,
      direct_referral_cap_enabled: caps.find(c => c.id === p.id)?.direct_referral_cap_enabled ?? true,
      daily_referral_cap: caps.find(c => c.id === p.id)?.daily_referral_cap ?? 10,
      binary_pair_cap_enabled: caps.find(c => c.id === p.id)?.binary_pair_cap_enabled ?? true,
      daily_binary_pair_cap: caps.find(c => c.id === p.id)?.daily_binary_pair_cap ?? 10,
    }))

    return NextResponse.json({
      packages: packagesWithCap,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[GET PACKAGES ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST create package ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      name, price, direct_referral_bonus, pairing_bonus_value,
      point_php_value, point_reset_days, daily_product_pairing_cap,
      product_binary_cap_enabled,
      direct_referral_cap_enabled, daily_referral_cap, products,
      binary_pair_cap_enabled, daily_binary_pair_cap,
    } = await req.json()
    const productBinaryCapEnabled =
      typeof product_binary_cap_enabled === 'boolean' ? product_binary_cap_enabled : null

    if (!name || !price || !direct_referral_bonus || !pairing_bonus_value || !point_php_value) {
      return NextResponse.json({ error: 'All required fields must be filled.' }, { status: 400 })
    }

    let newPkg: any
    await prisma.$transaction(async (tx) => {
      newPkg = await tx.package.create({
        data: {
          name: name.trim(), price, direct_referral_bonus, pairing_bonus_value,
          point_php_value, point_reset_days: point_reset_days || 30, is_active: true,
        },
      })

      if (products && products.length > 0) {
        await tx.packageProduct.createMany({
          data: products
            .filter((p: any) => p.product_id)
            .map((p: any) => ({ package_id: newPkg.id, product_id: p.product_id, quantity: p.quantity || 1 })),
        })
      }
    })

    // Update package-level caps via raw SQL after transaction
    await prisma.$executeRaw`
      UPDATE packages
      SET daily_product_pairing_cap = ${daily_product_pairing_cap || 50},
          product_binary_cap_enabled = COALESCE(${productBinaryCapEnabled}, product_binary_cap_enabled),
          direct_referral_cap_enabled = ${direct_referral_cap_enabled !== false},
          daily_referral_cap = ${Math.max(1, Number(daily_referral_cap) || 10)},
          binary_pair_cap_enabled = ${binary_pair_cap_enabled !== false},
          daily_binary_pair_cap = ${Math.max(1, Number(daily_binary_pair_cap) || 10)}
      WHERE id::text = ${newPkg.id}
    `

    return NextResponse.json({ success: true, package: newPkg })
  } catch (error) {
    console.error('[CREATE PACKAGE ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PUT update package ──
export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = req.nextUrl.pathname
    const id  = url.split('/').pop()
    if (!id) return NextResponse.json({ error: 'Missing package ID.' }, { status: 400 })

    const {
      name, price, direct_referral_bonus, pairing_bonus_value,
      point_php_value, point_reset_days, daily_product_pairing_cap,
      product_binary_cap_enabled,
      direct_referral_cap_enabled, daily_referral_cap, products,
      binary_pair_cap_enabled, daily_binary_pair_cap,
    } = await req.json()
    const productBinaryCapEnabled =
      typeof product_binary_cap_enabled === 'boolean' ? product_binary_cap_enabled : null

    if (!name || !price || !direct_referral_bonus || !pairing_bonus_value || !point_php_value) {
      return NextResponse.json({ error: 'All required fields must be filled.' }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.package.update({
        where: { id },
        data: {
          name: name.trim(), price, direct_referral_bonus, pairing_bonus_value,
          point_php_value, point_reset_days: point_reset_days || 30,
        },
      })

      // Replace products
      await tx.packageProduct.deleteMany({ where: { package_id: id } })
      if (products && products.length > 0) {
        await tx.packageProduct.createMany({
          data: products
            .filter((p: any) => p.product_id)
            .map((p: any) => ({ package_id: id, product_id: p.product_id, quantity: p.quantity || 1 })),
        })
      }
    })

    // Update package-level caps via raw SQL
    await prisma.$executeRaw`
      UPDATE packages
      SET daily_product_pairing_cap = ${daily_product_pairing_cap || 50},
          product_binary_cap_enabled = COALESCE(${productBinaryCapEnabled}, product_binary_cap_enabled),
          direct_referral_cap_enabled = ${direct_referral_cap_enabled !== false},
          daily_referral_cap = ${Math.max(1, Number(daily_referral_cap) || 10)},
          binary_pair_cap_enabled = ${binary_pair_cap_enabled !== false},
          daily_binary_pair_cap = ${Math.max(1, Number(daily_binary_pair_cap) || 10)}
      WHERE id::text = ${id}
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[UPDATE PACKAGE ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH toggle active ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = req.nextUrl.pathname
    const id  = url.split('/').pop()
    if (!id) return NextResponse.json({ error: 'Missing package ID.' }, { status: 400 })

    const { is_active } = await req.json()

    await prisma.package.update({
      where: { id },
      data:  { is_active },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[TOGGLE PACKAGE ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
