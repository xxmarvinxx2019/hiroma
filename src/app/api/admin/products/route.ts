import { NextRequest, NextResponse } from 'next/server'
import { createAuditLog, formatMemberId } from '@/app/lib/auditLog'
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

    const stats = { total: 0, physical: 0, digital: 0, active: 0, inactive: 0 }
    for (const row of summary) {
      stats.total    += row._count.id
      if (row.type === 'physical') stats.physical += row._count.id
      if (row.type === 'digital')  stats.digital  += row._count.id
      if (row.is_active)           stats.active   += row._count.id
      else                         stats.inactive += row._count.id
    }

    // Fetch pu_value and binary_eligible via raw SQL
    const productIds = products.map(p => p.id)
    const puData = productIds.length > 0
      ? await prisma.$queryRaw<{ id: string; pu_value: number; binary_eligible: boolean }[]>`
          SELECT id::text, pu_value, binary_eligible FROM products WHERE id::text = ANY(${productIds}::text[])`
      : []
    const puMap = new Map(puData.map(p => [p.id, p]))

    const productsWithPU = products.map(p => ({
      ...p,
      pu_value:        puMap.get(p.id)?.pu_value        ?? 0,
      binary_eligible: puMap.get(p.id)?.binary_eligible ?? true,
    }))

    return NextResponse.json({
      products: productsWithPU, stats,
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

    const {
      name, description, type, image_url,
      srp, cost_price,
      regional_price, provincial_price, city_price, reseller_price,
      pu_value, binary_eligible,
    } = await req.json()

    if (!name || !reseller_price || !srp) {
      return NextResponse.json({ error: 'Name, reseller price and SRP are required.' }, { status: 400 })
    }

    const product = await prisma.product.create({
      data: {
        name:             name.trim(),
        description:      description?.trim() || null,
        type:             type || 'physical',
        price:            parseFloat(srp),
        cost_price:       parseFloat(cost_price       || 0),
        regional_price:   parseFloat(regional_price   || 0),
        provincial_price: parseFloat(provincial_price || 0),
        city_price:       parseFloat(city_price       || 0),
        reseller_price:   parseFloat(reseller_price),
        image_url:        image_url?.trim() || null,
        is_active:        true,
      },
    })

    // Set pu_value and binary_eligible via raw SQL
    const puVal  = pu_value != null ? parseInt(pu_value) : 0
    const binVal = binary_eligible !== false
    await prisma.$executeRaw`UPDATE products SET pu_value = ${puVal}::int, binary_eligible = ${binVal}::boolean WHERE id::text = ${product.id}`

        createAuditLog({
      user_id:       user.id,
      user_name:     user.full_name || user.username,
      user_role:     user.role,
      member_id:     formatMemberId(user.id, user.role),
      activity_type: 'product_updated',
      category:      'product',
      description:   `Product updated`,
      risk_level:    'low',
      status:        'completed',
    })
return NextResponse.json({ success: true, product })
  } catch (error) {
    console.error('[CREATE PRODUCT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const {
      id, name, description, type, image_url, is_active,
      srp, cost_price,
      regional_price, provincial_price, city_price, reseller_price,
      pu_value, binary_eligible,
    } = await req.json()

    if (!id) {
      return NextResponse.json({ error: 'Product ID is required.' }, { status: 400 })
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(name             != null && { name:             name.trim() }),
        ...(description      != null && { description:      description?.trim() || null }),
        ...(type             != null && { type }),
        ...(srp              != null && { price:            parseFloat(srp) }),
        ...(cost_price       != null && { cost_price:       parseFloat(cost_price) }),
        ...(regional_price   != null && { regional_price:   parseFloat(regional_price) }),
        ...(provincial_price != null && { provincial_price: parseFloat(provincial_price) }),
        ...(city_price       != null && { city_price:       parseFloat(city_price) }),
        ...(reseller_price   != null && { reseller_price:   parseFloat(reseller_price) }),
        ...(image_url        != null && { image_url:        image_url?.trim() || null }),
        ...(is_active        != null && { is_active }),
      },
    })

    // pu_value and binary_eligible via raw SQL (columns added outside Prisma schema)
    if (pu_value != null || binary_eligible != null) {
      const puVal  = pu_value        != null ? parseInt(pu_value)            : null
      const binVal = binary_eligible != null ? (binary_eligible !== false)   : null
      if (puVal  != null) await prisma.$executeRaw`UPDATE products SET pu_value = ${puVal}::int WHERE id::text = ${id}`
      if (binVal != null) await prisma.$executeRaw`UPDATE products SET binary_eligible = ${binVal}::boolean WHERE id::text = ${id}`
    }

        createAuditLog({
      user_id:       user.id,
      user_name:     user.full_name || user.username,
      user_role:     user.role,
      member_id:     formatMemberId(user.id, user.role),
      activity_type: 'product_updated',
      category:      'product',
      description:   `Product updated`,
      risk_level:    'low',
      status:        'completed',
    })
return NextResponse.json({ success: true, product })
  } catch (error) {
    console.error('[PATCH PRODUCT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

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