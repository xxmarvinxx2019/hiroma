import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET inventory across all distributors or filtered by distributor ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const owner_id = searchParams.get('owner_id') || ''
    const search   = searchParams.get('search')   || ''
    const type     = searchParams.get('type')     || 'all'
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '20'))

    const productFilter: Record<string, unknown> = {
      ...(type !== 'all' && { type }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    }

    const where: Record<string, unknown> = {
      owner: { role: { in: ['regional', 'provincial', 'city'] } },
      ...(owner_id && { owner_id }),
      ...(Object.keys(productFilter).length > 0 && { product: productFilter }),
    }

    const [total, items] = await Promise.all([
      prisma.inventory.count({ where }),
      prisma.inventory.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id:                  true,
          quantity:            true,
          low_stock_threshold: true,
          updated_at:          true,
          owner: { select: { id: true, full_name: true, username: true, role: true } },
          product: { select: { id: true, name: true, type: true, price: true } },
        },
      }),
    ])

    // Get all distributors for the filter dropdown
    const distributors = await prisma.user.findMany({
      where: { role: { in: ['regional', 'provincial', 'city'] }, status: 'active' },
      select: { id: true, full_name: true, username: true, role: true },
      orderBy: { role: 'asc' },
    })

    return NextResponse.json({
      items,
      distributors,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[ADMIN INVENTORY GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST assign or add stock to a distributor ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { owner_id, product_id, quantity, low_stock_threshold } = await req.json()

    if (!owner_id || !product_id || quantity == null || quantity < 0) {
      return NextResponse.json({ error: 'owner_id, product_id, and quantity are required.' }, { status: 400 })
    }

    // Validate owner is a distributor
    const owner = await prisma.user.findFirst({
      where: { id: owner_id, role: { in: ['regional', 'provincial', 'city'] } },
    })
    if (!owner) {
      return NextResponse.json({ error: 'Distributor not found.' }, { status: 404 })
    }

    // Validate product exists
    const product = await prisma.product.findFirst({
      where: { id: product_id, is_active: true },
    })
    if (!product) {
      return NextResponse.json({ error: 'Product not found.' }, { status: 404 })
    }

    // Upsert — create if not exists, increment if exists
    const item = await prisma.inventory.upsert({
      where: {
        owner_id_product_id: { owner_id, product_id },
      },
      update: {
        quantity:            { increment: parseInt(quantity) },
        low_stock_threshold: low_stock_threshold != null ? parseInt(low_stock_threshold) : undefined,
      },
      create: {
        owner_id,
        product_id,
        quantity:            parseInt(quantity),
        low_stock_threshold: low_stock_threshold != null ? parseInt(low_stock_threshold) : 10,
      },
    })

    return NextResponse.json({ success: true, item })
  } catch (error) {
    console.error('[ADMIN INVENTORY POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH set exact quantity or threshold ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { inventory_id, quantity, low_stock_threshold } = await req.json()

    if (!inventory_id) {
      return NextResponse.json({ error: 'inventory_id is required.' }, { status: 400 })
    }

    const item = await prisma.inventory.findUnique({ where: { id: inventory_id } })
    if (!item) {
      return NextResponse.json({ error: 'Inventory item not found.' }, { status: 404 })
    }

    const updated = await prisma.inventory.update({
      where: { id: inventory_id },
      data: {
        ...(quantity            != null && { quantity:            Math.max(0, parseInt(quantity)) }),
        ...(low_stock_threshold != null && { low_stock_threshold: Math.max(0, parseInt(low_stock_threshold)) }),
      },
    })

    return NextResponse.json({ success: true, item: updated })
  } catch (error) {
    console.error('[ADMIN INVENTORY PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}