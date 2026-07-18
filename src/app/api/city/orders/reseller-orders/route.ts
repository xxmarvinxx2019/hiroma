import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ============================================================
// PRODUCT BINARY POINTS — same logic as city orders route
// ============================================================

async function checkSponsorPairingPoints(buyerUserId: string, currentOrderPU: number) {
  const { getCurrentRankForReseller } = await import('@/app/api/admin/ranks/route')

  const buyerNode = await prisma.binaryTreeNode.findUnique({
    where:  { user_id: buyerUserId },
    select: { id: true, parent_id: true, position: true },
  })
  if (!buyerNode?.parent_id) return

  const hiromaUser = await prisma.user.findFirst({
    where:  { username: 'hiroma' },
    select: { id: true },
  })

  const ancestors = await prisma.$queryRaw<{
    id: string; user_id: string; parent_id: string | null; position: string | null
  }[]>`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, user_id, parent_id, position
      FROM binary_tree_nodes WHERE id = ${buyerNode.parent_id}
      UNION ALL
      SELECT n.id, n.user_id, n.parent_id, n.position
      FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, user_id, parent_id, position FROM ancestor_chain
  `
  if (!ancestors || ancestors.length === 0) return

  const DAILY_CAP = 10
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = 0; i < ancestors.length; i++) {
    const ancestor = ancestors[i]

    const profile = await prisma.resellerProfile.findUnique({
      where:  { user_id: ancestor.user_id },
      select: {
        user_id: true, points_reset_at: true,
        daily_pairing_count: true, daily_pairing_date: true,
        package: { select: { id: true, point_reset_days: true, point_php_value: true } },
      },
    })
    if (!profile) continue

    let extraData = { rank: 'default', total_pu: 0 }
    try {
      const rows = await prisma.$queryRaw<{ rank: string; total_pu: number }[]>`
        SELECT COALESCE(rank, 'default') as rank, COALESCE(total_pu, 0) as total_pu
        FROM reseller_profiles WHERE user_id::text = ${ancestor.user_id}
      `
      if (rows[0]) extraData = { rank: rows[0].rank, total_pu: Number(rows[0].total_pu) }
    } catch { /* not migrated */ }

    const profileAny    = { ...profile, ...extraData }
    const resetDays     = profile.package?.point_reset_days || 30
    const resetAt       = profile.points_reset_at ? new Date(profile.points_reset_at) : new Date(Date.now() - resetDays * 24 * 60 * 60 * 1000)
    const packageId     = profile.package?.id || ''
    const packagePPV    = Number(profile.package?.point_php_value || 5)
    const activeRank    = packageId ? await getCurrentRankForReseller(packageId, profileAny.total_pu || 0) : null
    const pointsPerPair = activeRank ? Number(activeRank.pair_income) : packagePPV
    const phpPerPoint   = 0.50

    const children = await prisma.binaryTreeNode.findMany({
      where:  { parent_id: ancestor.id },
      select: { id: true, position: true },
    })
    const leftChild  = children.find((c) => c.position === 'left')
    const rightChild = children.find((c) => c.position === 'right')
    if (!leftChild || !rightChild) continue

    const [leftResult, rightResult] = await Promise.all([
      prisma.$queryRaw<{ total: number }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id, user_id FROM binary_tree_nodes WHERE id = ${leftChild.id}
          UNION ALL
          SELECT n.id, n.user_id FROM binary_tree_nodes n INNER JOIN subtree s ON n.parent_id = s.id
        )
        SELECT COALESCE(SUM(oi.quantity * p.pu_value), 0)::int as total
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.buyer_id IN (SELECT user_id FROM subtree)
          AND o.status = 'delivered'
          AND COALESCE(p.binary_eligible, true) = true
          AND COALESCE(p.pu_value, 0) > 0
          AND o.created_at >= ${resetAt}
      `,
      prisma.$queryRaw<{ total: number }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id, user_id FROM binary_tree_nodes WHERE id = ${rightChild.id}
          UNION ALL
          SELECT n.id, n.user_id FROM binary_tree_nodes n INNER JOIN subtree s ON n.parent_id = s.id
        )
        SELECT COALESCE(SUM(oi.quantity * p.pu_value), 0)::int as total
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id
        WHERE o.buyer_id IN (SELECT user_id FROM subtree)
          AND o.status = 'delivered'
          AND COALESCE(p.binary_eligible, true) = true
          AND COALESCE(p.pu_value, 0) > 0
          AND o.created_at >= ${resetAt}
      `,
    ])

    let leftPU  = Number(leftResult[0]?.total  || 0)
    let rightPU = Number(rightResult[0]?.total || 0)

    const leg: 'left' | 'right' = i === 0
      ? (buyerNode.position as 'left' | 'right')
      : (ancestors[i - 1].position as 'left' | 'right') || 'left'
    if (leg === 'left') leftPU  += currentOrderPU
    else                rightPU += currentOrderPU

    const possiblePairs = Math.floor(Math.min(leftPU, rightPU) / 2)
    if (possiblePairs <= 0) continue

    const lastPairDate = profileAny.daily_pairing_date ? new Date(profileAny.daily_pairing_date) : null
    const isToday      = lastPairDate ? lastPairDate >= today : false
    const usedToday    = isToday ? Number(profileAny.daily_pairing_count || 0) : 0
    const remaining    = Math.max(0, DAILY_CAP - usedToday)
    const paidPairs    = Math.min(possiblePairs, remaining)
    const overflowPairs = possiblePairs - paidPairs
    const pointsEarned  = paidPairs     * pointsPerPair
    const overflowPoints = overflowPairs * pointsPerPair
    const paidEarnings   = pointsEarned  * phpPerPoint
    const overflowEarnings = overflowPoints * phpPerPoint

    if (paidPairs > 0) {
      await Promise.all([
        prisma.resellerProfile.update({
          where: { user_id: ancestor.user_id },
          data:  {
            total_points:        { increment: pointsEarned },
            points_reset_at:     new Date(),
            daily_pairing_count: isToday ? { increment: paidPairs } : paidPairs,
            daily_pairing_date:  today,
          },
        }),
        prisma.commission.create({
          data: {
            user_id: ancestor.user_id, type: 'sponsor_point',
            amount: paidEarnings, points: pointsEarned,
            source_user_id: buyerUserId, is_pair_overflow: false,
          },
        }),
        prisma.wallet.update({
          where: { user_id: ancestor.user_id },
          data:  { balance: { increment: paidEarnings }, total_earned: { increment: paidEarnings } },
        }),
      ])
    }

    if (overflowPairs > 0 && overflowEarnings > 0 && hiromaUser) {
      await Promise.all([
        prisma.commission.create({
          data: {
            user_id: hiromaUser.id, type: 'sponsor_point',
            amount: overflowEarnings, points: overflowPoints,
            source_user_id: buyerUserId, overflow_to: hiromaUser.id, is_pair_overflow: true,
          },
        }),
        prisma.wallet.upsert({
          where:  { user_id: hiromaUser.id },
          update: { balance: { increment: overflowEarnings }, total_earned: { increment: overflowEarnings } },
          create: { user_id: hiromaUser.id, balance: overflowEarnings, total_earned: overflowEarnings, total_withdrawn: 0 },
        }),
      ])
    }
  }
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
      // Calculate PU from this order
      const puProducts = await prisma.$queryRaw<{ id: string; pu_value: number }[]>`
        SELECT id::text, COALESCE(pu_value, 0) as pu_value FROM products
        WHERE id::text = ANY(${orderItems.map((i: any) => i.product_id)})
          AND COALESCE(binary_eligible, true) = true AND COALESCE(pu_value, 0) > 0
      `.catch(() => [] as { id: string; pu_value: number }[])
      const puMap = new Map(puProducts.map((p: any) => [p.id, Number(p.pu_value)]))
      const currentOrderPU = orderItems.reduce((sum: number, i: any) => sum + (i.quantity * (puMap.get(i.product_id) || 0)), 0)

      // Update buyer's own PU and rank
      let buyerExtra = { rank: 'default', total_pu: 0 }
      try {
        const brows = await prisma.$queryRaw<{ rank: string; total_pu: number }[]>`
          SELECT COALESCE(rank,'default') as rank, COALESCE(total_pu,0) as total_pu
          FROM reseller_profiles WHERE user_id::text = ${reseller_id}
        `
        if (brows[0]) buyerExtra = { rank: brows[0].rank, total_pu: Number(brows[0].total_pu) }
      } catch { /* not migrated */ }

      if (currentOrderPU > 0) {
        const newTotalPU = buyerExtra.total_pu + currentOrderPU
        const { getCurrentRankForReseller } = await import('@/app/api/admin/ranks/route')
        const buyerPkgId = await prisma.resellerProfile.findUnique({ where: { user_id: reseller_id }, select: { package_id: true } }).then(p => p?.package_id || '')
        const newRank    = buyerPkgId ? await getCurrentRankForReseller(buyerPkgId, newTotalPU) : null
        const rankChanged = newRank && newRank.name !== buyerExtra.rank
        try {
          if (rankChanged) {
            await prisma.$executeRaw`UPDATE reseller_profiles SET total_pu = total_pu + ${currentOrderPU}, rank = ${newRank!.name} WHERE user_id::text = ${reseller_id}`
          } else {
            await prisma.$executeRaw`UPDATE reseller_profiles SET total_pu = total_pu + ${currentOrderPU} WHERE user_id::text = ${reseller_id}`
          }
        } catch { /* not migrated */ }

        await checkSponsorPairingPoints(reseller_id, currentOrderPU)
      }
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