import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET all distributor orders with filter, search & pagination ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const status   = searchParams.get('status')   || 'all'
    const type     = searchParams.get('type')     || 'all'
    const level    = searchParams.get('level')    || 'all'
    const search   = searchParams.get('search')   || ''
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const distRoles = level === 'all'
      ? ['regional', 'provincial', 'city']
      : [level]

    const where: Record<string, unknown> = {
      buyer: { role: { in: distRoles } },
      ...(status !== 'all' && { status }),
      ...(type   !== 'all' && { order_type: type }),
      ...(search && {
        OR: [
          { buyer:  { full_name: { contains: search, mode: 'insensitive' } } },
          { buyer:  { username:  { contains: search, mode: 'insensitive' } } },
          { seller: { full_name: { contains: search, mode: 'insensitive' } } },
        ],
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
          buyer:  { select: { full_name: true, username: true, role: true } },
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
        where: { buyer: { role: { in: ['regional', 'provincial', 'city'] } } },
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
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[ADMIN ORDERS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH update order status + credit inventory on delivery ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_id, status } = await req.json()
    const allowed = ['pending', 'processing', 'delivered', 'cancelled']

    if (!order_id || !allowed.includes(status)) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    // Fetch order WITH items so we have product_id + quantity for inventory
    const order = await prisma.order.findFirst({
      where: { id: order_id, buyer: { role: { in: ['regional', 'provincial', 'city'] } } },
      include: { items: true },
    })
    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    if (order.status === 'delivered' || order.status === 'cancelled') {
      return NextResponse.json({ error: 'Order is already finalized.' }, { status: 400 })
    }

    // ── Validate seller inventory before delivering ──
    if (status === 'delivered') {
      const stockErrors: string[] = []
      for (const item of order.items) {
        const inv = await prisma.inventory.findFirst({
          where:  { owner_id: order.seller_id, product_id: item.product_id },
          select: { quantity: true },
        })
        const available = inv?.quantity || 0
        if (available < item.quantity) {
          const product = await prisma.product.findUnique({
            where:  { id: item.product_id },
            select: { name: true },
          })
          stockErrors.push(
            `Insufficient stock for "${product?.name || item.product_id}": need ${item.quantity}, have ${available}`
          )
        }
      }
      if (stockErrors.length > 0) {
        return NextResponse.json({
          error: `Stock validation failed:\n${stockErrors.join('\n')}`,
        }, { status: 400 })
      }
    }

    // Transaction: update status + upsert buyer inventory if delivered
    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: order_id },
        data:  { status },
      })

      if (status === 'delivered') {
        for (const item of order.items) {
          await tx.inventory.upsert({
            where: {
              owner_id_product_id: {
                owner_id:   order.buyer_id,
                product_id: item.product_id,
              },
            },
            update: {
              quantity: { increment: item.quantity },
            },
            create: {
              owner_id:            order.buyer_id,
              product_id:          item.product_id,
              quantity:            item.quantity,
              low_stock_threshold: 10,
            },
          })
        }
      }

      return updatedOrder
    })

    return NextResponse.json({ success: true, order: updated })
  } catch (error) {
    console.error('[ADMIN ORDERS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}