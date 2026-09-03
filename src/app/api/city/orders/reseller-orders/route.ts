import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { createAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import {
  processDeliveredProductBinaryOrder,
  reportPendingProductBinarySettlement,
} from '@/app/lib/productBinary'
import {
  consumeWalkInScanProof,
  InvalidWalkInScanProofError,
  issueWalkInScanProof,
} from '@/app/lib/walkInScanProof'
import { consumeAvailableStock, InsufficientStockError } from '@/app/lib/inventoryReservation'
import { recordInventoryOutEvents } from '@/app/lib/inventoryEvent'

// ── GET resellers under this city distributor ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const search = searchParams.get('search') || ''
    const memberId = searchParams.get('member_id')?.trim().toUpperCase() || ''

    if (memberId) {
      if (!/^HRM-\d{4}-\d{6}$/.test(memberId)) {
        return NextResponse.json({ error: 'Invalid Hiroma Member ID.' }, { status: 400 })
      }
      const reseller = await prisma.user.findFirst({
        where: {
          member_id: memberId,
          role: 'reseller',
          status: 'active',
        },
        select: {
          id: true,
          full_name: true,
          username: true,
          member_id: true,
        },
      })
      if (!reseller) {
        return NextResponse.json({ error: 'Active reseller not found for this Member ID.' }, { status: 404 })
      }
      const proof = await issueWalkInScanProof(prisma, user.id, reseller.id)
      return NextResponse.json({
        reseller,
        scan_proof: proof.token,
        scan_proof_expires_at: proof.expiresAt.toISOString(),
      })
    }

    const resellers = await prisma.user.findMany({
      where: {
        role:       'reseller',
        status:     'active',
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
        member_id: true,
      },
      orderBy: { full_name: 'asc' },
      take: 30,
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

    const { reseller_id, scan_proof, customer_name, notes, cash_received, items } = await req.json()
    const isNonMemberSale = !reseller_id
    if (!items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'Order must have at least one item.' }, { status: 400 })
    if (items.some((item: { product_id?: string; quantity?: number }) =>
      !item.product_id || !Number.isInteger(item.quantity) || Number(item.quantity) <= 0
    )) {
      return NextResponse.json({ error: 'Each order item must have a valid product and positive whole-number quantity.' }, { status: 400 })
    }
    const uniqueProductIds = new Set(items.map((item: { product_id: string }) => item.product_id))
    if (uniqueProductIds.size !== items.length) {
      return NextResponse.json({ error: 'Duplicate products are not allowed in one order.' }, { status: 400 })
    }
    // Validate reseller belongs to this city distributor
    const reseller = reseller_id ? await prisma.user.findFirst({
      where: { id: reseller_id, role: 'reseller', status: 'active' },
      select: { id: true, full_name: true, username: true },
    }) : null

    if (reseller_id && !reseller)
      return NextResponse.json({ error: 'Reseller not found or inactive.' }, { status: 404 })

    // Validate products and check city dist inventory
    const productIds = items.map((i: { product_id: string }) => i.product_id)
    const sellerProfile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true },
    })
    const isBranch = sellerProfile?.dist_level === 'branch'
    const products   = await prisma.product.findMany({
      where:  { id: { in: productIds }, is_active: true },
      select: {
        id: true, name: true, price: true, reseller_price: true,
        cost_price: true, city_price: true, branch_price: true,
      },
    })

    if (products.length !== productIds.length)
      return NextResponse.json({ error: 'One or more products not found.' }, { status: 400 })

    const productMap = new Map(products.map((p) => [p.id, p]))
    let total_amount = 0

    const orderItems = items.map((item: { product_id: string; quantity: number }) => {
      const product    = productMap.get(item.product_id)!
      const unit_price = isNonMemberSale
        ? Number(product.price)
        : Number(product.reseller_price || product.price)
      const unit_acquisition_cost = isBranch
        ? Number(product.branch_price) || Number(product.cost_price)
        : Number(product.city_price) || Number(product.cost_price)
      const subtotal   = unit_price * item.quantity
      total_amount    += subtotal
      return { product_id: item.product_id, quantity: item.quantity, unit_price, unit_acquisition_cost, subtotal }
    })
    const cashReceived = Number(cash_received)
    const totalCents = Math.round(total_amount * 100)
    const cashReceivedCents = Math.round(cashReceived * 100)
    if (!Number.isFinite(cashReceived) || cashReceived < 0 || cashReceivedCents < totalCents) {
      return NextResponse.json({
        error: 'Cash received must be equal to or greater than the order total.',
      }, { status: 400 })
    }
    const changeAmount = (cashReceivedCents - totalCents) / 100

    // Create order with city dist as seller, reseller as buyer
    // Mark as delivered immediately since city dist is handing it over in person
    console.log('[WALK-IN] Creating order for reseller:', reseller_id, 'from city dist:', user.id)
    // ── Validate seller has sufficient inventory for all items ──
    const stockErrors: Array<{ product_id: string; product_name: string; requested: number; available: number; shortage: number }> = []
    for (const item of items) {
      const inventoryItem = await prisma.inventory.findFirst({
        where: { owner_id: user.id, product_id: item.product_id },
        select: { quantity: true, reserved_quantity: true },
      })
      const available = Math.max(0, (inventoryItem?.quantity || 0) - (inventoryItem?.reserved_quantity || 0))
      if (available < item.quantity) {
        const product = productMap.get(item.product_id)
        stockErrors.push({ product_id: item.product_id, product_name: product?.name || 'Selected product', requested: item.quantity, available, shortage: item.quantity - available })
      }
    }
    if (stockErrors.length > 0) {
      return NextResponse.json({
        error: stockErrors.length === 1
          ? `Only ${stockErrors[0].available} unit${stockErrors[0].available === 1 ? '' : 's'} of ${stockErrors[0].product_name} are available. Reduce the cart quantity by ${stockErrors[0].shortage}.`
          : 'Some cart quantities exceed the available stock. Review the highlighted products and reduce their quantities.',
        code: 'INSUFFICIENT_STOCK', stock_errors: stockErrors,
      }, { status: 409 })
    }

    const order = await prisma.$transaction(async (tx) => {
      if (!isNonMemberSale) {
        await consumeWalkInScanProof(tx, String(scan_proof || ''), user.id, reseller_id)
      }
      await consumeAvailableStock(tx, user.id, orderItems)
      const newOrder = await tx.order.create({
        data: {
          buyer_id:          reseller_id || user.id,
          seller_id:         user.id,
          order_type: 'offline',
          status:            'delivered', // immediate — city dist is present
          total_amount,
          delivered_at:      new Date(),
          is_cross_purchase: false,
          is_non_member_sale: isNonMemberSale,
          customer_name:     isNonMemberSale ? String(customer_name || '').trim() || 'Walk-in Customer' : null,
          payment_method:    'cash',
          payment_status:    'paid',
          paid_at:            new Date(),
          payment_reference: `Cash received: ${cashReceived.toFixed(2)}; Change: ${changeAmount.toFixed(2)}`,
          notes:             notes?.trim() || null,
          items:             { create: orderItems },
        },
        select: {
          id: true, order_number: true, status: true, total_amount: true, created_at: true,
          buyer: { select: { full_name: true, username: true } },
        },
      })

      await recordInventoryOutEvents(tx, {
        ownerId: user.id,
        actorId: user.id,
        actorName: user.full_name || user.username || 'City Distributor',
        eventType: isNonMemberSale ? 'non_member_srp_sale' : 'reseller_repeat_order',
        referenceType: 'order',
        referenceId: newOrder.id,
        reason: isNonMemberSale
          ? `Non-member / SRP walk-in sale to ${String(customer_name || '').trim() || 'Walk-in Customer'}`
          : `Reseller repeat order delivered to ${reseller?.full_name || reseller?.username || reseller_id}`,
        items: orderItems.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_cost: item.unit_acquisition_cost })),
        metadata: { order_number: newOrder.order_number, sale_channel: isNonMemberSale ? 'non_member_srp' : 'reseller_repeat_order' },
      })

      // Credit reseller inventory immediately
      for (const item of orderItems) {
        if (!isNonMemberSale) {
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
        }
      }

      return newOrder
    })

    let rewardsPending = false
    let rewardsWarning: string | undefined

    // Trigger product binary points AFTER transaction completes
    // so the order is committed before we check quantities
    if (!isNonMemberSale) try {
      // This idempotent processor exclusively owns Personal PU, rank, and
      // Product Binary pairing from the database-authored paid-order snapshot.
      await processDeliveredProductBinaryOrder(order.id)
    } catch (pointsError) {
      rewardsPending = true
      rewardsWarning = reportPendingProductBinarySettlement(order.id, pointsError, {
        id: user.actor_id || user.id,
        name: user.full_name || user.username,
        role: user.is_staff ? 'staff' : user.role,
      }).rewards_warning
      console.error('[WALK-IN POINTS ERROR]', pointsError)
      // The order remains valid; the durable settlement job retries rewards.
    }

    console.log('[WALK-IN ORDER] Created:', {
      order_id:    order.id,
      buyer_id:    reseller_id || 'non-member',
      seller_id:   user.id,
      total:       order.total_amount,
      status:      order.status,
    })

    const { ip_address, device } = getClientInfo(req)
    createAuditLog({
      user_id: user.actor_id || user.id,
      user_name: user.full_name || user.username,
      user_role: user.is_staff ? 'staff' : user.role,
      member_id: formatMemberId(user.actor_id || user.id, user.is_staff ? 'staff' : user.role),
      activity_type: 'walk_in_order_created',
      category: 'order',
      description: `${isNonMemberSale ? 'Non-member' : 'Reseller'} walk-in order created — ₱${Number(order.total_amount).toFixed(2)}`,
      metadata: {
        order_id: order.id,
        buyer_id: reseller_id || null,
        customer_name: reseller?.full_name || String(customer_name || '').trim() || 'Walk-in Customer',
        pricing: isNonMemberSale ? 'srp' : 'reseller_price',
        payment_method: 'cash',
        payment_status: 'paid',
        cash_received: cashReceived,
        change_amount: changeAmount,
        owner_id: user.id,
        performed_by_staff: Boolean(user.is_staff),
        rewards_pending: rewardsPending,
      },
      ip_address,
      device,
      status: 'completed',
    })

    return NextResponse.json({
      success: true,
      message: `Order created for ${reseller?.full_name || String(customer_name || '').trim() || 'Walk-in Customer'} and marked as delivered.`,
      order,
      payment: {
        status: 'paid',
        cash_received: cashReceived,
        change_amount: changeAmount,
      },
      rewards_pending: rewardsPending,
      ...(rewardsWarning ? { rewards_warning: rewardsWarning } : {}),
    })
  } catch (error) {
    if (error instanceof InvalidWalkInScanProofError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({ error: 'Insufficient available stock. Pending orders may have reserved the remaining quantity.' }, { status: 409 })
    }
    console.error('[CITY RESELLER ORDER POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
