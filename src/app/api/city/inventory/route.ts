import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET city distributor's inventory with search & pagination ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const search   = searchParams.get('search') || ''
    const type     = searchParams.get('type') || 'all'
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const productFilter: Record<string, unknown> = {
      ...(type !== 'all' && { type }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    }

    const where: Record<string, unknown> = {
      owner_id: user.id,
      ...(Object.keys(productFilter).length > 0 && { product: productFilter }),
    }

    const [total, items] = await Promise.all([
      prisma.inventory.count({ where }),
      prisma.inventory.findMany({
        where,
        orderBy: { quantity: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id:                  true,
          quantity:            true,
          low_stock_threshold: true,
          updated_at:          true,
          product: {
            select: { id: true, name: true, type: true, price: true, is_active: true },
          },
        },
      }),
    ])

    // Summary
    const all = await prisma.inventory.findMany({
      where: { owner_id: user.id },
      select: { quantity: true, low_stock_threshold: true },
    })
    const summary = {
      total_products: all.length,
      low_stock:  all.filter((i) => i.quantity <= i.low_stock_threshold && i.quantity > 0).length,
      out_of_stock: all.filter((i) => i.quantity === 0).length,
      total_units: all.reduce((s, i) => s + i.quantity, 0),
    }

    return NextResponse.json({
      items,
      summary,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    })
  } catch (error) {
    console.error('[CITY INVENTORY ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH update stock threshold for an inventory item ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { inventory_id, low_stock_threshold } = await req.json()

    if (!inventory_id || low_stock_threshold == null) {
      return NextResponse.json({ error: 'Missing fields.' }, { status: 400 })
    }

    // Make sure it belongs to this city distributor
    const item = await prisma.inventory.findFirst({
      where: { id: inventory_id, owner_id: user.id },
    })
    if (!item) {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 })
    }

    const updated = await prisma.inventory.update({
      where: { id: inventory_id },
      data:  { low_stock_threshold: Math.max(0, parseInt(low_stock_threshold)) },
    })

    return NextResponse.json({ success: true, item: updated })
  } catch (error) {
    console.error('[CITY INVENTORY PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}