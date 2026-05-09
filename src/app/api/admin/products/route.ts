import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const search   = searchParams.get('search') || ''
    const type     = searchParams.get('type')   || 'all'
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const where: Record<string, unknown> = {
      ...(type !== 'all' && { type }),
      ...(search && {
        OR: [
          { name:        { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    }

    const [total, products, summary] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.product.groupBy({
        by: ['type', 'is_active'],
        _count: { id: true },
      }),
    ])

    const stats = {
      total:    0,
      physical: 0,
      digital:  0,
      active:   0,
      inactive: 0,
    }
    for (const row of summary) {
      stats.total    += row._count.id
      if (row.type === 'physical') stats.physical += row._count.id
      if (row.type === 'digital')  stats.digital  += row._count.id
      if (row.is_active)           stats.active   += row._count.id
      else                         stats.inactive += row._count.id
    }

    return NextResponse.json({
      products,
      stats,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[GET PRODUCTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { name, description, type, cost_price, regional_price, provincial_price, city_price, reseller_price, image_url } = await req.json()

    if (!name || !reseller_price) {
      return NextResponse.json({ error: 'Name and reseller price are required.' }, { status: 400 })
    }

    const product = await prisma.product.create({
      data: {
        name:             name.trim(),
        description:      description?.trim() || null,
        type:             type || 'physical',
        price:            reseller_price, // keep price in sync with reseller_price
        cost_price:       parseFloat(cost_price       || 0),
        regional_price:   parseFloat(regional_price   || 0),
        provincial_price: parseFloat(provincial_price || 0),
        city_price:       parseFloat(city_price       || 0),
        reseller_price:   parseFloat(reseller_price),
        image_url:        image_url?.trim() || null,
        is_active:        true,
      },
    })

    return NextResponse.json({ success: true, product })
  } catch (error) {
    console.error('[CREATE PRODUCT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
// ── PATCH update product ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, name, description, type, cost_price, regional_price, provincial_price, city_price, reseller_price, image_url, is_active } = await req.json()

    if (!id) {
      return NextResponse.json({ error: 'Product ID is required.' }, { status: 400 })
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(name             != null && { name:             name.trim() }),
        ...(description      != null && { description:      description?.trim() || null }),
        ...(type             != null && { type }),
        ...(cost_price       != null && { cost_price:       parseFloat(cost_price) }),
        ...(regional_price   != null && { regional_price:   parseFloat(regional_price) }),
        ...(provincial_price != null && { provincial_price: parseFloat(provincial_price) }),
        ...(city_price       != null && { city_price:       parseFloat(city_price) }),
        ...(reseller_price   != null && { reseller_price:   parseFloat(reseller_price), price: parseFloat(reseller_price) }),
        ...(image_url        != null && { image_url:        image_url?.trim() || null }),
        ...(is_active        != null && { is_active }),
      },
    })

    return NextResponse.json({ success: true, product })
  } catch (error) {
    console.error('[PATCH PRODUCT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── DELETE product ──
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await req.json()
    if (!id) {
      return NextResponse.json({ error: 'Product ID is required.' }, { status: 400 })
    }

    // Soft delete — just deactivate
    await prisma.product.update({
      where: { id },
      data:  { is_active: false },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE PRODUCT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}