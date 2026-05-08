import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── Resolve provincial's supplier: Regional → Admin ──
async function resolveSupplier(provincialUserId: string) {
  const profile = await prisma.distributorProfile.findUnique({
    where: { user_id: provincialUserId },
    include: {
      parent: {
        include: {
          user: { select: { id: true, full_name: true, username: true, role: true } },
        },
      },
    },
  })

  // Try regional parent
  if (profile?.parent && profile.parent.dist_level === 'regional' && profile.parent.is_active) {
    return {
      id:        profile.parent.user.id,
      full_name: profile.parent.user.full_name,
      username:  profile.parent.user.username,
      level:     'Regional Distributor',
    }
  }

  // Fallback to admin
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
    if (!user || user.role !== 'provincial') {
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
        : { seller_id: user.id, buyer: { role: 'city' } } // only city dist can order from provincial
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
          : { seller_id: user.id, buyer: { role: 'city' } },
        _count: { status: true },
      }),
      isBuyer ? resolveSupplier(user.id) : Promise.resolve(null),
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
    console.error('[PROVINCIAL ORDERS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'provincial') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_type, notes, items } = await req.json()

    if (!items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'Order must have at least one item.' }, { status: 400 })

    if (!['online', 'offline'].includes(order_type))
      return NextResponse.json({ error: 'Invalid order type.' }, { status: 400 })

    const supplier = await resolveSupplier(user.id)
    if (!supplier)
      return NextResponse.json({ error: 'No supplier found. Contact admin.' }, { status: 400 })

    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const products   = await prisma.product.findMany({
      where: { id: { in: productIds }, is_active: true },
      select: { id: true, price: true },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    const productMap = new Map(products.map((p) => [p.id, p]))
    let total_amount = 0

    const orderItems = items.map((item: { product_id: string; quantity: number; unit_price?: number }) => {
      const product    = productMap.get(item.product_id)!
      const unit_price = item.unit_price ?? Number(product.price)
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
      message: `Order placed to ${supplier.level} — ${supplier.full_name}.`,
      order, supplier,
    })
  } catch (error) {
    console.error('[PROVINCIAL ORDERS POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'provincial') {
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
          { seller_id: user.id, buyer: { role: 'city' } }, // city dist orders to provincial
          { buyer_id: user.id, status: 'pending' },         // provincial's own purchase orders
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
          // Credit buyer inventory
          await tx.inventory.upsert({
            where: { owner_id_product_id: { owner_id: order.buyer_id, product_id: item.product_id } },
            update: { quantity: { increment: item.quantity } },
            create: { owner_id: order.buyer_id, product_id: item.product_id, quantity: item.quantity, low_stock_threshold: 10 },
          })
          // Deduct seller inventory
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
    console.error('[PROVINCIAL ORDERS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}