import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// PRODUCT BINARY POINTS — same logic as city orders route
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

async function checkProductBinaryPointsAfterCommit(
  buyerUserId: string,
  currentOrderQty: number
) {
  console.log('[POINTS] Walk-in check for buyer:', buyerUserId, '| qty:', currentOrderQty)

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
                package: { select: { point_php_value: true, point_reset_days: true } },
              },
            },
          },
        },
      },
    })

    if (!ancestorNode || !ancestorNode.user.reseller_profile) break

    const profile   = ancestorNode.user.reseller_profile
    const phpValue  = Number(profile.package?.point_php_value || 0)
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

    let [leftQty, rightQty] = await Promise.all([
      getTotalQtyUnderNode(leftChild.id, resetAt),
      getTotalQtyUnderNode(rightChild.id, resetAt),
    ])

    // Add current order qty to buyer's side if direct child level
    if (buyerNode.parent_id === currentNodeId) {
      if (buyerNode.position === 'left') leftQty  += currentOrderQty
      else                               rightQty += currentOrderQty
    }

    console.log(`[POINTS] Ancestor ${ancestorNode.user_id} left:${leftQty} right:${rightQty}`)

    if (leftQty >= 2 && rightQty >= 2) {
      console.log(`[POINTS] ✅ Awarding point to ${ancestorNode.user_id}`)

      await prisma.resellerProfile.update({
        where: { user_id: ancestorNode.user_id },
        data:  { total_points: { increment: 1 } },
      })

      if (phpValue > 0) {
        await prisma.commission.create({
          data: {
            user_id:          ancestorNode.user_id,
            type:             'sponsor_point',
            amount:           phpValue,
            points:           1,
            source_user_id:   buyerUserId,
            is_pair_overflow: false,
          },
        })

        await prisma.wallet.update({
          where: { user_id: ancestorNode.user_id },
          data: { balance: { increment: phpValue }, total_earned: { increment: phpValue } },
        })
      }
    }

    currentNodeId = ancestorNode.parent_id
  }

  console.log('[POINTS] Walk-in tree walk complete')
}

// ── GET resellers under this city distributor ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const search = searchParams.get('search') || ''

    const resellers = await prisma.user.findMany({
      where: {
        role:       'reseller',
        status:     'active',
        created_by: user.id,
        ...(search && {
          OR: [
            { full_name: { contains: search, mode: 'insensitive' } },
            { username:  { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      select: {
        id:        true,
        full_name: true,
        username:  true,
      },
      orderBy: { full_name: 'asc' },
      take: 50,
    })

    return NextResponse.json({ resellers })
  } catch (error) {
    console.error('[CITY RESELLER ORDER GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST create an order on behalf of a reseller ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { reseller_id, order_type, notes, items } = await req.json()

    if (!reseller_id)
      return NextResponse.json({ error: 'Please select a reseller.' }, { status: 400 })
    if (!items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'Order must have at least one item.' }, { status: 400 })
    if (!['online', 'offline'].includes(order_type))
      return NextResponse.json({ error: 'Invalid order type.' }, { status: 400 })

    // Validate reseller belongs to this city distributor
    const reseller = await prisma.user.findFirst({
      where: { id: reseller_id, role: 'reseller', status: 'active' },
      select: { id: true, full_name: true, username: true },
    })

    if (!reseller)
      return NextResponse.json({ error: 'Reseller not found or inactive.' }, { status: 404 })

    // Validate products and check city dist inventory
    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const products   = await prisma.product.findMany({
      where:  { id: { in: productIds }, is_active: true },
      select: { id: true, name: true, price: true, reseller_price: true },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    const productMap = new Map(products.map((p) => [p.id, p]))
    let total_amount = 0

    const orderItems = items.map((item: { product_id: string; quantity: number }) => {
      const product    = productMap.get(item.product_id)!
      const unit_price = Number(product.reseller_price || product.price)
      const subtotal   = unit_price * item.quantity
      total_amount    += subtotal
      return { product_id: item.product_id, quantity: item.quantity, unit_price, subtotal }
    })

    // Create order with city dist as seller, reseller as buyer
    // Mark as delivered immediately since city dist is handing it over in person
    console.log('[WALK-IN] Creating order for reseller:', reseller_id, 'from city dist:', user.id)
    // ── Validate seller has sufficient inventory for all items ──
    const stockErrors: string[] = []
    for (const item of items) {
      const inventoryItem = await prisma.inventory.findFirst({
        where: { owner_id: user.id, product_id: item.product_id },
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

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          buyer_id:          reseller_id,
          seller_id:         user.id,
          order_type,
          status:            'delivered', // immediate — city dist is present
          total_amount,
          is_cross_purchase: false,
          notes:             notes?.trim() || null,
          items:             { create: orderItems },
        },
        select: {
          id: true, status: true, total_amount: true, created_at: true,
          buyer: { select: { full_name: true, username: true } },
        },
      })

      // Credit reseller inventory immediately
      for (const item of orderItems) {
        await tx.inventory.upsert({
          where: {
            owner_id_product_id: {
              owner_id:   reseller_id,
              product_id: item.product_id,
            },
          },
          update: { quantity: { increment: item.quantity } },
          create: {
            owner_id:            reseller_id,
            product_id:          item.product_id,
            quantity:            item.quantity,
            low_stock_threshold: 5,
          },
        })

        // Deduct from city distributor inventory
        await tx.inventory.updateMany({
          where: { owner_id: user.id, product_id: item.product_id },
          data:  { quantity: { decrement: item.quantity } },
        })
      }

      return newOrder
    })

    // Trigger product binary points AFTER transaction completes
    // so the order is committed before we check quantities
    try {
      const currentQty = orderItems.reduce((s: number, i: { quantity: number }) => s + i.quantity, 0)
      await checkProductBinaryPointsAfterCommit(reseller_id, currentQty)
    } catch (pointsError) {
      console.error('[WALK-IN POINTS ERROR]', pointsError)
      // Don't fail the order if points check fails
    }

    console.log('[WALK-IN ORDER] Created:', {
      order_id:    order.id,
      buyer_id:    reseller_id,
      seller_id:   user.id,
      total:       order.total_amount,
      status:      order.status,
    })

    return NextResponse.json({
      success: true,
      message: `Order created for ${reseller.full_name} and marked as delivered.`,
      order,
    })
  } catch (error) {
    console.error('[CITY RESELLER ORDER POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}