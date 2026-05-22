import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// HELPER — resolve who the city distributor buys from
// ============================================================

async function resolveSupplier(cityUserId: string) {
  const cityProfile = await prisma.distributorProfile.findUnique({
    where: { user_id: cityUserId },
    select: {
      region_code:   true,
      province_code: true,
      city_muni_code: true,
      parent_dist_id: true,
      parent: {
        include: {
          user: { select: { id: true, full_name: true, username: true } },
          parent: {
            include: {
              user: { select: { id: true, full_name: true, username: true } },
            },
          },
        },
      },
    },
  })

  if (cityProfile?.parent?.dist_level === 'provincial' && cityProfile.parent.is_active) {
    return {
      id:        cityProfile.parent.user.id,
      full_name: cityProfile.parent.user.full_name,
      username:  cityProfile.parent.user.username,
      level:     'Provincial Distributor',
    }
  }

  if (cityProfile?.parent?.dist_level === 'regional' && cityProfile.parent.is_active) {
    return {
      id:        cityProfile.parent.user.id,
      full_name: cityProfile.parent.user.full_name,
      username:  cityProfile.parent.user.username,
      level:     'Regional Distributor',
    }
  }

  if (cityProfile?.province_code) {
    const provincial = await prisma.distributorProfile.findFirst({
      where: { dist_level: 'provincial', province_code: cityProfile.province_code, is_active: true },
      include: { user: { select: { id: true, full_name: true, username: true } } },
    })
    if (provincial) {
      return {
        id:        provincial.user.id,
        full_name: provincial.user.full_name,
        username:  provincial.user.username,
        level:     'Provincial Distributor',
      }
    }
  }

  if (cityProfile?.region_code) {
    const regional = await prisma.distributorProfile.findFirst({
      where: { dist_level: 'regional', region_code: cityProfile.region_code, is_active: true },
      include: { user: { select: { id: true, full_name: true, username: true } } },
    })
    if (regional) {
      return {
        id:        regional.user.id,
        full_name: regional.user.full_name,
        username:  regional.user.username,
        level:     'Regional Distributor',
      }
    }
  }

  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true, full_name: true, username: true },
  })
  if (!admin) return null

  return { id: admin.id, full_name: admin.full_name, username: admin.username, level: 'Admin' }
}

