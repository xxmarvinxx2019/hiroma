import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getCurrentRankForReseller } from '@/app/api/admin/ranks/route'

// ── Product Binary Pairing for reseller inventory assignments ──
async function triggerProductBinaryPairing(buyerUserId: string, currentOrderPU: number) {
  if (currentOrderPU <= 0) return

  const buyerNode = await prisma.binaryTreeNode.findUnique({
    where:  { user_id: buyerUserId },
    select: { id: true, parent_id: true, position: true },
  })
  if (!buyerNode?.parent_id) return

  const hiromaUser = await prisma.user.findFirst({ where: { username: 'hiroma' }, select: { id: true } })

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

  const resetSettings = await prisma.$queryRaw<{ key: string; value: string }[]>`
    SELECT key, value FROM system_settings WHERE key IN ('pu_reset_month', 'pu_reset_day')
  `.catch(() => [] as { key: string; value: string }[])
  const settingsMap = new Map(resetSettings.map(s => [s.key, s.value]))
  const resetMonth  = parseInt(settingsMap.get('pu_reset_month') || '3') - 1
  const resetDay    = parseInt(settingsMap.get('pu_reset_day')   || '1')
  const now2        = new Date()
  let periodStart   = new Date(now2.getFullYear(), resetMonth, resetDay)
  if (now2 < periodStart) periodStart = new Date(now2.getFullYear() - 1, resetMonth, resetDay)
  const resetAt = periodStart
  const today   = new Date(); today.setHours(0, 0, 0, 0)

  for (let i = 0; i < ancestors.length; i++) {
    const ancestor = ancestors[i]
    const profile  = await prisma.resellerProfile.findUnique({
      where:  { user_id: ancestor.user_id },
      select: { user_id: true, daily_pairing_count: true, daily_pairing_date: true, package: { select: { id: true, point_php_value: true } } },
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

    const children = await prisma.binaryTreeNode.findMany({ where: { parent_id: ancestor.id }, select: { id: true, position: true } })
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
    const leg: 'left' | 'right' = i === 0 ? (buyerNode.position as 'left' | 'right') : (ancestors[i - 1].position as 'left' | 'right') || 'left'
    if (leg === 'left') leftPU += currentOrderPU; else rightPU += currentOrderPU

    const possiblePairs = Math.floor(Math.min(leftPU, rightPU) / 2)
    if (possiblePairs <= 0) continue

    const lastPairDate = profileAny.daily_pairing_date ? new Date(profileAny.daily_pairing_date) : null
    const isToday      = lastPairDate ? lastPairDate >= today : false
    const usedToday    = isToday ? Number(profileAny.daily_pairing_count || 0) : 0
    const remaining    = Math.max(0, (profileAny.daily_product_pairing_cap || 50) - usedToday)
    const paidPairs     = Math.min(possiblePairs, remaining)
    const overflowPairs = possiblePairs - paidPairs
    const paidEarnings     = paidPairs     * pointsPerPair * phpPerPoint
    const overflowEarnings = overflowPairs * pointsPerPair * phpPerPoint

    if (paidPairs > 0) {
      await Promise.all([
        prisma.resellerProfile.update({ where: { user_id: ancestor.user_id }, data: { total_points: { increment: paidPairs * pointsPerPair }, daily_pairing_count: isToday ? { increment: paidPairs } : paidPairs, daily_pairing_date: today } }),
        prisma.commission.create({ data: { user_id: ancestor.user_id, type: 'sponsor_point', amount: paidEarnings, points: paidPairs * pointsPerPair, source_user_id: buyerUserId, is_pair_overflow: false } }),
        prisma.wallet.update({ where: { user_id: ancestor.user_id }, data: { balance: { increment: paidEarnings }, total_earned: { increment: paidEarnings } } }),
      ])
    }
    if (overflowPairs > 0 && overflowEarnings > 0 && hiromaUser) {
      await Promise.all([
        prisma.commission.create({ data: { user_id: hiromaUser.id, type: 'sponsor_point', amount: overflowEarnings, points: overflowPairs * pointsPerPair, source_user_id: buyerUserId, overflow_to: hiromaUser.id, is_pair_overflow: true } }),
        prisma.wallet.upsert({ where: { user_id: hiromaUser.id }, update: { balance: { increment: overflowEarnings }, total_earned: { increment: overflowEarnings } }, create: { user_id: hiromaUser.id, balance: overflowEarnings, total_earned: overflowEarnings, total_withdrawn: 0 } }),
      ])
    }
  }
}

const PRICE_FIELD: Record<string, 'regional_price' | 'provincial_price' | 'city_price' | 'branch_price' | 'reseller_price'> = {
  regional:   'regional_price',
  provincial: 'provincial_price',
  city:       'city_price',
  branch:     'branch_price',
  reseller:   'reseller_price',  // ← added
}

// ── GET ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const owner_id          = searchParams.get('owner_id')          || ''
    const recipient_search  = searchParams.get('recipient_search')  || ''
    const recipient_role    = searchParams.get('recipient_role')    || 'all'
    const recipient_page    = Math.max(1, parseInt(searchParams.get('recipient_page') || '1'))
    const recipient_size    = 10
    const search       = searchParams.get('search')      || ''
    const stock_search = searchParams.get('stock_search')|| ''
    const type         = searchParams.get('type')        || 'all'
    const page         = Math.max(1, parseInt(searchParams.get('page')      || '1'))
    const pageSize     = Math.max(1, parseInt(searchParams.get('pageSize')  || '20'))
    const stockPage    = Math.max(1, parseInt(searchParams.get('stockPage') || '1'))

    const productFilter: Record<string, unknown> = {
      ...(type !== 'all' && { type }),
      ...(search && { name: { contains: search, mode: 'insensitive' } }),
    }

    const where: Record<string, unknown> = {
      owner: { role: { in: ['regional', 'provincial', 'city', 'reseller'] } },
      ...(owner_id && { owner_id }),
      ...(Object.keys(productFilter).length > 0 && { product: productFilter }),
    }

    const [total, items, distributors, adminRevenue, adminTotalOrders, recipientTotal, recipientList] = await Promise.all([
      prisma.inventory.count({ where }),
      prisma.inventory.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, quantity: true, low_stock_threshold: true, updated_at: true,
          owner: {
            select: {
              id: true, full_name: true, username: true, role: true,
              distributor_profile: { select: { dist_level: true } },
            },
          },
          product: {
            select: {
              id: true, name: true, type: true,
              cost_price: true, regional_price: true, provincial_price: true, city_price: true,
              branch_price: true,
            },
          },
        },
      }),
      prisma.user.findMany({
        where:   { role: { in: ['regional', 'provincial', 'city', 'reseller'] }, status: 'active' },
        select:  {
          id: true, full_name: true, username: true, role: true,
          distributor_profile: { select: { dist_level: true } },
        },
        orderBy: { role: 'asc' },
      }),
      prisma.order.aggregate({
        where: { seller_id: user.id, status: 'delivered' },
        _sum:  { total_amount: true },
      }),
      prisma.order.count({ where: { seller_id: user.id } }),

      prisma.user.count({
        where: {
          status: 'active',
          role: { in: recipient_role !== 'all' ? [recipient_role as any] : ['regional', 'provincial', 'city', 'reseller'] },
          ...(recipient_search && {
            OR: [
              { full_name: { contains: recipient_search, mode: 'insensitive' } },
              { username:  { contains: recipient_search, mode: 'insensitive' } },
            ],
          }),
        },
      }),

      prisma.user.findMany({
        where: {
          status: 'active',
          role: { in: recipient_role !== 'all' ? [recipient_role as any] : ['regional', 'provincial', 'city', 'reseller'] },
          ...(recipient_search && {
            OR: [
              { full_name: { contains: recipient_search, mode: 'insensitive' } },
              { username:  { contains: recipient_search, mode: 'insensitive' } },
            ],
          }),
        },
        select:  {
          id: true, full_name: true, username: true, role: true,
          distributor_profile: { select: { dist_level: true } },
        },
        orderBy: { full_name: 'asc' },
        skip:    (recipient_page - 1) * recipient_size,
        take:    recipient_size,
      }),
    ])

    const allInventory = await prisma.inventory.findMany({
      where:  { owner: { role: { in: ['regional', 'provincial', 'city', 'reseller'] } } },
      select: {
        quantity: true, low_stock_threshold: true,
        product:  { select: { id: true } },
      },
    })

    const distributedMap = new Map<string, number>()
    const lowStockSet    = new Set<string>()
    for (const inv of allInventory) {
      const pid = (inv.product as any).id
      distributedMap.set(pid, (distributedMap.get(pid) || 0) + inv.quantity)
      if (inv.quantity <= inv.low_stock_threshold) lowStockSet.add(pid)
    }

    const stockWhere: Record<string, unknown> = {
      is_active: true,
      ...(stock_search && { name: { contains: stock_search, mode: 'insensitive' } }),
    }

    const [stockTotal, products] = await Promise.all([
      prisma.product.count({ where: stockWhere }),
      prisma.product.findMany({
        where:   stockWhere,
        select: {
          id: true, name: true, type: true,
          cost_price: true, regional_price: true, provincial_price: true,
          city_price: true, branch_price: true, reseller_price: true,
        },
        orderBy: { name: 'asc' },
        skip:    (stockPage - 1) * pageSize,
        take:    pageSize,
      }),
    ])

    const productStockSummary = products.map((p) => ({
      ...p,
      total_distributed: distributedMap.get(p.id) || 0,
      is_low_stock:      lowStockSet.has(p.id),
    }))

    const adminOwnStock = await prisma.inventory.findMany({
      where:  { owner_id: user.id },
      select: { product_id: true, quantity: true },
    })
    const adminStockMap = new Map(adminOwnStock.map((i) => [i.product_id, i.quantity]))

    const productStockSummaryWithAdmin = productStockSummary.map((p) => ({
      ...p,
      admin_stock: adminStockMap.get(p.id) ?? 0,
    }))

    return NextResponse.json({
      items,
      distributors,
      recipients:    recipientList,
      recipientMeta: { total: recipientTotal, totalPages: Math.max(1, Math.ceil(recipientTotal / recipient_size)) },
      productStockSummary: productStockSummaryWithAdmin,
      adminRevenue:     Number(adminRevenue._sum.total_amount || 0),
      adminTotalOrders,
      meta:      { total,      page,      pageSize, totalPages: Math.max(1, Math.ceil(total      / pageSize)) },
      stockMeta: { total: stockTotal, page: stockPage, pageSize, totalPages: Math.max(1, Math.ceil(stockTotal / pageSize)) },
    })
  } catch (error) {
    console.error('[ADMIN INVENTORY GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST — assign stock (creates order + credits inventory) ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { owner_id, items, notes } = await req.json()

    if (!owner_id || !items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'owner_id and items are required.' }, { status: 400 })

    const owner = await prisma.user.findFirst({
      where:  { id: owner_id, role: { in: ['regional', 'provincial', 'city', 'reseller'] }, status: 'active' },
      select: {
        id: true, full_name: true, role: true,
        distributor_profile: { select: { dist_level: true } },
      },
    })
    if (!owner) return NextResponse.json({ error: 'Distributor not found.' }, { status: 404 })

    const priceLevel = owner.distributor_profile?.dist_level === 'branch' ? 'branch' : owner.role
    const priceField = PRICE_FIELD[priceLevel] || 'reseller_price'
    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const products   = await prisma.product.findMany({
      where:  { id: { in: productIds }, is_active: true },
      select: {
        id: true, name: true,
        cost_price: true, regional_price: true, provincial_price: true, city_price: true, branch_price: true, reseller_price: true,
      },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    const adminStock = await prisma.inventory.findMany({
      where:  { owner_id: user.id, product_id: { in: productIds } },
      select: { product_id: true, quantity: true },
    })
    const adminStockMap = new Map(adminStock.map((i) => [i.product_id, i.quantity]))

    const stockErrors = items
      .map((item: { product_id: string; quantity: number }) => {
        const available = adminStockMap.get(item.product_id) ?? 0
        const product   = products.find((p) => p.id === item.product_id)
        return available < item.quantity
          ? `"${product?.name}": need ${item.quantity}, only ${available} in stock`
          : null
      })
      .filter(Boolean)

    if (stockErrors.length > 0) {
      return NextResponse.json({
        error: `Insufficient admin stock:\n${stockErrors.join('\n')}`,
      }, { status: 400 })
    }

    const productMap = new Map(products.map((p) => [p.id, p]))
    let   totalAmount = 0

    const orderItems = items.map((item: { product_id: string; quantity: number }) => {
      const product   = productMap.get(item.product_id)!
      const configuredPrice = Number(product[priceField] || product.reseller_price || 0)
      const unitPrice = priceLevel === 'branch' && configuredPrice <= 0
        ? Number(product.cost_price)
        : configuredPrice
      const subtotal  = unitPrice * item.quantity
      totalAmount    += subtotal
      return { product_id: item.product_id, quantity: item.quantity, unit_price: unitPrice, subtotal }
    })

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          buyer_id:          owner_id,
          seller_id:         user.id,
          order_type:        'offline',
          status:            'delivered',
          total_amount:      totalAmount,
          is_cross_purchase: false,
          notes:             notes?.trim() || `Stock assigned to ${owner.full_name}`,
          items:             { create: orderItems },
        },
        select: { id: true, total_amount: true, created_at: true },
      })

      for (const item of orderItems) {
        await tx.inventory.upsert({
          where:  { owner_id_product_id: { owner_id, product_id: item.product_id } },
          update: { quantity: { increment: item.quantity } },
          create: {
            owner_id,
            product_id:          item.product_id,
            quantity:            item.quantity,
            low_stock_threshold: 10,
          },
        })

        await tx.inventory.updateMany({
          where: { owner_id: user.id, product_id: item.product_id },
          data:  { quantity: { decrement: item.quantity } },
        })
      }

      return newOrder
    })

    // Fire product binary pairing if owner is reseller
    if (owner.role === 'reseller') {
      try {
        const puProducts = await prisma.$queryRaw<{ id: string; pu_value: number }[]>`
          SELECT id::text, COALESCE(pu_value, 0) as pu_value FROM products
          WHERE id::text = ANY(${productIds}::text[]) AND COALESCE(binary_eligible, true) = true AND COALESCE(pu_value, 0) > 0
        `.catch(() => [] as { id: string; pu_value: number }[])
        const puMap = new Map(puProducts.map((p: any) => [p.id, Number(p.pu_value)]))
        const currentOrderPU = items.reduce((sum: number, i: any) => sum + (i.quantity * (puMap.get(i.product_id) || 0)), 0)
        if (currentOrderPU > 0) {
          await triggerProductBinaryPairing(owner_id, currentOrderPU)
        }
      } catch (e) { console.error('[INVENTORY] Product binary pairing error:', e) }
    }

    return NextResponse.json({
      success:      true,
      message:      `Stock assigned to ${owner.full_name}. ₱${totalAmount.toLocaleString()} recorded.`,
      order,
      total_amount: totalAmount,
    })
  } catch (error) {
    console.error('[ADMIN INVENTORY POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH — update low stock threshold ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { inventory_id, low_stock_threshold } = await req.json()
    if (!inventory_id || low_stock_threshold == null)
      return NextResponse.json({ error: 'Missing fields.' }, { status: 400 })

    const item = await prisma.inventory.findUnique({ where: { id: inventory_id } })
    if (!item) return NextResponse.json({ error: 'Inventory item not found.' }, { status: 404 })

    const updated = await prisma.inventory.update({
      where: { id: inventory_id },
      data:  { low_stock_threshold: Math.max(0, parseInt(low_stock_threshold)) },
    })

    return NextResponse.json({ success: true, item: updated })
  } catch (error) {
    console.error('[ADMIN INVENTORY PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PUT — admin adds new production/received stock ──
export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { items, notes } = await req.json()

    if (!items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'items are required.' }, { status: 400 })

    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const products   = await prisma.product.findMany({
      where:  { id: { in: productIds }, is_active: true },
      select: { id: true, name: true },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    for (const item of items) {
      await prisma.inventory.upsert({
        where:  { owner_id_product_id: { owner_id: user.id, product_id: item.product_id } },
        update: { quantity: { increment: item.quantity } },
        create: {
          owner_id:            user.id,
          product_id:          item.product_id,
          quantity:            item.quantity,
          low_stock_threshold: 10,
        },
      })
    }

    return NextResponse.json({
      success: true,
      message: `Stock updated for ${items.length} product(s). Notes: ${notes || 'N/A'}`,
    })
  } catch (error) {
    console.error('[ADMIN INVENTORY PUT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
