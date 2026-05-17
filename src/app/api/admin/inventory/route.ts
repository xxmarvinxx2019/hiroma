import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const PRICE_FIELD: Record<string, 'regional_price' | 'provincial_price' | 'city_price'> = {
  regional:   'regional_price',
  provincial: 'provincial_price',
  city:       'city_price',
}

// ── GET ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const owner_id     = searchParams.get('owner_id')    || ''
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
      owner: { role: { in: ['regional', 'provincial', 'city'] } },
      ...(owner_id && { owner_id }),
      ...(Object.keys(productFilter).length > 0 && { product: productFilter }),
    }

    const [total, items, distributors, adminRevenue, adminTotalOrders] = await Promise.all([
      prisma.inventory.count({ where }),
      prisma.inventory.findMany({
        where,
        orderBy: { updated_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, quantity: true, low_stock_threshold: true, updated_at: true,
          owner:   { select: { id: true, full_name: true, username: true, role: true } },
          product: {
            select: {
              id: true, name: true, type: true,
              regional_price: true, provincial_price: true, city_price: true,
            },
          },
        },
      }),
      prisma.user.findMany({
        where:   { role: { in: ['regional', 'provincial', 'city'] }, status: 'active' },
        select:  { id: true, full_name: true, username: true, role: true },
        orderBy: { role: 'asc' },
      }),
      prisma.order.aggregate({
        where: { seller_id: user.id, status: 'delivered' },
        _sum:  { total_amount: true },
      }),
      prisma.order.count({ where: { seller_id: user.id } }),
    ])

    // ── All products with how many units distributed ──
    const allInventory = await prisma.inventory.findMany({
      where:  { owner: { role: { in: ['regional', 'provincial', 'city'] } } },
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
          city_price: true, reseller_price: true,
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

    // ── Admin's own stock (what admin has in hand) ──
    const adminOwnStock = await prisma.inventory.findMany({
      where:  { owner_id: user.id },
      select: { product_id: true, quantity: true },
    })
    const adminStockMap = new Map(adminOwnStock.map((i) => [i.product_id, i.quantity]))

    // Merge admin stock into product summary
    const productStockSummaryWithAdmin = productStockSummary.map((p) => ({
      ...p,
      admin_stock: adminStockMap.get(p.id) ?? 0,
    }))

    return NextResponse.json({
      items,
      distributors,
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
      where:  { id: owner_id, role: { in: ['regional', 'provincial', 'city'] }, status: 'active' },
      select: { id: true, full_name: true, role: true },
    })
    if (!owner) return NextResponse.json({ error: 'Distributor not found.' }, { status: 404 })

    const priceField = PRICE_FIELD[owner.role]
    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const products   = await prisma.product.findMany({
      where:  { id: { in: productIds }, is_active: true },
      select: {
        id: true, name: true,
        regional_price: true, provincial_price: true, city_price: true,
      },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    // ── Validate admin has enough stock ──
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
      const unitPrice = Number(product[priceField])
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
        // Credit distributor inventory
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

        // Deduct from admin's own stock
        await tx.inventory.updateMany({
          where: { owner_id: user.id, product_id: item.product_id },
          data:  { quantity: { decrement: item.quantity } },
        })
      }

      return newOrder
    })

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
    // items: [{ product_id, quantity }]

    if (!items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'items are required.' }, { status: 400 })

    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const products   = await prisma.product.findMany({
      where:  { id: { in: productIds }, is_active: true },
      select: { id: true, name: true },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    // Upsert admin's own inventory for each product
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