// ============================================================
// GET orders
// ============================================================

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
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
      ...(isBuyer ? { buyer_id: user.id } : { seller_id: user.id }),
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
          id:                true,
          order_type:        true,
          status:            true,
          total_amount:      true,
          created_at:        true,
          notes:             true,
          payment_method:    true,
          payment_reference: true,
          payment_status:    true,
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
        where: isBuyer ? { buyer_id: user.id } : { seller_id: user.id },
        _count: { status: true },
      }),

      isBuyer ? resolveSupplier(user.id) : Promise.resolve(null),
    ])

    const summary = { total: 0, pending: 0, processing: 0, delivered: 0, cancelled: 0 }
    for (const row of summaryRaw) {
      const count = row._count.status
      summary.total     += count
      if (row.status === 'pending')    summary.pending    = count
      if (row.status === 'processing') summary.processing = count
      if (row.status === 'delivered')  summary.delivered  = count
      if (row.status === 'cancelled')  summary.cancelled  = count
    }

    return NextResponse.json({
      orders,
      summary,
      supplier,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[CITY ORDERS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ============================================================
// POST — city places a new purchase order to their supplier
// ============================================================

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_type, notes, items } = await req.json()

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Order must have at least one item.' }, { status: 400 })
    }

    if (!['online', 'offline'].includes(order_type)) {
      return NextResponse.json({ error: 'Invalid order type.' }, { status: 400 })
    }

    const supplier = await resolveSupplier(user.id)
    if (!supplier) {
      return NextResponse.json({ error: 'No supplier found. Please contact admin.' }, { status: 400 })
    }

    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, is_active: true },
      select: { id: true, name: true, price: true, city_price: true },
    })

    if (products.length !== productIds.length) {
      return NextResponse.json({ error: 'One or more products not found or inactive.' }, { status: 400 })
    }

    const productMap = new Map(products.map((p) => [p.id, p]))
    let total_amount = 0

    const orderItems = items.map((item: { product_id: string; quantity: number; unit_price?: number }) => {
      const product    = productMap.get(item.product_id)!
      const unit_price = item.unit_price ?? Number(product.city_price || product.price)
      const subtotal   = unit_price * item.quantity
      total_amount    += subtotal
      return { product_id: item.product_id, quantity: item.quantity, unit_price, subtotal }
    })

    const stockErrors: string[] = []
    for (const item of items) {
      const inventoryItem = await prisma.inventory.findFirst({
        where: { owner_id: supplier.id, product_id: item.product_id },
        select: { quantity: true },
      })
      const available = inventoryItem?.quantity || 0
      if (available < item.quantity) {
        const product = productMap.get(item.product_id)
        stockErrors.push(
          `Insufficient stock for "${product?.name || item.product_id}": requested ${item.quantity}, available ${available}`
        )
      }
    }
    if (stockErrors.length > 0) {
      return NextResponse.json({
        error: `Stock validation failed:\n${stockErrors.join('\n')}`,
      }, { status: 400 })
    }

    const order = await prisma.order.create({
      data: {
        buyer_id:          user.id,
        seller_id:         supplier.id,
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
      message: `Order placed to ${supplier.level} — ${supplier.full_name}.`,
      order,
      supplier,
    })
  } catch (error) {
    console.error('[CITY ORDERS POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ============================================================
// PRODUCT BINARY POINTS LOGIC
// ============================================================

async function getTotalQtyUnderNode(nodeId: string, resetAt: Date): Promise<number> {
  let totalQty = 0
  const queue  = [nodeId]

  while (queue.length > 0) {
    const batch    = queue.splice(0, 20)
    const children = await prisma.binaryTreeNode.findMany({
      where:  { parent_id: { in: batch } },
      select: { id: true, user_id: true },
    })

    if (children.length === 0) break

    const userIds = children.map((c) => c.user_id)
    const orders  = await prisma.order.findMany({
      where: {
        buyer_id:   { in: userIds },
        status:     'delivered',
        created_at: { gte: resetAt },
      },
      select: { items: { select: { quantity: true } } },
    })

    totalQty += orders.reduce(
      (s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0
    )

    for (const child of children) queue.push(child.id)
  }

  const nodeData = await prisma.binaryTreeNode.findUnique({
    where:  { id: nodeId },
    select: { user_id: true },
  })

  if (nodeData) {
    const nodeOrders = await prisma.order.findMany({
      where: {
        buyer_id:   nodeData.user_id,
        status:     'delivered',
        created_at: { gte: resetAt },
      },
      select: { items: { select: { quantity: true } } },
    })
    totalQty += nodeOrders.reduce(
      (s, o) => s + o.items.reduce((ss, i) => ss + i.quantity, 0), 0
    )
  }

  return totalQty
}

async function checkSponsorPairingPoints(
  tx: any,
  buyerUserId: string,
  currentOrderQty: number
) {
  const buyerNode = await prisma.binaryTreeNode.findUnique({
    where:  { user_id: buyerUserId },
    select: { id: true, parent_id: true, position: true },
  })

  if (!buyerNode?.parent_id) return

  let currentNodeId: string | null = buyerNode.parent_id

  while (currentNodeId) {
    const ancestorNode = await prisma.binaryTreeNode.findUnique({
      where:  { id: currentNodeId },
      select: {
        id:        true,
        user_id:   true,
        parent_id: true,
        user: {
          select: {
            reseller_profile: {
              select: {
                points_reset_at: true,
                package: {
                  select: {
                    point_php_value:  true,
                    point_reset_days: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!ancestorNode) break
    if (!ancestorNode.user.reseller_profile) break

    const profile  = ancestorNode.user.reseller_profile
    const phpValue = Number(profile.package?.point_php_value || 0)
    const resetDays = profile.package?.point_reset_days || 30
    const resetAt   = profile.points_reset_at
      || new Date(Date.now() - resetDays * 24 * 60 * 60 * 1000)

    const [leftChild, rightChild] = await Promise.all([
      prisma.binaryTreeNode.findFirst({
        where:  { parent_id: currentNodeId, position: 'left' },
        select: { id: true },
      }),
      prisma.binaryTreeNode.findFirst({
        where:  { parent_id: currentNodeId, position: 'right' },
        select: { id: true },
      }),
    ])

    if (!leftChild || !rightChild) {
      currentNodeId = ancestorNode.parent_id
      continue
    }

    const [leftQty, rightQty] = await Promise.all([
      getTotalQtyUnderNode(leftChild.id, resetAt),
      getTotalQtyUnderNode(rightChild.id, resetAt),
    ])

    let adjustedLeftQty  = leftQty
    let adjustedRightQty = rightQty

    if (buyerNode.parent_id === currentNodeId) {
      if (buyerNode.position === 'left') adjustedLeftQty  = leftQty + currentOrderQty
      else                               adjustedRightQty = rightQty + currentOrderQty
    }

    if (adjustedLeftQty >= 2 && adjustedRightQty >= 2) {
      await tx.resellerProfile.update({
        where: { user_id: ancestorNode.user_id },
        data:  { total_points: { increment: 1 } },
      })

      if (phpValue > 0) {
        await tx.commission.create({
          data: {
            user_id:          ancestorNode.user_id,
            type:             'sponsor_point',
            amount:           phpValue,
            points:           1,
            source_user_id:   buyerUserId,
            is_pair_overflow: false,
          },
        })

        await tx.wallet.update({
          where: { user_id: ancestorNode.user_id },
          data: {
            balance:      { increment: phpValue },
            total_earned: { increment: phpValue },
          },
        })
      }
    }

    currentNodeId = ancestorNode.parent_id
  }
}

// ============================================================
// PATCH — update order status + payment status
// ============================================================

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_id, status, payment_status } = await req.json()
    const allowed = ['pending', 'processing', 'delivered', 'cancelled']

    if (!order_id || (!status && !payment_status)) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    if (status && !allowed.includes(status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }

    const order = await prisma.order.findFirst({
      where: {
        id: order_id,
        OR: [
          { seller_id: user.id },
          { buyer_id: user.id, status: 'pending' },
        ],
      },
      include: { items: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found or action not allowed.' }, { status: 404 })
    }

    if (order.status === 'delivered' || order.status === 'cancelled') {
      return NextResponse.json({ error: 'Order is already finalized.' }, { status: 400 })
    }

    if (order.buyer_id === user.id && order.seller_id !== user.id && status && status !== 'cancelled') {
      return NextResponse.json({ error: 'You can only cancel your own orders.' }, { status: 403 })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: order_id },
        data: {
          ...(status         && { status }),
          ...(payment_status && { payment_status }),
        },
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
            update: { quantity: { increment: item.quantity } },
            create: {
              owner_id:            order.buyer_id,
              product_id:          item.product_id,
              quantity:            item.quantity,
              low_stock_threshold: 10,
            },
          })

          await tx.inventory.updateMany({
            where: {
              owner_id:   order.seller_id,
              product_id: item.product_id,
            },
            data: { quantity: { decrement: item.quantity } },
          })
        }

        const buyerRole = await tx.user.findUnique({
          where:  { id: order.buyer_id },
          select: { role: true },
        })

        if (buyerRole?.role === 'reseller') {
          const currentQty = order.items.reduce((s, i) => s + i.quantity, 0)
          await checkSponsorPairingPoints(tx, order.buyer_id, currentQty)
        }
      }

      return updatedOrder
    })

    return NextResponse.json({ success: true, order: updated })
  } catch (error) {
    console.error('[CITY ORDERS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}