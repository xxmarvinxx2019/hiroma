import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getCurrentRankForReseller } from '@/app/api/admin/ranks/route'

// ── Product Binary Pairing for reseller orders ──
async function checkSponsorPairingPoints(buyerUserId: string, currentOrderPU: number) {
  if (currentOrderPU <= 0) return

  const buyerNode = await prisma.binaryTreeNode.findUnique({
    where:  { user_id: buyerUserId },
    select: { id: true, parent_id: true, position: true },
  })
  if (!buyerNode?.parent_id) return

  const hiromaUser = await prisma.user.findFirst({
    where:  { username: 'hiroma' },
    select: { id: true },
  })

  const ancestors = await prisma.$queryRaw<{ id: string; user_id: string; parent_id: string | null; position: string | null }[]>`
    WITH RECURSIVE ancestor_chain AS (
      SELECT id, user_id, parent_id, position FROM binary_tree_nodes WHERE id = ${buyerNode.parent_id}
      UNION ALL
      SELECT n.id, n.user_id, n.parent_id, n.position FROM binary_tree_nodes n
      INNER JOIN ancestor_chain a ON n.id = a.parent_id
    )
    SELECT id, user_id, parent_id, position FROM ancestor_chain
  `
  if (!ancestors || ancestors.length === 0) return

  // Get PU reset date from system_settings
  const resetSettings = await prisma.$queryRaw<{ key: string; value: string }[]>`
    SELECT key, value FROM system_settings WHERE key IN ('pu_reset_month', 'pu_reset_day')
  `.catch(() => [] as { key: string; value: string }[])
  const settingsMap = new Map(resetSettings.map(s => [s.key, s.value]))
  const resetMonth  = parseInt(settingsMap.get('pu_reset_month') || '3') - 1
  const resetDay    = parseInt(settingsMap.get('pu_reset_day')   || '1')
  const now2        = new Date()
  let periodStart   = new Date(now2.getFullYear(), resetMonth, resetDay)
  if (now2 < periodStart) periodStart = new Date(now2.getFullYear() - 1, resetMonth, resetDay)
  const resetAt     = periodStart

  const today = new Date(); today.setHours(0, 0, 0, 0)

  for (let i = 0; i < ancestors.length; i++) {
    const ancestor = ancestors[i]

    const profile = await prisma.resellerProfile.findUnique({
      where:  { user_id: ancestor.user_id },
      select: { user_id: true, daily_pairing_count: true, daily_pairing_date: true,
        package: { select: { id: true, point_php_value: true } } },
    })
    if (!profile) continue

    let extraData = { rank: 'default', total_pu: 0, daily_product_pairing_cap: 50 }
    try {
      const rows = await prisma.$queryRaw<{ rank: string; total_pu: number; daily_product_pairing_cap: number }[]>`
        SELECT COALESCE(rp.rank, 'default') as rank, COALESCE(rp.total_pu, 0) as total_pu,
               COALESCE(p.daily_product_pairing_cap, 50)::int as daily_product_pairing_cap
        FROM reseller_profiles rp LEFT JOIN packages p ON p.id = rp.package_id
        WHERE rp.user_id::text = ${ancestor.user_id}
      `
      if (rows[0]) extraData = { rank: rows[0].rank, total_pu: Number(rows[0].total_pu), daily_product_pairing_cap: Number(rows[0].daily_product_pairing_cap) }
    } catch { /* not migrated yet */ }

    const profileAny    = { ...profile, ...extraData } as typeof profile & { rank: string; total_pu: number; daily_product_pairing_cap: number }
    const packagePPV    = Number(profile.package?.point_php_value || 5)
    const activeRank    = profile.package?.id ? await getCurrentRankForReseller(profile.package.id, profileAny.total_pu || 0) : null
    const pointsPerPair = activeRank ? Number(activeRank.pair_income) : packagePPV
    const phpPerPoint   = 0.50

    const children = await prisma.binaryTreeNode.findMany({
      where: { parent_id: ancestor.id }, select: { id: true, position: true },
    })
    const leftChild  = children.find(c => c.position === 'left')
    const rightChild = children.find(c => c.position === 'right')
    if (!leftChild || !rightChild) continue

    const [leftResult, rightResult] = await Promise.all([
      prisma.$queryRaw<{ total: number }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id, user_id FROM binary_tree_nodes WHERE id = ${leftChild.id}
          UNION ALL SELECT n.id, n.user_id FROM binary_tree_nodes n INNER JOIN subtree s ON n.parent_id = s.id
        )
        SELECT COALESCE(SUM(oi.quantity * p.pu_value), 0)::int as total
        FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
        WHERE o.buyer_id IN (SELECT user_id FROM subtree) AND o.status = 'delivered'
          AND p.binary_eligible = true AND p.pu_value > 0 AND o.created_at >= ${resetAt}
      `,
      prisma.$queryRaw<{ total: number }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id, user_id FROM binary_tree_nodes WHERE id = ${rightChild.id}
          UNION ALL SELECT n.id, n.user_id FROM binary_tree_nodes n INNER JOIN subtree s ON n.parent_id = s.id
        )
        SELECT COALESCE(SUM(oi.quantity * p.pu_value), 0)::int as total
        FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
        WHERE o.buyer_id IN (SELECT user_id FROM subtree) AND o.status = 'delivered'
          AND p.binary_eligible = true AND p.pu_value > 0 AND o.created_at >= ${resetAt}
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
    const remaining    = Math.max(0, (profileAny.daily_product_pairing_cap || 50) - usedToday)
    const paidPairs     = Math.min(possiblePairs, remaining)
    const overflowPairs = possiblePairs - paidPairs
    const pointsEarned     = paidPairs     * pointsPerPair
    const overflowPoints   = overflowPairs * pointsPerPair
    const paidEarnings     = pointsEarned   * phpPerPoint
    const overflowEarnings = overflowPoints * phpPerPoint

    if (paidPairs > 0) {
      await Promise.all([
        prisma.resellerProfile.update({
          where: { user_id: ancestor.user_id },
          data:  { total_points: { increment: pointsEarned }, daily_pairing_count: isToday ? { increment: paidPairs } : paidPairs, daily_pairing_date: today },
        }),
        prisma.commission.create({ data: { user_id: ancestor.user_id, type: 'sponsor_point', amount: paidEarnings, points: pointsEarned, source_user_id: buyerUserId, is_pair_overflow: false } }),
        prisma.wallet.update({ where: { user_id: ancestor.user_id }, data: { balance: { increment: paidEarnings }, total_earned: { increment: paidEarnings } } }),
      ])
    }

    if (overflowPairs > 0 && overflowEarnings > 0 && hiromaUser) {
      await Promise.all([
        prisma.commission.create({ data: { user_id: hiromaUser.id, type: 'sponsor_point', amount: overflowEarnings, points: overflowPoints, source_user_id: buyerUserId, overflow_to: hiromaUser.id, is_pair_overflow: true } }),
        prisma.wallet.upsert({ where: { user_id: hiromaUser.id }, update: { balance: { increment: overflowEarnings }, total_earned: { increment: overflowEarnings } }, create: { user_id: hiromaUser.id, balance: overflowEarnings, total_earned: overflowEarnings, total_withdrawn: 0 } }),
      ])
    }
  }
}

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
      ? ['regional', 'provincial', 'city', 'reseller']
      : [level]

    const where: Record<string, unknown> = {
      buyer: { role: { in: distRoles } },
      ...(status !== 'all' && { status }),
      ...(type   !== 'all' && { order_type: type }),
      ...(search && {
        OR: [
          { order_number: { contains: search, mode: 'insensitive' } },
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
          id:                true,
          order_number:      true,
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
              quantity:  true,
              unit_price: true,
              subtotal:  true,
              product:   { select: { name: true, type: true } },
            },
          },
        },
      }),

      prisma.order.groupBy({
        by: ['status'],
        where: { buyer: { role: { in: ['regional', 'provincial', 'city', 'reseller'] } } },
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
      orders, summary,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[ADMIN ORDERS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH update order status + payment_status + credit buyer + deduct admin inventory ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
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
      where:   { id: order_id, buyer: { role: { in: ['regional', 'provincial', 'city', 'reseller'] } } },
      include: { items: true },
    })
    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    // Allow payment_status updates on finalized orders
    if ((order.status === 'delivered' || order.status === 'cancelled') && status) {
      return NextResponse.json({ error: 'Order is already finalized.' }, { status: 400 })
    }

    // ── Validate admin stock before delivering ──
    if (status === 'delivered') {
      const productIds = order.items.map((i) => i.product_id)

      const [adminInventory, products] = await Promise.all([
        prisma.inventory.findMany({
          where:  { owner_id: order.seller_id, product_id: { in: productIds } },
          select: { product_id: true, quantity: true },
        }),
        prisma.product.findMany({
          where:  { id: { in: productIds } },
          select: { id: true, name: true },
        }),
      ])

      const adminInvMap    = new Map(adminInventory.map((i) => [i.product_id, i.quantity]))
      const productNameMap = new Map(products.map((p) => [p.id, p.name]))

      const stockErrors = order.items
        .filter((item) => (adminInvMap.get(item.product_id) ?? 0) < item.quantity)
        .map((item) =>
          `"${productNameMap.get(item.product_id) || item.product_id}": need ${item.quantity}, have ${adminInvMap.get(item.product_id) ?? 0}`
        )

      if (stockErrors.length > 0) {
        return NextResponse.json({
          error: `Insufficient admin stock:\n${stockErrors.join('\n')}`,
        }, { status: 400 })
      }
    }

    // ── Transaction: update status + payment_status + credit buyer + deduct admin ──
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
          // 1. Credit buyer inventory
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

          // 2. Deduct from admin (seller) inventory
          const adminInv = await tx.inventory.findFirst({
            where:  { owner_id: order.seller_id, product_id: item.product_id },
            select: { id: true },
          })

          if (adminInv) {
            await tx.inventory.update({
              where: { id: adminInv.id },
              data:  { quantity: { decrement: item.quantity } },
            })
          } else {
            await tx.inventory.create({
              data: {
                owner_id:            order.seller_id,
                product_id:          item.product_id,
                quantity:            -item.quantity,
                low_stock_threshold: 10,
              },
            })
          }
        }
      }

      return updatedOrder
    })

    // Fire product binary pairing if buyer is reseller
    if (status === 'delivered') {
      try {
        const buyerRole = await prisma.user.findUnique({ where: { id: order.buyer_id }, select: { role: true } })
        if (buyerRole?.role === 'reseller') {
          const productIds = order.items.map((i: any) => i.product_id)
          const products   = await prisma.$queryRaw<{ id: string; pu_value: number }[]>`
            SELECT id::text, COALESCE(pu_value, 0) as pu_value FROM products
            WHERE id::text = ANY(${productIds}::text[]) AND COALESCE(binary_eligible, true) = true AND COALESCE(pu_value, 0) > 0
          `.catch(() => [] as { id: string; pu_value: number }[])
          const puMap = new Map(products.map((p: any) => [p.id, Number(p.pu_value)]))
          const currentOrderPU = order.items.reduce((sum: number, i: any) => sum + (i.quantity * (puMap.get(i.product_id) || 0)), 0)
          if (currentOrderPU > 0) {
            await checkSponsorPairingPoints(order.buyer_id, currentOrderPU)
          }
        }
      } catch (e) { console.error('[ADMIN ORDERS] Product binary pairing error:', e) }
    }

    return NextResponse.json({ success: true, order: updated })
  } catch (error) {
    console.error('[ADMIN ORDERS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
