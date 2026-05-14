import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// HELPER — resolve who the city distributor buys from
// Priority:
// 1. Direct parent (provincial or regional via parent_dist_id)
// 2. Provincial in same city area (by city_muni_code)
// 3. Regional in same region (by region_code)
// 4. Admin fallback
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

  // 1. Direct parent set — provincial
  if (cityProfile?.parent?.dist_level === 'provincial' && cityProfile.parent.is_active) {
    return {
      id:        cityProfile.parent.user.id,
      full_name: cityProfile.parent.user.full_name,
      username:  cityProfile.parent.user.username,
      level:     'Provincial Distributor',
    }
  }

  // 2. Direct parent set — regional
  if (cityProfile?.parent?.dist_level === 'regional' && cityProfile.parent.is_active) {
    return {
      id:        cityProfile.parent.user.id,
      full_name: cityProfile.parent.user.full_name,
      username:  cityProfile.parent.user.username,
      level:     'Regional Distributor',
    }
  }

  // 3. No direct parent — find provincial covering same province
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

  // 4. No provincial — find regional covering same region
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

  // 5. Fallback to admin
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true, full_name: true, username: true },
  })
  if (!admin) return null

  return { id: admin.id, full_name: admin.full_name, username: admin.username, level: 'Admin' }
}

// ============================================================
// GET orders
// tab=my_orders    → city is the buyer (orders placed to supplier)
// tab=reseller_orders → city is the seller (orders from resellers)
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

    // Validate products
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
// PATCH — update order status
// City as seller: can process/deliver/cancel reseller orders
// City as buyer: can only cancel their own pending orders
// ============================================================

// ============================================================
// SPONSOR PAIRING POINT LOGIC
// ============================================================

async function checkSponsorPairingPoints(
  tx: any,
  buyerUserId: string,
  orderItems: { product_id: string; quantity: number }[]
) {
  console.log('[POINTS] Checking for buyer:', buyerUserId)

  const buyerNode = await tx.binaryTreeNode.findUnique({
    where:  { user_id: buyerUserId },
    select: { id: true, parent_id: true, position: true, sponsor_id: true },
  })

  console.log('[POINTS] Buyer node:', JSON.stringify(buyerNode))

  if (!buyerNode?.sponsor_id || !buyerNode.parent_id) {
    console.log('[POINTS] No sponsor or parent — skip')
    return
  }

  const totalQty = orderItems.reduce((s, i) => s + i.quantity, 0)
  console.log('[POINTS] Total qty:', totalQty)
  if (totalQty < 2) {
    console.log('[POINTS] Less than 2 — skip')
    return
  }

  const siblingPosition = buyerNode.position === 'left' ? 'right' : 'left'
  const siblingNode = await tx.binaryTreeNode.findFirst({
    where:  { parent_id: buyerNode.parent_id, position: siblingPosition },
    select: { id: true, user_id: true, sponsor_id: true },
  })

  console.log('[POINTS] Sibling:', JSON.stringify(siblingNode))

  if (!siblingNode) {
    console.log('[POINTS] No sibling — skip')
    return
  }

  if (siblingNode.sponsor_id !== buyerNode.sponsor_id) {
    console.log('[POINTS] Different sponsors — skip')
    return
  }

  const sponsorId = buyerNode.sponsor_id
  console.log('[POINTS] Same sponsor:', sponsorId)

  const sponsorProfile = await tx.resellerProfile.findUnique({
    where:  { user_id: sponsorId },
    select: {
      points_reset_at: true,
      package: { select: { point_php_value: true, point_reset_days: true } },
    },
  })

  if (!sponsorProfile?.package) {
    console.log('[POINTS] No sponsor package — skip')
    return
  }

  const resetDays = sponsorProfile.package.point_reset_days || 30
  const resetAt   = sponsorProfile.points_reset_at
    || new Date(Date.now() - resetDays * 24 * 60 * 60 * 1000)

  // Check sibling delivered qty since reset
  const siblingOrders = await tx.order.findMany({
    where: { buyer_id: siblingNode.user_id, status: 'delivered', created_at: { gte: resetAt } },
    select: { items: { select: { quantity: true } } },
  })

  const siblingQty = siblingOrders.reduce(
    (sum: number, o: any) => sum + o.items.reduce((s: number, i: any) => s + i.quantity, 0), 0
  )

  console.log('[POINTS] Sibling qty since reset:', siblingQty)

  if (siblingQty < 2) {
    console.log('[POINTS] Sibling has not reached 2 bottles yet — skip')
    return
  }

  const phpValue = Number(sponsorProfile.package.point_php_value || 0)
  console.log('[POINTS] ✅ Awarding 1 point to:', sponsorId, '| PHP:', phpValue)

  await tx.resellerProfile.update({
    where: { user_id: sponsorId },
    data:  { total_points: { increment: 1 } },
  })

  if (phpValue > 0) {
    await tx.commission.create({
      data: {
        user_id:          sponsorId,
        type:             'sponsor_point',
        amount:           phpValue,
        points:           1,
        source_user_id:   buyerUserId,
        is_pair_overflow: false,
      },
    })

    await tx.wallet.update({
      where: { user_id: sponsorId },
      data: { balance: { increment: phpValue }, total_earned: { increment: phpValue } },
    })
  }

  console.log('[POINTS] ✅ Done for sponsor:', sponsorId)
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_id, status } = await req.json()
    const allowed = ['pending', 'processing', 'delivered', 'cancelled']
    if (!order_id || !allowed.includes(status)) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    // Find order where city is seller OR city is buyer cancelling a pending order
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

    // Buyers can only cancel, not move to other statuses
    if (order.buyer_id === user.id && order.seller_id !== user.id && status !== 'cancelled') {
      return NextResponse.json({ error: 'You can only cancel your own orders.' }, { status: 403 })
    }

    // Transaction: update status + credit buyer inventory if delivered
    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: order_id },
        data:  { status },
      })

      // When city dist delivers to a reseller — credit reseller inventory
      // When someone delivers to city dist — credit city inventory
      if (status === 'delivered') {
        for (const item of order.items) {
          // Credit buyer's inventory
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

          // Deduct seller's inventory
          await tx.inventory.updateMany({
            where: {
              owner_id:   order.seller_id,
              product_id: item.product_id,
            },
            data: { quantity: { decrement: item.quantity } },
          })
        }
      }

      // ── SPONSOR PAIRING POINT CHECK ──
      // Only when a reseller's order is delivered
      // Check if their SPONSOR should earn a pairing point
      if (status === 'delivered') {
        const buyerRole = await tx.user.findUnique({
          where:  { id: order.buyer_id },
          select: { role: true },
        })

        if (buyerRole?.role === 'reseller') {
          await checkSponsorPairingPoints(tx, order.buyer_id, order.items)
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