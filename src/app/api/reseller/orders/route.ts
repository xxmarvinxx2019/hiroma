import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET reseller's orders + their city distributor as supplier ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const status   = searchParams.get('status')   || 'all'
    const type     = searchParams.get('type')     || 'all'
    const search   = searchParams.get('search')   || ''
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    // Get city distributor from reseller profile
    const profile = await prisma.resellerProfile.findUnique({
      where: { user_id: user.id },
      select: {
        city_dist: { select: { id: true, full_name: true, username: true } },
      },
    })

    const where: Record<string, unknown> = {
      buyer_id: user.id,
      ...(status !== 'all' && { status }),
      ...(type   !== 'all' && { order_type: type }),
      ...(search && {
        seller: {
          OR: [
            { full_name: { contains: search, mode: 'insensitive' } },
            { username:  { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    }

    const [total, orders, summaryRaw] = await Promise.all([
      prisma.order.count({ where }),

      prisma.order.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id:           true,
          order_type:   true,
          status:       true,
          total_amount: true,
          created_at:   true,
          notes:        true,
          seller: { select: { full_name: true, username: true, role: true } },
          items: {
            select: {
              quantity:   true,
              unit_price: true,
              subtotal:   true,
              product:    { select: { name: true, type: true } },
            },
          },
        },
      }),

      prisma.order.groupBy({
        by: ['status'],
        where: { buyer_id: user.id },
        _count: { status: true },
      }),
    ])

    const summary = { total: 0, pending: 0, processing: 0, delivered: 0, cancelled: 0 }
    for (const row of summaryRaw) {
      const count = row._count.status
      summary.total += count
      if (row.status === 'pending')    summary.pending    = count
      if (row.status === 'processing') summary.processing = count
      if (row.status === 'delivered')  summary.delivered  = count
      if (row.status === 'cancelled')  summary.cancelled  = count
    }

    return NextResponse.json({
      orders,
      summary,
      supplier: profile?.city_dist || null,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[RESELLER ORDERS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST place a new order to city distributor ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_type, notes, items } = await req.json()

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Order must have at least one item.' }, { status: 400 })
    }

    if (!['online', 'offline'].includes(order_type)) {
      return NextResponse.json({ error: 'Invalid order type.' }, { status: 400 })
    }

    // Get city distributor
    const profile = await prisma.resellerProfile.findUnique({
      where: { user_id: user.id },
      select: {
        city_dist: { select: { id: true, full_name: true, username: true } },
      },
    })

    if (!profile?.city_dist) {
      return NextResponse.json({ error: 'City distributor not found.' }, { status: 400 })
    }

    // Validate products
    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, is_active: true },
      select: { id: true, name: true, price: true, reseller_price: true },
    })

    if (products.length !== productIds.length) {
      return NextResponse.json({ error: 'One or more products not found or inactive.' }, { status: 400 })
    }

    const productMap = new Map(products.map((p) => [p.id, p]))
    let total_amount = 0

    const orderItems = items.map((item: { product_id: string; quantity: number; unit_price?: number }) => {
      const product    = productMap.get(item.product_id)!
      const unit_price = item.unit_price ?? Number(product.reseller_price || product.price)
      const subtotal   = unit_price * item.quantity
      total_amount    += subtotal
      return { product_id: item.product_id, quantity: item.quantity, unit_price, subtotal }
    })

    const order = await prisma.order.create({
      data: {
        buyer_id:          user.id,
        seller_id:         profile.city_dist.id,
        order_type,
        status:            'pending',
        total_amount,
        is_cross_purchase: false,
        notes:             notes?.trim() || null,
        items:             { create: orderItems },
      },
      select: {
        id: true, status: true, total_amount: true, created_at: true,
        seller: { select: { full_name: true, username: true } },
      },
    })

    return NextResponse.json({
      success: true,
      message: `Order placed to ${profile.city_dist.full_name}.`,
      order,
    })
  } catch (error) {
    console.error('[RESELLER ORDERS POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH cancel a pending order ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_id } = await req.json()
    if (!order_id) {
      return NextResponse.json({ error: 'order_id is required.' }, { status: 400 })
    }

    const order = await prisma.order.findFirst({
      where: { id: order_id, buyer_id: user.id, status: 'pending' },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found or cannot be cancelled.' }, { status: 404 })
    }

    const updated = await prisma.order.update({
      where: { id: order_id },
      data:  { status: 'cancelled' },
    })

    return NextResponse.json({ success: true, order: updated })
  } catch (error) {
    console.error('[RESELLER ORDERS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}