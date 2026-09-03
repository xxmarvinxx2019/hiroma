import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { consumeAvailableStock, InsufficientStockError } from '@/app/lib/inventoryReservation'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'
import { PRODUCT_BINARY_WAITING_PAYMENT_WARNING } from '@/app/lib/productBinary'
import { boundedPage, boundedPageSize } from '@/app/lib/pagination'

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
    const recipient_scope   = searchParams.get('recipient_scope')   || 'all'
    const recipient_page    = boundedPage(searchParams.get('recipient_page'))
    // Keep the recipient picker compact. Search and pagination still cover
    // every matching registered recipient without rendering a long dropdown.
    const recipient_size    = 3
    const search       = searchParams.get('search')      || ''
    const stock_search = searchParams.get('stock_search')|| ''
    const type         = searchParams.get('type')        || 'all'
    const page         = boundedPage(searchParams.get('page'))
    const pageSize     = boundedPageSize(searchParams.get('pageSize'), 20)
    const stockPage    = boundedPage(searchParams.get('stockPage'))

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
          ...(recipient_scope === 'branch'
            ? { role: 'city', distributor_profile: { is: { dist_level: 'branch' } } }
            : recipient_scope === 'sale'
              ? {
                  role: { in: recipient_role !== 'all' ? [recipient_role as any] : ['regional', 'provincial', 'city', 'reseller'] },
                  NOT: { distributor_profile: { is: { dist_level: 'branch' } } },
                }
              : { role: { in: recipient_role !== 'all' ? [recipient_role as any] : ['regional', 'provincial', 'city', 'reseller'] } }),
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
          ...(recipient_scope === 'branch'
            ? { role: 'city', distributor_profile: { is: { dist_level: 'branch' } } }
            : recipient_scope === 'sale'
              ? {
                  role: { in: recipient_role !== 'all' ? [recipient_role as any] : ['regional', 'provincial', 'city', 'reseller'] },
                  NOT: { distributor_profile: { is: { dist_level: 'branch' } } },
                }
              : { role: { in: recipient_role !== 'all' ? [recipient_role as any] : ['regional', 'provincial', 'city', 'reseller'] } }),
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
    const stockReceipts = await prisma.adminStockReceipt.findMany({
      where: { admin_id: user.id },
      orderBy: [{ received_at: 'desc' }, { id: 'desc' }],
      take: 25,
      include: { items: { select: { product_id: true, quantity: true, unit_cost: true, stock_before: true, stock_after: true } } },
    })

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
      stockReceipts: stockReceipts.map((receipt) => ({
        ...receipt,
        items: receipt.items.map((item) => ({ ...item, unit_cost: Number(item.unit_cost) })),
      })),
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

    const { owner_id, items, notes, workflow } = await req.json()

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
    const actorId = user.actor_id || user.id
    const actorName = user.actor_name || user.full_name
    const clientInfo = getClientInfo(req)
    if (workflow !== 'branch_transfer' && workflow !== 'distributor_sale') {
      return NextResponse.json({ error: 'A valid stock workflow is required.' }, { status: 400 })
    }
    if (workflow === 'branch_transfer' && !isBranchTransfer) {
      return NextResponse.json({ error: 'Internal transfers can only be sent to a Hiroma Branch.' }, { status: 400 })
    }
    if (workflow === 'distributor_sale' && isBranchTransfer) {
      return NextResponse.json({ error: 'Hiroma Branch stock must use the internal transfer workflow.' }, { status: 400 })
    }
    const priceLevel = isBranchTransfer ? 'branch' : owner.role
    const transferId = isBranchTransfer ? crypto.randomUUID() : null
    const transferReference = transferId ? `TRF-${transferId.slice(0, 8).toUpperCase()}` : null
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
      await consumeAvailableStock(tx, user.id, orderItems)
      if (isBranchTransfer) {
        await tx.inventoryTransfer.create({
          data: {
            id:               transferId!,
            reference_number: transferReference!,
            admin_id:         user.id,
            dispatched_by_actor_id: actorId,
            recipient_id:     owner_id,
            status:           'in_transit',
            reference_value:  totalAmount,
            notes:            notes?.trim() || null,
          },
        })
      }
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
        const adminStockBefore = (adminInventory?.quantity ?? 0) + item.quantity
        const recipientStockBefore = recipientInventory?.quantity ?? 0

        // Commercial assignments are immediately delivered. Internal Branch
        // transfers remain in transit until the Branch records what physically
        // arrived; only accepted units become sellable inventory at receiving.
        if (!isBranchTransfer) {
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
        }

        const product = productMap.get(item.product_id)!
        const unitCost = Number(product.cost_price)
        const referenceValue = item.subtotal
        const saleValue = isBranchTransfer ? 0 : referenceValue
        movements.push({
          transfer_id:            transferId,
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
          recipient_stock_after:  isBranchTransfer ? recipientStockBefore : recipientStockBefore + item.quantity,
          notes:                  notes?.trim() || null,
        })
      }

      await tx.inventoryMovement.createMany({ data: movements })

      const recipientDashboard = owner.role === 'regional'
        ? 'regional'
        : owner.role === 'provincial'
          ? 'provincial'
          : owner.role === 'reseller'
            ? 'reseller'
            : 'city'
      await tx.notification.create({
        data: isBranchTransfer
          ? {
              user_id:     owner.id,
              type:        'inventory_transfer_in_transit',
              title:       'Incoming stock transfer',
              message:     `${orderItems.reduce((sum, item) => sum + item.quantity, 0).toLocaleString()} unit(s) were dispatched by Hiroma Admin. Check the delivery and record good, damaged, or missing quantities before the stock becomes available.`,
              amount:      totalAmount,
              entity_type: 'inventory_transfer',
              entity_id:   transferId,
              action_url:  `/dashboard/city/transfers/${transferId}`,
            }
          : {
              user_id:     owner.id,
              type:        'order_stock_assigned',
              title:       'Stock sale recorded by Hiroma Admin',
              message:     `${orderItems.reduce((sum, item) => sum + item.quantity, 0).toLocaleString()} unit(s) worth ₱${totalAmount.toLocaleString()} were assigned to your account. Tap to view the order receipt.`,
              amount:      totalAmount,
              entity_type: 'order',
              entity_id:   newOrder!.id,
              action_url:  `/dashboard/${recipientDashboard}/orders/${newOrder!.id}`,
            },
      })
      if (isBranchTransfer) {
        await createRequiredAuditLog(tx, {
          user_id:       actorId,
          user_name:     actorName,
          user_role:     user.role,
          activity_type: 'branch_stock_dispatched',
          category:      'distributor',
          description:   `Dispatched stock from Admin to Hiroma Branch ${owner.full_name}; inventory remains in transit pending Branch receiving.`,
          metadata: {
            owner_admin_id: user.id,
            recipient_id: owner.id,
            recipient_name: owner.full_name,
            transfer_id: transferId,
            reference_number: transferReference,
            reference_value: totalAmount,
            sale_value: 0,
            items: orderItems,
            notes: notes?.trim() || null,
          },
          ...clientInfo,
        })
      }
      return newOrder
    })

    // A stock assignment records delivery, not payment. The database creates a
    // visible waiting-payment job for reseller orders; settlement starts only
    // after a seller-confirmed paid transition.
    const rewardsPending = owner.role === 'reseller'

    return NextResponse.json({
      success:      true,
      message:      isBranchTransfer
        ? `Stock dispatched to ${owner.full_name}. It remains in transit until the Branch confirms the delivery.`
        : `Stock assigned to ${owner.full_name}. ₱${totalAmount.toLocaleString()} recorded.`,
      transaction_type: isBranchTransfer ? 'internal_transfer' : 'sale',
      order,
      total_amount: isBranchTransfer ? 0 : totalAmount,
      reference_value: totalAmount,
      reference_number: transferReference,
      rewards_pending: rewardsPending,
      ...(rewardsPending ? { rewards_warning: PRODUCT_BINARY_WAITING_PAYMENT_WARNING } : {}),
    })
  } catch (error) {
    console.error('[ADMIN INVENTORY POST ERROR]', error)
    if (error instanceof InsufficientStockError) {
      return NextResponse.json(
        { error: 'Insufficient available admin stock. Pending orders may have reserved the remaining quantity.' },
        { status: 409 }
      )
    }
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

    const { items, notes, source_type, source_reference } = await req.json()

    if (!items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'items are required.' }, { status: 400 })

    const sourceType = typeof source_type === 'string' ? source_type.trim() : ''
    const sourceReference = typeof source_reference === 'string' ? source_reference.trim() : ''
    const sourceReferenceKey = sourceReference.replace(/\s+/g, ' ').toUpperCase()
    const receiptNotes = typeof notes === 'string' ? notes.trim() : ''
    if (!['production', 'supplier_purchase', 'approved_adjustment'].includes(sourceType)) {
      return NextResponse.json({ error: 'Select a valid stock source.' }, { status: 400 })
    }
    if (sourceReference.length < 3 || sourceReference.length > 120) {
      return NextResponse.json({ error: 'Source reference must be between 3 and 120 characters.' }, { status: 400 })
    }
    if (receiptNotes.length > 500 || (sourceType === 'approved_adjustment' && receiptNotes.length < 3)) {
      return NextResponse.json({ error: 'Approved adjustments require a reason; notes may not exceed 500 characters.' }, { status: 400 })
    }

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
      select: { id: true, name: true, cost_price: true },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    const actorId = user.actor_id || user.id
    const actorName = user.actor_name || user.full_name
    const totalUnits = normalizedItems.reduce((sum, item) => sum + item.quantity, 0)
    const receiptId = crypto.randomUUID()
    const receiptReference = `STK-${receiptId.slice(0, 8).toUpperCase()}`
    const productMap = new Map(products.map((product) => [product.id, product]))

    await prisma.$transaction(async (tx) => {
      await tx.adminStockReceipt.create({
        data: {
          id: receiptId,
          reference_number: receiptReference,
          source_type: sourceType,
          source_reference: sourceReference,
          source_reference_key: sourceReferenceKey,
          admin_id: user.id,
          received_by_actor_id: actorId,
          total_units: totalUnits,
          notes: receiptNotes || null,
        },
      })
      for (const item of normalizedItems) {
        const inventory = await tx.inventory.upsert({
          where:  { owner_id_product_id: { owner_id: user.id, product_id: item.product_id } },
          update: { quantity: { increment: item.quantity } },
          create: {
            owner_id:            user.id,
            product_id:          item.product_id,
            quantity:            item.quantity,
            low_stock_threshold: 10,
          },
          select: { quantity: true },
        })
        await tx.adminStockReceiptItem.create({
          data: {
            receipt_id: receiptId,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_cost: Number(productMap.get(item.product_id)!.cost_price),
            stock_before: inventory.quantity - item.quantity,
            stock_after: inventory.quantity,
          },
        })
      }
      await createRequiredAuditLog(tx, {
        user_id: actorId,
        user_name: actorName,
        user_role: user.role,
        activity_type: 'admin_stock_received',
        category: 'product',
        description: `Recorded ${totalUnits} unit(s) entering Admin custody from ${sourceType}.`,
        metadata: {
          owner_admin_id: user.id,
          receipt_id: receiptId,
          reference_number: receiptReference,
          source_type: sourceType,
          source_reference: sourceReference,
          total_units: totalUnits,
          items: normalizedItems,
          notes: receiptNotes || null,
        },
        ...getClientInfo(req),
      })
    })

    return NextResponse.json({
      success: true,
      reference_number: receiptReference,
      message: `Stock receipt ${receiptReference} recorded for ${normalizedItems.length} product(s).`,
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'This stock source reference was already recorded.' }, { status: 409 })
    }
    console.error('[ADMIN INVENTORY PUT ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
