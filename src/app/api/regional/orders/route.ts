import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── Regional always buys from Admin ──
async function resolveSupplier() {
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true, full_name: true, username: true },
  })
  if (!admin) return null
  return { id: admin.id, full_name: admin.full_name, username: admin.username, level: 'Admin' }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'regional') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const tab      = searchParams.get('tab')      || 'my_orders'
    const status   = searchParams.get('status')   || 'all'
    const type     = searchParams.get('type')     || 'all'
    const search   = searchParams.get('search')   || ''
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const isBuyer = tab === 'my_orders'

    const where: Record<string, unknown> = {
      ...(isBuyer
        ? { buyer_id: user.id }
        : { seller_id: user.id, buyer: { role: 'provincial' } } // only provincial can order from regional
      ),
      ...(status !== 'all' && { status }),
      ...(type   !== 'all' && { order_type: type }),
      ...(search && {
        [isBuyer ? 'seller' : 'buyer']: {
          OR: [
            { full_name: { contains: search, mode: 'insensitive' } },
            { username:  { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    }

    const [total, orders, summaryRaw, supplier] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, order_type: true, status: true, total_amount: true,
          created_at: true, notes: true,
          buyer:  { select: { full_name: true, username: true, role: true } },
          seller: { select: { full_name: true, username: true, role: true } },
          items: {
            select: {
              quantity: true, unit_price: true, subtotal: true,
              product: { select: { name: true, type: true } },
            },
          },
        },
      }),
      prisma.order.groupBy({
        by: ['status'],
        where: isBuyer
          ? { buyer_id: user.id }
          : { seller_id: user.id, buyer: { role: 'provincial' } },
        _count: { status: true },
      }),
      isBuyer ? resolveSupplier() : Promise.resolve(null),
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
      orders, summary, supplier,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[REGIONAL ORDERS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'regional') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_type, notes, items } = await req.json()

    if (!items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'Order must have at least one item.' }, { status: 400 })
    if (!['online', 'offline'].includes(order_type))
      return NextResponse.json({ error: 'Invalid order type.' }, { status: 400 })

    const supplier = await resolveSupplier()
    if (!supplier)
      return NextResponse.json({ error: 'No admin found.' }, { status: 400 })

    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const products   = await prisma.product.findMany({
      where: { id: { in: productIds }, is_active: true },
      select: { id: true, price: true, regional_price: true },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    const productMap = new Map(products.map((p) => [p.id, p]))
    let total_amount = 0

    const orderItems = items.map((item: { product_id: string; quantity: number; unit_price?: number }) => {
      const product    = productMap.get(item.product_id)!
      const unit_price = item.unit_price ?? Number(product.regional_price || product.price)
      const subtotal   = unit_price * item.quantity
      total_amount    += subtotal
      return { product_id: item.product_id, quantity: item.quantity, unit_price, subtotal }
    })

    const order = await prisma.order.create({
      data: {
        buyer_id: user.id, seller_id: supplier.id,
        order_type, status: 'pending', total_amount,
        is_cross_purchase: false, notes: notes?.trim() || null,
        items: { create: orderItems },
      },
      select: { id: true, status: true, total_amount: true, created_at: true },
    })

    return NextResponse.json({
      success: true,
      message: `Order placed to Admin — ${supplier.full_name}.`,
      order, supplier,
    })
  } catch (error) {
    console.error('[REGIONAL ORDERS POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'regional') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_id, status } = await req.json()
    const allowed = ['pending', 'processing', 'delivered', 'cancelled']
    if (!order_id || !allowed.includes(status))
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

    const order = await prisma.order.findFirst({
      where: {
        id: order_id,
        OR: [
          { seller_id: user.id, buyer: { role: 'provincial' } },
          { buyer_id: user.id, status: 'pending' },
        ],
      },
      include: { items: true },
    })

    if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    if (order.status === 'delivered' || order.status === 'cancelled')
      return NextResponse.json({ error: 'Order already finalized.' }, { status: 400 })
    if (order.buyer_id === user.id && order.seller_id !== user.id && status !== 'cancelled')
      return NextResponse.json({ error: 'You can only cancel your own orders.' }, { status: 403 })

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({ where: { id: order_id }, data: { status } })

      if (status === 'delivered') {
        for (const item of order.items) {
          await tx.inventory.upsert({
            where: { owner_id_product_id: { owner_id: order.buyer_id, product_id: item.product_id } },
            update: { quantity: { increment: item.quantity } },
            create: { owner_id: order.buyer_id, product_id: item.product_id, quantity: item.quantity, low_stock_threshold: 10 },
          })
          await tx.inventory.updateMany({
            where: { owner_id: order.seller_id, product_id: item.product_id },
            data:  { quantity: { decrement: item.quantity } },
          })
        }
      }
      return updatedOrder
    })

    return NextResponse.json({ success: true, order: updated })
  } catch (error) {
    console.error('[REGIONAL ORDERS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}