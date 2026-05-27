import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// PRODUCT BINARY POINTS — same logic as city orders route
// ============================================================

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

  // Fetch all ancestors in one CTE query
  const ancestors = await prisma.$queryRaw<{
    id: string; user_id: string; parent_id: string | null
  }[]>`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, user_id, parent_id
      FROM binary_tree_nodes WHERE id = ${buyerNode.parent_id}
      UNION ALL
      SELECT n.id, n.user_id, n.parent_id
      FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, user_id, parent_id FROM ancestor_chain
  `

  if (!ancestors || ancestors.length === 0) return

  // Fetch all profiles in one batch
  const ancestorUserIds = ancestors.map((a) => a.user_id)
  const profiles = await prisma.resellerProfile.findMany({
    where:  { user_id: { in: ancestorUserIds } },
    select: {
      user_id:         true,
      total_points:    true,
      points_reset_at: true,
      package: { select: { point_php_value: true, point_reset_days: true } },
    },
  })
  const profileMap = new Map(profiles.map((p) => [p.user_id, p]))

  for (const ancestor of ancestors) {
    const profile = profileMap.get(ancestor.user_id)
    if (!profile) continue

    const phpValue  = Number(profile.package?.point_php_value || 0) * 0.50
    const resetDays = profile.package?.point_reset_days || 30
    const resetAt   = profile.points_reset_at
      ? new Date(profile.points_reset_at)
      : new Date(Date.now() - resetDays * 24 * 60 * 60 * 1000)

    // Get left and right child nodes of this ancestor in one query
    const children = await prisma.binaryTreeNode.findMany({
      where:  { parent_id: ancestor.id },
      select: { id: true, position: true },
    })

    const leftChild  = children.find((c) => c.position === 'left')
    const rightChild = children.find((c) => c.position === 'right')

    if (!leftChild || !rightChild) continue

    // Get total qty for left and right subtrees in parallel using single CTE each
    const [leftResult, rightResult] = await Promise.all([
      prisma.$queryRaw<{ total: number }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id, user_id FROM binary_tree_nodes WHERE id = ${leftChild.id}
          UNION ALL
          SELECT n.id, n.user_id FROM binary_tree_nodes n
          INNER JOIN subtree s ON n.parent_id = s.id
        )
        SELECT COALESCE(SUM(oi.quantity), 0)::int as total
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.buyer_id IN (SELECT user_id FROM subtree)
          AND o.status = 'delivered'
          AND o.created_at >= ${resetAt}
      `,
      prisma.$queryRaw<{ total: number }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id, user_id FROM binary_tree_nodes WHERE id = ${rightChild.id}
          UNION ALL
          SELECT n.id, n.user_id FROM binary_tree_nodes n
          INNER JOIN subtree s ON n.parent_id = s.id
        )
        SELECT COALESCE(SUM(oi.quantity), 0)::int as total
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.buyer_id IN (SELECT user_id FROM subtree)
          AND o.status = 'delivered'
          AND o.created_at >= ${resetAt}
      `,
    ])

    let leftQty  = Number(leftResult[0]?.total  || 0)
    let rightQty = Number(rightResult[0]?.total || 0)

    // Add current order qty to buyer's side
    if (buyerNode.parent_id === ancestor.id) {
      if (buyerNode.position === 'left') leftQty  += currentOrderQty
      else                               rightQty += currentOrderQty
    }

    console.log(`[POINTS] Ancestor ${ancestor.user_id} left:${leftQty} right:${rightQty}`)

    if (leftQty >= 2 && rightQty >= 2) {
      console.log(`[POINTS] ✅ Awarding point to ${ancestor.user_id}`)

      await Promise.all([
        prisma.resellerProfile.update({
          where: { user_id: ancestor.user_id },
          data:  { total_points: { increment: 1 }, points_reset_at: new Date() },
        }),
        ...(phpValue > 0 ? [
          prisma.commission.create({
            data: {
              user_id:          ancestor.user_id,
              type:             'sponsor_point',
              amount:           phpValue,
              points:           1,
              source_user_id:   buyerUserId,
              is_pair_overflow: false,
            },
          }),
          prisma.wallet.update({
            where: { user_id: ancestor.user_id },
            data:  { balance: { increment: phpValue }, total_earned: { increment: phpValue } },
          }),
        ] : []),
      ])
    }
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