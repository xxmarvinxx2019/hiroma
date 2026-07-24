import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { getRanksForPackage, getCurrentRankForReseller } from '@/app/api/admin/ranks/route'
import prisma from '@/app/lib/prisma'
import { createAuditLog, formatMemberId } from '@/app/lib/auditLog'
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
    const isResellerTab = tab === 'reseller_orders'

    const where: Record<string, unknown> = {
      // For reseller tab with a search: search ALL reseller orders, not just this city dist's
      // For reseller tab without search: show only this city dist's reseller orders
      ...(isBuyer
        ? { buyer_id: user.id }
        : (isResellerTab && search)
          ? { buyer: { role: 'reseller' } }           // search all resellers
          : { seller_id: user.id }                     // own reseller orders only
      ),
      ...(status !== 'all' && { status }),
      ...(type   !== 'all' && { order_type: type }),
      ...(search && {
        buyer: {
          ...(isResellerTab ? { role: 'reseller' } : {}),
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

    const { order_type, notes, items, payment_method, payment_reference } = await req.json()

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
        payment_method:    payment_method  || 'cash',
        payment_reference: payment_reference?.trim() || null,
        payment_status:    'unpaid',
        items:             { create: orderItems },
      },
      select: {
        id: true, status: true, total_amount: true, created_at: true,
        seller: { select: { full_name: true, username: true } },
      },
    })
    createAuditLog({
  user_id:       user.id,
  user_name:     user.full_name || user.username,
  user_role:     user.role,
  member_id:     formatMemberId(user.id, user.role),
  activity_type: 'order_created',
  category:      'order',
  description:   `New order created — ₱${Number(order.total_amount).toFixed(2)}`,
  metadata:      { order_id: order.id, amount: order.total_amount },
  risk_level:    'low',
  status:        'normal',
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
// PRODUCT BINARY POINTS LOGIC (PU-based, rank-based income)
// ============================================================

const PRODUCT_DAILY_PAIRING_CAP = 10

async function checkSponsorPairingPoints(
  buyerUserId: string,
  currentOrderPU: number   // total PU from this order (quantity × pu_value per item)
) {
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

  const today = new Date(); today.setHours(0, 0, 0, 0)

  for (let i = 0; i < ancestors.length; i++) {
    const ancestor = ancestors[i]

    // Fresh read per ancestor
    const profile = await prisma.resellerProfile.findUnique({
      where:  { user_id: ancestor.user_id },
      select: {
        user_id:             true,
        points_reset_at:     true,
        daily_pairing_count: true,
        daily_pairing_date:  true,
        package: { select: { id: true, point_reset_days: true, point_php_value: true } },
      },
    })
    if (!profile) continue
    // Fetch rank/total_pu via raw SQL (not in Prisma client until generate is run)
    let extraData = { rank: 'default', total_pu: 0 }
    try {
      const rows = await prisma.$queryRaw<{ rank: string; total_pu: number }[]>`
        SELECT COALESCE(rank, 'default') as rank, COALESCE(total_pu, 0) as total_pu
        FROM reseller_profiles WHERE user_id::text = ${ancestor.user_id}
      `
      if (rows[0]) extraData = { rank: rows[0].rank, total_pu: Number(rows[0].total_pu) }
    } catch { /* columns not migrated yet */ }
    const profileAny = { ...profile, ...extraData }

    const resetDays = profileAny.package?.point_reset_days || 30
    const resetAt   = profileAny.points_reset_at
      ? new Date(profile.points_reset_at)
      : new Date(Date.now() - resetDays * 24 * 60 * 60 * 1000)

    // Get current rank — only valid within active rank period
    const packageId     = profile.package?.id || ''
    const packagePPV    = Number(profile.package?.point_php_value || 5)
    const activeRank    = packageId ? await getCurrentRankForReseller(packageId, profileAny.total_pu || 0) : null
    // If no active period or no rank reached → use package base points
    const pointsPerPair = activeRank ? Number(activeRank.pair_income) : packagePPV
    const phpPerPoint   = 0.50

    const children = await prisma.binaryTreeNode.findMany({
      where:  { parent_id: ancestor.id },
      select: { id: true, position: true },
    })

    const leftChild  = children.find((c) => c.position === 'left')
    const rightChild = children.find((c) => c.position === 'right')
    if (!leftChild || !rightChild) continue

    // Sum PU (quantity × pu_value) for each leg — only binary_eligible products
    const [leftResult, rightResult] = await Promise.all([
      prisma.$queryRaw<{ total: number }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id, user_id FROM binary_tree_nodes WHERE id = ${leftChild.id}
          UNION ALL
          SELECT n.id, n.user_id FROM binary_tree_nodes n
          INNER JOIN subtree s ON n.parent_id = s.id
        )
        SELECT COALESCE(SUM(oi.quantity * p.pu_value), 0)::int as total
        FROM order_items oi
        JOIN orders o   ON o.id  = oi.order_id
        JOIN products p ON p.id  = oi.product_id
        WHERE o.buyer_id IN (SELECT user_id FROM subtree)
          AND o.status = 'delivered'
          AND p.binary_eligible = true
          AND p.pu_value > 0
          AND o.created_at >= ${resetAt}
      `,
      prisma.$queryRaw<{ total: number }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id, user_id FROM binary_tree_nodes WHERE id = ${rightChild.id}
          UNION ALL
          SELECT n.id, n.user_id FROM binary_tree_nodes n
          INNER JOIN subtree s ON n.parent_id = s.id
        )
        SELECT COALESCE(SUM(oi.quantity * p.pu_value), 0)::int as total
        FROM order_items oi
        JOIN orders o   ON o.id  = oi.order_id
        JOIN products p ON p.id  = oi.product_id
        WHERE o.buyer_id IN (SELECT user_id FROM subtree)
          AND o.status = 'delivered'
          AND p.binary_eligible = true
          AND p.pu_value > 0
          AND o.created_at >= ${resetAt}
      `,
    ])

    let leftPU  = Number(leftResult[0]?.total  || 0)
    let rightPU = Number(rightResult[0]?.total || 0)

    // Add current order PU to correct leg
    const leg: 'left' | 'right' = i === 0
      ? (buyerNode.position as 'left' | 'right')
      : (ancestors[i - 1].position as 'left' | 'right') || 'left'

    if (leg === 'left') leftPU  += currentOrderPU
    else                rightPU += currentOrderPU

    // 2 PU left + 2 PU right = 1 pair
    const possiblePairs = Math.floor(Math.min(leftPU, rightPU) / 2)
    if (possiblePairs <= 0) continue

    // Daily cap check
    const lastPairDate = profileAny.daily_pairing_date ? new Date(profileAny.daily_pairing_date) : null
    const isToday      = lastPairDate ? lastPairDate >= today : false
    const usedToday    = isToday ? Number(profileAny.daily_pairing_count || 0) : 0
    const remaining    = Math.max(0, PRODUCT_DAILY_PAIRING_CAP - usedToday)

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
          data:  {
            total_points:        { increment: pointsEarned },
            points_reset_at:     new Date(),
            daily_pairing_count: isToday ? { increment: paidPairs } : paidPairs,
            daily_pairing_date:  today,
          },
        }),
        prisma.commission.create({
          data: {
            user_id:          ancestor.user_id,
            type:             'sponsor_point',
            amount:           paidEarnings,
            points:           pointsEarned,
            source_user_id:   buyerUserId,
            is_pair_overflow: false,
          },
        }),
        prisma.wallet.update({
          where: { user_id: ancestor.user_id },
          data:  { balance: { increment: paidEarnings }, total_earned: { increment: paidEarnings } },
        }),

      ])
    }

    // Overflow to Hiroma
    if (overflowPairs > 0 && overflowEarnings > 0 && hiromaUser) {
      await Promise.all([
        prisma.commission.create({
          data: {
            user_id:          hiromaUser.id,
            type:             'sponsor_point',
            amount:           overflowEarnings,
            points:           overflowPoints,
            source_user_id:   buyerUserId,
            overflow_to:      hiromaUser.id,
            is_pair_overflow: true,
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

    // Allow payment_status updates even on finalized orders
    if ((order.status === 'delivered' || order.status === 'cancelled') && status) {
      return NextResponse.json({ error: 'Order is already finalized.' }, { status: 400 })
    }

    if (order.buyer_id === user.id && order.seller_id !== user.id && status && status !== 'cancelled') {
      return NextResponse.json({ error: 'You can only cancel your own orders.' }, { status: 403 })
    }

    let buyerIsReseller = false

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
          buyerIsReseller = true
        }
      }

      return updatedOrder
    })

    // Run product binary pairing OUTSIDE transaction to avoid timeout
    if (status === 'delivered' && buyerIsReseller) {
      try {
        // Calculate total PU from this order (quantity × pu_value, binary_eligible only)
        const productIds  = order.items.map((i: any) => i.product_id)
        // Use raw SQL since pu_value/binary_eligible not in Prisma client yet
        const products = await prisma.$queryRaw<{ id: string; pu_value: number }[]>`
          SELECT id::text, COALESCE(pu_value, 0) as pu_value FROM products
          WHERE id::text = ANY(${productIds}) AND COALESCE(binary_eligible, true) = true AND COALESCE(pu_value, 0) > 0
        `.catch(() => [] as { id: string; pu_value: number }[])
        const puMap = new Map(products.map((p: any) => [p.id, Number(p.pu_value)]))
        const currentOrderPU = order.items.reduce((sum: number, i: any) => {
          return sum + (i.quantity * (puMap.get(i.product_id) || 0))
        }, 0)
        if (currentOrderPU > 0) {
          // 1. Update buyer's own total_pu and rank
          const buyerProfile = await prisma.resellerProfile.findUnique({
            where:  { user_id: order.buyer_id },
            select: { package_id: true },
          })
          if (buyerProfile) {
            // Fetch buyer's current rank/total_pu via raw SQL
            let buyerExtra = { rank: 'default', total_pu: 0 }
            try {
              const brows = await prisma.$queryRaw<{ rank: string; total_pu: number }[]>`
                SELECT COALESCE(rank, 'default') as rank, COALESCE(total_pu, 0) as total_pu
                FROM reseller_profiles WHERE user_id::text = ${order.buyer_id}
              `
              if (brows[0]) buyerExtra = { rank: brows[0].rank, total_pu: Number(brows[0].total_pu) }
            } catch { /* not migrated yet */ }
            const bp = { ...buyerProfile, ...buyerExtra }
            const newTotalPU  = (bp.total_pu || 0) + currentOrderPU
            const buyerPackageId = await prisma.resellerProfile.findUnique({
              where: { user_id: order.buyer_id },
              select: { package_id: true },
            }).then(p => p?.package_id || '')
            const newRank = buyerPackageId ? await getCurrentRankForReseller(buyerPackageId, newTotalPU) : null
            const rankChanged = newRank && newRank.name !== (bp.rank || 'default')

            // Use raw SQL since rank/total_pu not in Prisma client yet
            try {
              if (rankChanged) {
                await prisma.$executeRaw`
                  UPDATE reseller_profiles SET total_pu = total_pu + ${currentOrderPU}, rank = ${newRank!.name}
                  WHERE user_id::text = ${order.buyer_id}
                `
              } else {
                await prisma.$executeRaw`
                  UPDATE reseller_profiles SET total_pu = total_pu + ${currentOrderPU}
                  WHERE user_id::text = ${order.buyer_id}
                `
              }
            } catch { /* columns not migrated yet */ }

            // Rank up! Higher points per pair from now on — no cash reward, fixed ₱0.50/point conversion
          }

          // 2. Fire ancestor pairing
          await checkSponsorPairingPoints(order.buyer_id, currentOrderPU)
        }
      } catch (e) {
        console.error('[CITY ORDERS] Product binary pairing error:', e)
      }
    }

    return NextResponse.json({ success: true, order: updated })
  } catch (error) {
    console.error('[CITY ORDERS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}