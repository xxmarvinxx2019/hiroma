import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { recommendFulfillmentDistributor } from '@/app/lib/orderSecurity'
import { InsufficientStockError, releaseOrderStock, reserveOrderStock, validateStockItems } from '@/app/lib/inventoryReservation'
// ── GET reseller's orders + their city distributor as supplier ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const status   = searchParams.get('status')   || 'all'
    const type     = searchParams.get('type')     || 'all'
    const search   = searchParams.get('search')   || ''
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    // Get city distributor from reseller profile
    const profile = await prisma.resellerProfile.findUnique({
      where: { user_id: user.id },
      select: {
        city_dist: { select: { id: true, full_name: true, username: true } },
      },
    })

    const where: Record<string, unknown> = {
      buyer_id: user.id,
      ...(status !== 'all' && { status }),
      ...(type   !== 'all' && { order_type: type }),
      ...(search && {
        seller: {
          OR: [
            { full_name: { contains: search, mode: 'insensitive' } },
            { username:  { contains: search, mode: 'insensitive' } },
          ],
        },
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
          id:             true,
          order_number:   true,
          order_type:     true,
          status:         true,
          payment_status: true,
          payment_method: true,
          total_amount:   true,
          created_at:     true,
          notes:          true,
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
        where: { buyer_id: user.id },
        _count: { status: true },
      }),
    ])

    const summary = { total: 0, pending: 0, processing: 0, ready_for_pickup: 0, delivered: 0, cancelled: 0 }
    for (const row of summaryRaw) {
      const count = row._count.status
      summary.total += count
      if (row.status === 'pending')    summary.pending    = count
      if (row.status === 'processing') summary.processing = count
      if (row.status === 'ready_for_pickup') summary.ready_for_pickup = count
      if (row.status === 'delivered')  summary.delivered  = count
      if (row.status === 'cancelled')  summary.cancelled  = count
    }

    return NextResponse.json({
      orders,
      summary,
      supplier: profile?.city_dist || null,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[RESELLER ORDERS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST place a new order to city distributor ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_type, notes, items, payment_method, payment_reference, city_dist_id, delivery_address, delivery_location } = await req.json()

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Order must have at least one item.' }, { status: 400 })
    }

    if (!['online', 'offline'].includes(order_type)) {
      return NextResponse.json({ error: 'Invalid order type.' }, { status: 400 })
    }

    if (!delivery_address || typeof delivery_address !== 'string' || !delivery_address.trim()) {
      return NextResponse.json({ error: 'A delivery address is required.' }, { status: 400 })
    }
    if (!validateStockItems(items)) {
      return NextResponse.json({ error: 'Each item must have a valid product and positive whole-number quantity.' }, { status: 400 })
    }

    // Registration/referral ownership remains in the reseller profile. seller_id below is
    // the fulfillment distributor for this order only.
    const profile = await prisma.resellerProfile.findUnique({
      where:  { user_id: user.id },
      select: {
        city_dist_id: true,
      },
    })
    const activeDistributors = await prisma.user.findMany({
      where: { role: 'city', status: 'active', distributor_profile: { is: { is_active: true, dist_level: 'city' } } },
      select: { id: true, full_name: true, username: true, distributor_profile: { select: { coverage_area: true, region_name: true, province_name: true, city_muni_name: true, barangay_name: true } } },
    })
    const location = delivery_location && typeof delivery_location === 'object' ? delivery_location as Record<string, unknown> : {}
    const recommendation = profile?.city_dist_id ? recommendFulfillmentDistributor(activeDistributors.map((distributor) => ({
      id: distributor.id,
      full_name: distributor.full_name,
      coverage_area: distributor.distributor_profile?.coverage_area,
      region_name: distributor.distributor_profile?.region_name,
      province_name: distributor.distributor_profile?.province_name,
      city_muni_name: distributor.distributor_profile?.city_muni_name,
      barangay_name: distributor.distributor_profile?.barangay_name,
    })), profile.city_dist_id, {
      address: delivery_address.trim(),
      region: typeof location.region === 'string' ? location.region : '',
      province: typeof location.province === 'string' ? location.province : '',
      city: typeof location.city === 'string' ? location.city : '',
      barangay: typeof location.barangay === 'string' ? location.barangay : '',
    }) : null
    const cityDist = activeDistributors.find(({ id }) => id === recommendation?.distributor.id) || null

    if (!cityDist) {
      return NextResponse.json({ error: 'No active distributor is assigned to your account.' }, { status: 400 })
    }
    if (city_dist_id && city_dist_id !== cityDist.id) {
      return NextResponse.json({ error: 'The fulfillment recommendation changed. Refresh the order and try again.' }, { status: 409 })
    }

    // Validate products
    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const sellerProfile = await prisma.distributorProfile.findUnique({
      where: { user_id: cityDist.id },
      select: { dist_level: true },
    })
    const sellerIsBranch = sellerProfile?.dist_level === 'branch'
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, is_active: true },
      select: {
        id: true, name: true, price: true, reseller_price: true,
        cost_price: true, city_price: true, branch_price: true,
      },
    })

    if (products.length !== productIds.length) {
      return NextResponse.json({ error: 'One or more products not found or inactive.' }, { status: 400 })
    }

    const productMap = new Map(products.map((p) => [p.id, p]))

    const inventory = await prisma.inventory.findMany({
      where: { owner_id: cityDist.id, product_id: { in: productIds } },
      select: { product_id: true, quantity: true },
    })
    const stockByProduct = new Map(inventory.map((item) => [item.product_id, item.quantity]))
    const unavailable = items.find((item: { product_id: string; quantity: number }) =>
      !Number.isInteger(item.quantity) || item.quantity < 1 || (stockByProduct.get(item.product_id) || 0) < item.quantity
    )
    if (unavailable) {
      const product = productMap.get(unavailable.product_id)
      return NextResponse.json({
        error: `Insufficient stock for ${product?.name || 'one or more items'} at ${cityDist.full_name}. Please change fulfillment distributor or adjust the quantity.`,
      }, { status: 400 })
    }

    let total_amount = 0

    const orderItems = items.map((item: { product_id: string; quantity: number }) => {
      const product    = productMap.get(item.product_id)!
      const unit_price = Number(product.reseller_price) || Number(product.price)
      const unit_acquisition_cost = sellerIsBranch
        ? Number(product.branch_price) || Number(product.cost_price)
        : Number(product.city_price) || Number(product.cost_price)
      const subtotal   = unit_price * item.quantity
      total_amount    += subtotal
      return { product_id: item.product_id, quantity: item.quantity, unit_price, unit_acquisition_cost, subtotal }
    })

    const order = await prisma.$transaction(async (tx) => {
      await reserveOrderStock(tx, cityDist.id, items)
      return tx.order.create({ data: {
        buyer_id:          user.id,
        seller_id:         cityDist.id,
        order_type,
        status:            'pending',
        total_amount,
        is_cross_purchase: false,
        delivery_address:   delivery_address.trim(),
        notes:             notes?.trim() || null,
        payment_method:      payment_method || 'cash_on_pickup',
        payment_reference:   payment_reference?.trim()   || null,
        payment_status:      'unpaid',
        items:             { create: orderItems },
      },
      select: {
        id: true, status: true, total_amount: true, created_at: true,
        seller: { select: { full_name: true, username: true } },
      } })
    })
    return NextResponse.json({
      success: true,
      message: `Order placed to ${cityDist.full_name}.`,
      order,
    })
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({ error: 'Insufficient available stock. Another order may have reserved the remaining quantity.' }, { status: 409 })
    }
    console.error('[RESELLER ORDERS POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH cancel or mark as paid ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_id, action } = await req.json()
    if (!order_id) {
      return NextResponse.json({ error: 'order_id is required.' }, { status: 400 })
    }

    const order = await prisma.order.findFirst({
      where: { id: order_id, buyer_id: user.id },
      include: { items: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    if (action === 'mark_paid') {
      const updated = await prisma.order.update({
        where: { id: order_id },
        data:  {
          payment_status: 'paid',
          ...(order.payment_status !== 'paid' && { paid_at: new Date() }),
        },
      })
      return NextResponse.json({ success: true, order: updated })
    }

    // Default: cancel
    if (order.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending orders can be cancelled.' }, { status: 400 })
    }

    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: order_id, buyer_id: user.id, status: 'pending' },
        data: { status: 'cancelled' },
      })
      if (claimed.count !== 1) throw new Error('ORDER_ALREADY_TRANSITIONED')
      await releaseOrderStock(tx, order.seller_id, order.items)
      return tx.order.findUniqueOrThrow({ where: { id: order_id } })
    })

    return NextResponse.json({ success: true, order: updated })
  } catch (error) {
    console.error('[RESELLER ORDERS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
