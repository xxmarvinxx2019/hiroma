import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { recordInventoryOutEvents } from '@/app/lib/inventoryEvent'
import { cityOrderListScope } from '@/app/lib/orderSecurity'
import { createAuditLog, formatMemberId } from '@/app/lib/auditLog'
import {
  processDeliveredProductBinaryOrder,
  reportPendingProductBinarySettlement,
  PRODUCT_BINARY_WAITING_PAYMENT_WARNING,
} from '@/app/lib/productBinary'
import { finalizeReservedStock, InsufficientStockError, releaseOrderStock, reserveOrderStock, validateStockItems } from '@/app/lib/inventoryReservation'
import { canUpdateOrderPaymentStatus, isAllowedOrderPaymentStatus } from '@/app/lib/orderPaymentAuthorization'
import { boundedPage, boundedPageSize } from '@/app/lib/pagination'
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
    const page     = boundedPage(searchParams.get('page'))
    const pageSize = boundedPageSize(searchParams.get('pageSize'))

    const isBuyer = tab === 'my_orders'
    const isResellerTab = tab === 'reseller_orders'

    const where: Record<string, unknown> = {
      ...cityOrderListScope(user.id, tab),
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
          is_non_member_sale: true,
          customer_name:     true,
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

    const summary = { total: 0, pending: 0, processing: 0, ready_for_pickup: 0, delivered: 0, cancelled: 0 }
    for (const row of summaryRaw) {
      const count = row._count.status
      summary.total     += count
      if (row.status === 'pending')    summary.pending    = count
      if (row.status === 'processing') summary.processing = count
      if (row.status === 'ready_for_pickup') summary.ready_for_pickup = count
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
    if (!validateStockItems(items)) {
      return NextResponse.json({ error: 'Each item must have a valid product and positive whole-number quantity.' }, { status: 400 })
    }

    if (!['online', 'offline'].includes(order_type)) {
      return NextResponse.json({ error: 'Invalid order type.' }, { status: 400 })
    }

    const supplier = await resolveSupplier(user.id)
    if (!supplier) {
      return NextResponse.json({ error: 'No supplier found. Please contact admin.' }, { status: 400 })
    }

    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const buyerProfile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true },
    })
    const isBranch = buyerProfile?.dist_level === 'branch'
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, is_active: true },
      select: { id: true, name: true, price: true, cost_price: true, city_price: true, branch_price: true },
    })

    if (products.length !== productIds.length) {
      return NextResponse.json({ error: 'One or more products not found or inactive.' }, { status: 400 })
    }

    const productMap = new Map(products.map((p) => [p.id, p]))
    let total_amount = 0

    const orderItems = items.map((item: { product_id: string; quantity: number; unit_price?: number }) => {
      const product    = productMap.get(item.product_id)!
      const configuredPrice = isBranch
        ? Number(product.branch_price) || Number(product.cost_price)
        : Number(product.city_price || product.price)
      const unit_price = configuredPrice
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

    const order = await prisma.$transaction(async (tx) => {
      await reserveOrderStock(tx, supplier.id, items)
      const created = await tx.order.create({ data: {
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
      } })
      const supplierActionUrl = supplier.level === 'Admin'
        ? '/dashboard/admin/orders'
        : supplier.level === 'Regional Distributor'
          ? '/dashboard/regional/orders'
          : '/dashboard/provincial/orders'
      const recipients = supplier.level === 'Admin'
        ? await tx.user.findMany({ where: { role: 'admin' }, select: { id: true } })
        : [{ id: supplier.id }]
      await tx.notification.createMany({ data: recipients.map((recipient) => ({
        user_id: recipient.id,
        type: 'order_pending',
        title: 'New pending order',
        message: `${user.full_name || user.username} placed a City Distributor order worth ₱${total_amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}.`,
        amount: total_amount,
        entity_type: 'order',
        entity_id: created.id,
        action_url: supplierActionUrl,
      })) })
      return created
    })
    createAuditLog({
  user_id:       user.actor_id || user.id,
  user_name:     user.full_name || user.username,
  user_role:     user.is_staff ? 'staff' : user.role,
  member_id:     formatMemberId(user.actor_id || user.id, user.is_staff ? 'staff' : user.role),
  activity_type: 'order_created',
  category:      'order',
  description:   `New order created — ₱${Number(order.total_amount).toFixed(2)}`,
  metadata:      { order_id: order.id, amount: order.total_amount, owner_id: user.id, performed_by_staff: Boolean(user.is_staff) },
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
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({ error: 'Insufficient available stock. Another order may have reserved it.' }, { status: 409 })
    }
    console.error('[CITY ORDERS POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { order_id, status, payment_status } = await req.json()
    const allowed = ['pending', 'processing', 'ready_for_pickup', 'delivered', 'cancelled']

    if (!order_id || (!status && !payment_status)) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    if (status && !allowed.includes(status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }
    if (payment_status && !isAllowedOrderPaymentStatus(payment_status)) {
      return NextResponse.json({ error: 'Invalid payment status.' }, { status: 400 })
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
    if (payment_status && !canUpdateOrderPaymentStatus(user.id, order)) {
      return NextResponse.json({ error: 'Only the seller can confirm payment.' }, { status: 403 })
    }

    // Allow payment_status updates even on finalized orders
    if ((order.status === 'delivered' || order.status === 'cancelled') && status) {
      return NextResponse.json({ error: 'Order is already finalized.' }, { status: 400 })
    }

    if (status && status !== order.status) {
      const validTransitions: Record<string, string[]> = {
        pending: ['processing', 'cancelled'],
        processing: ['ready_for_pickup', 'cancelled'],
        ready_for_pickup: ['delivered', 'cancelled'],
      }
      if (!validTransitions[order.status]?.includes(status)) {
        return NextResponse.json({ error: 'Invalid order status transition.' }, { status: 400 })
      }
    }

    if (status === 'processing' && order.payment_method !== 'cash_on_pickup' && order.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Confirm payment before processing this order.' }, { status: 400 })
    }

    if (order.buyer_id === user.id && order.seller_id !== user.id && status && status !== 'cancelled') {
      return NextResponse.json({ error: 'You can only cancel your own orders.' }, { status: 403 })
    }

    const buyerIsReseller = (await prisma.user.findUnique({
      where: { id: order.buyer_id },
      select: { role: true },
    }))?.role === 'reseller'

    const cashCollectedAtPickup = status === 'delivered'
      && order.payment_method === 'cash_on_pickup'
      && order.payment_status !== 'paid'

    const updated = await prisma.$transaction(async (tx) => {
      if (status) {
        const claimed = await tx.order.updateMany({
          where: { id: order_id, status: order.status },
          data: {
            status,
            ...(payment_status && { payment_status }),
            ...(cashCollectedAtPickup && { payment_status: 'paid' }),
            ...(status === 'delivered' && { delivered_at: new Date() }),
            ...((payment_status === 'paid' || cashCollectedAtPickup) && order.payment_status !== 'paid' && { paid_at: new Date() }),
          },
        })
        if (claimed.count !== 1) throw new Error('ORDER_ALREADY_TRANSITIONED')
      } else {
        await tx.order.update({ where: { id: order_id }, data: {
          ...(payment_status && { payment_status }),
          ...(payment_status === 'paid' && order.payment_status !== 'paid' && { paid_at: new Date() }),
        } })
      }

      if (status === 'delivered') {
        await finalizeReservedStock(tx, order.seller_id, order.items)
        await recordInventoryOutEvents(tx, {
          ownerId: order.seller_id,
          actorId: user.id,
          actorName: user.full_name || user.username || 'City Distributor',
          eventType: order.is_non_member_sale ? 'non_member_srp_sale' : 'reseller_repeat_order',
          referenceType: 'order',
          referenceId: order.id,
          reason: order.is_non_member_sale
            ? `Non-member / SRP order delivered to ${order.customer_name || 'Walk-in Customer'}`
            : `Reseller product order delivered`,
          items: order.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_cost: Number(item.unit_acquisition_cost || 0) })),
          metadata: { order_number: order.order_number, sale_channel: order.is_non_member_sale ? 'non_member_srp' : 'reseller_repeat_order' },
        })
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

        }

      } else if (status === 'cancelled') {
        await releaseOrderStock(tx, order.seller_id, order.items)
      }

      return tx.order.findUniqueOrThrow({ where: { id: order_id } })
    })

    let rewardsPending = false
    let rewardsWarning: string | undefined

    // Run product binary pairing OUTSIDE transaction to avoid timeout
    if (updated.status === 'delivered' && updated.payment_status !== 'paid' && buyerIsReseller) {
      rewardsPending = true
      rewardsWarning = PRODUCT_BINARY_WAITING_PAYMENT_WARNING
    } else if (updated.status === 'delivered' && updated.payment_status === 'paid' && buyerIsReseller) {
      try {
        // The processor consumes immutable job snapshots authored by the
        // database; it never recomputes PU from today's mutable product row.
        await processDeliveredProductBinaryOrder(order.id)
      } catch (e) {
        rewardsPending = true
        rewardsWarning = reportPendingProductBinarySettlement(order.id, e, {
          id: user.id,
          name: user.full_name || user.username,
          role: user.role,
        }).rewards_warning
        console.error('[CITY ORDERS] Product binary pairing error:', e)
      }
    }

    return NextResponse.json({
      success: true,
      order: updated,
      rewards_pending: rewardsPending,
      ...(rewardsWarning ? { rewards_warning: rewardsWarning } : {}),
    })
  } catch (error) {
    console.error('[CITY ORDERS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
