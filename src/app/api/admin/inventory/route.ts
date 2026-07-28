import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getCurrentRankForReseller } from '@/app/api/admin/ranks/route'
import { createAuditLog, getClientInfo } from '@/app/lib/auditLog'

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

    let extraData = { rank: 'default', total_pu: 0, daily_product_pairing_cap: 50, product_binary_cap_enabled: true }
    try {
      const rows = await prisma.$queryRaw<{ rank: string; total_pu: number; daily_product_pairing_cap: number; product_binary_cap_enabled: boolean }[]>`
        SELECT COALESCE(rp.rank, 'default') as rank, COALESCE(rp.total_pu, 0) as total_pu,
               COALESCE(p.daily_product_pairing_cap, 50)::int as daily_product_pairing_cap,
               COALESCE(p.product_binary_cap_enabled, true) as product_binary_cap_enabled
        FROM reseller_profiles rp LEFT JOIN packages p ON p.id = rp.package_id
        WHERE rp.user_id::text = ${ancestor.user_id}
      `
      if (rows[0]) extraData = { rank: rows[0].rank, total_pu: Number(rows[0].total_pu), daily_product_pairing_cap: Number(rows[0].daily_product_pairing_cap), product_binary_cap_enabled: rows[0].product_binary_cap_enabled !== false }
    } catch { /* not migrated yet */ }

    const profileAny    = { ...profile, ...extraData } as typeof profile & { rank: string; total_pu: number; daily_product_pairing_cap: number; product_binary_cap_enabled: boolean }
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
    const remaining    = profileAny.product_binary_cap_enabled
      ? Math.max(0, (profileAny.daily_product_pairing_cap || 50) - usedToday)
      : possiblePairs
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
              branch_price: true, reseller_price: true, price: true,
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

    const movementRows = items.length > 0
      ? await prisma.inventoryMovement.findMany({
          where: {
            OR: items.map((item) => ({
              recipient_id: item.owner.id,
              product_id: item.product.id,
            })),
          },
          orderBy: { created_at: 'desc' },
        }).catch((error) => {
          console.warn('[ADMIN INVENTORY] Movement ledger unavailable; showing legacy inventory data.', error)
          return []
        })
      : []
    const latestMovementMap = new Map<string, (typeof movementRows)[number]>()
    for (const movement of movementRows) {
      const key = `${movement.recipient_id}:${movement.product_id}`
      if (!latestMovementMap.has(key)) latestMovementMap.set(key, movement)
    }
    const itemsWithMovement = items.map((item) => {
      const movement = latestMovementMap.get(`${item.owner.id}:${item.product.id}`)
      const ownerLevel = item.owner.distributor_profile?.dist_level || item.owner.role
      const unitPrice = ownerLevel === 'branch'
        ? Number(item.product.branch_price) || Number(item.product.cost_price)
        : ownerLevel === 'regional'
          ? Number(item.product.regional_price)
          : ownerLevel === 'provincial'
            ? Number(item.product.provincial_price)
            : ownerLevel === 'reseller'
              ? Number(item.product.reseller_price)
              : Number(item.product.city_price)
      const currentReferenceValue = unitPrice * item.quantity
      const currentSaleValue = ownerLevel === 'branch' ? 0 : currentReferenceValue
      const currentCost = Number(item.product.cost_price) * item.quantity

      return {
        ...item,
        movement: movement ? {
          quantity:                movement.quantity,
          reference_value:         Number(movement.reference_value),
          sale_value:              Number(movement.sale_value),
          admin_profit:            Number(movement.admin_profit),
          is_sale:                 movement.is_sale,
          admin_stock_before:      movement.admin_stock_before,
          admin_stock_after:       movement.admin_stock_after,
          recipient_stock_before:  movement.recipient_stock_before,
          recipient_stock_after:   movement.recipient_stock_after,
          created_at:              movement.created_at,
          is_legacy:               false,
        } : {
          quantity:                null,
          reference_value:         currentReferenceValue,
          sale_value:              currentSaleValue,
          admin_profit:            ownerLevel === 'branch' ? 0 : currentSaleValue - currentCost,
          is_sale:                 ownerLevel !== 'branch',
          admin_stock_before:      null,
          admin_stock_after:       null,
          recipient_stock_before:  null,
          recipient_stock_after:   item.quantity,
          created_at:              null,
          is_legacy:               true,
        },
      }
    })

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
          price: true, cost_price: true, regional_price: true, provincial_price: true,
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
      items: itemsWithMovement,
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

    const normalizedItems = items.map((item: { product_id?: unknown; quantity?: unknown }) => ({
      product_id: typeof item.product_id === 'string' ? item.product_id : '',
      quantity: Number(item.quantity),
    }))
    const productIds = normalizedItems.map((item) => item.product_id)
    if (
      normalizedItems.some((item) =>
        !item.product_id || !Number.isSafeInteger(item.quantity) || item.quantity <= 0
      ) ||
      new Set(productIds).size !== productIds.length
    ) {
      return NextResponse.json(
        { error: 'Each product must appear once with a positive whole-number quantity.' },
        { status: 400 }
      )
    }

    const owner = await prisma.user.findFirst({
      where:  { id: owner_id, role: { in: ['regional', 'provincial', 'city', 'reseller'] }, status: 'active' },
      select: {
        id: true, full_name: true, role: true,
        distributor_profile: { select: { dist_level: true } },
      },
    })
    if (!owner) return NextResponse.json({ error: 'Distributor not found.' }, { status: 404 })

    const isBranchTransfer = owner.distributor_profile?.dist_level === 'branch'
    const priceLevel = isBranchTransfer ? 'branch' : owner.role
    const priceField = PRICE_FIELD[priceLevel] || 'reseller_price'
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

    const stockErrors = normalizedItems
      .map((item) => {
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

    const orderItems = normalizedItems.map((item) => {
      const product   = productMap.get(item.product_id)!
      const configuredPrice = Number(product[priceField] || product.reseller_price || 0)
      const unitPrice = priceLevel === 'branch' && configuredPrice <= 0
        ? Number(product.cost_price)
        : configuredPrice
      const subtotal  = unitPrice * item.quantity
      totalAmount    += subtotal
      return { product_id: item.product_id, quantity: item.quantity, unit_price: unitPrice, subtotal }
    })

    const invalidPriceItem = orderItems.find((item) => !Number.isFinite(item.unit_price) || item.unit_price <= 0)
    if (invalidPriceItem) {
      const product = productMap.get(invalidPriceItem.product_id)
      return NextResponse.json(
        { error: `A valid ${priceLevel} price is required for "${product?.name || 'this product'}".` },
        { status: 400 }
      )
    }

    const order = await prisma.$transaction(async (tx) => {
      const newOrder = isBranchTransfer
        ? null
        : await tx.order.create({
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

      const movements: Parameters<typeof tx.inventoryMovement.createMany>[0]['data'] = []
      for (const item of orderItems) {
        const adminInventory = await tx.inventory.findUnique({
          where: { owner_id_product_id: { owner_id: user.id, product_id: item.product_id } },
          select: { id: true, quantity: true },
        })
        const recipientInventory = await tx.inventory.findUnique({
          where: { owner_id_product_id: { owner_id, product_id: item.product_id } },
          select: { quantity: true },
        })
        const adminStockBefore = adminInventory?.quantity ?? 0
        const recipientStockBefore = recipientInventory?.quantity ?? 0

        const deducted = adminInventory
          ? await tx.inventory.updateMany({
              where: { id: adminInventory.id, quantity: { gte: item.quantity } },
              data:  { quantity: { decrement: item.quantity } },
            })
          : { count: 0 }
        if (deducted.count !== 1) {
          const product = productMap.get(item.product_id)
          throw new Error(`INSUFFICIENT_STOCK:${product?.name || item.product_id}`)
        }

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

        const product = productMap.get(item.product_id)!
        const unitCost = Number(product.cost_price)
        const referenceValue = item.subtotal
        const saleValue = isBranchTransfer ? 0 : referenceValue
        movements.push({
          admin_id:               user.id,
          recipient_id:           owner_id,
          product_id:             item.product_id,
          order_id:               newOrder?.id || null,
          quantity:               item.quantity,
          unit_cost:              unitCost,
          unit_price:             item.unit_price,
          reference_value:        referenceValue,
          sale_value:             saleValue,
          admin_profit:           isBranchTransfer ? 0 : saleValue - (unitCost * item.quantity),
          is_sale:                !isBranchTransfer,
          admin_stock_before:     adminStockBefore,
          admin_stock_after:      adminStockBefore - item.quantity,
          recipient_stock_before: recipientStockBefore,
          recipient_stock_after:  recipientStockBefore + item.quantity,
          notes:                  notes?.trim() || null,
        })
      }

      await tx.inventoryMovement.createMany({ data: movements })
      return newOrder
    })

    if (isBranchTransfer) {
      createAuditLog({
        user_id:       user.id,
        user_name:     user.full_name,
        user_role:     user.role,
        activity_type: 'branch_stock_transfer',
        category:      'distributor',
        description:   `Transferred stock from Admin to Hiroma Branch ${owner.full_name} without recording a sale.`,
        metadata: {
          recipient_id:    owner.id,
          recipient_name:  owner.full_name,
          reference_value: totalAmount,
          items:            orderItems,
          notes:            notes?.trim() || null,
        },
        ...getClientInfo(req),
      })
    }

    // Fire product binary pairing if owner is reseller
    if (owner.role === 'reseller') {
      try {
        const puProducts = await prisma.$queryRaw<{ id: string; pu_value: number }[]>`
          SELECT id::text, COALESCE(pu_value, 0) as pu_value FROM products
          WHERE id::text = ANY(${productIds}::text[]) AND COALESCE(binary_eligible, true) = true AND COALESCE(pu_value, 0) > 0
        `.catch(() => [] as { id: string; pu_value: number }[])
        const puMap = new Map(puProducts.map((p: any) => [p.id, Number(p.pu_value)]))
        const currentOrderPU = normalizedItems.reduce((sum, i) => sum + (i.quantity * (puMap.get(i.product_id) || 0)), 0)
        if (currentOrderPU > 0) {
          await triggerProductBinaryPairing(owner_id, currentOrderPU)
        }
      } catch (e) { console.error('[INVENTORY] Product binary pairing error:', e) }
    }

    return NextResponse.json({
      success:      true,
      message:      isBranchTransfer
        ? `Stock transferred to ${owner.full_name}. No sale or Admin revenue was recorded.`
        : `Stock assigned to ${owner.full_name}. ₱${totalAmount.toLocaleString()} recorded.`,
      transaction_type: isBranchTransfer ? 'internal_transfer' : 'sale',
      order,
      total_amount: isBranchTransfer ? 0 : totalAmount,
      reference_value: totalAmount,
    })
  } catch (error) {
    console.error('[ADMIN INVENTORY POST ERROR]', error)
    if (error instanceof Error && error.message.startsWith('INSUFFICIENT_STOCK:')) {
      return NextResponse.json(
        { error: `Insufficient admin stock for "${error.message.slice('INSUFFICIENT_STOCK:'.length)}". Please refresh and retry.` },
        { status: 409 }
      )
    }
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

    const normalizedItems = items.map((item: { product_id?: unknown; quantity?: unknown }) => ({
      product_id: typeof item.product_id === 'string' ? item.product_id : '',
      quantity: Number(item.quantity),
    }))
    const productIds = normalizedItems.map((item) => item.product_id)
    if (
      normalizedItems.some((item) =>
        !item.product_id || !Number.isSafeInteger(item.quantity) || item.quantity <= 0
      ) ||
      new Set(productIds).size !== productIds.length
    ) {
      return NextResponse.json(
        { error: 'Each product must appear once with a positive whole-number quantity.' },
        { status: 400 }
      )
    }

    const products   = await prisma.product.findMany({
      where:  { id: { in: productIds }, is_active: true },
      select: { id: true, name: true },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    await prisma.$transaction(
      normalizedItems.map((item) =>
        prisma.inventory.upsert({
          where:  { owner_id_product_id: { owner_id: user.id, product_id: item.product_id } },
          update: { quantity: { increment: item.quantity } },
          create: {
            owner_id:            user.id,
            product_id:          item.product_id,
            quantity:            item.quantity,
            low_stock_threshold: 10,
          },
        })
      )
    )

    return NextResponse.json({
      success: true,
      message: `Stock updated for ${normalizedItems.length} product(s). Notes: ${notes || 'N/A'}`,
    })
  } catch (error) {
    console.error('[ADMIN INVENTORY PUT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
