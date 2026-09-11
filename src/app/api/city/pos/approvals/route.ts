import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import { buildOrderCancellationEvidence } from '@/app/lib/orderCancellation'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import { recordInventoryOutEvents } from '@/app/lib/inventoryEvent'
import { processDeliveredProductBinaryOrder } from '@/app/lib/productBinary'
import prisma from '@/app/lib/prisma'
import { notifyPosReviewers } from '@/app/lib/posNotifications'

function authorized(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return Boolean(user && user.role === 'city' && (!user.is_staff || user.permissions?.includes('pos_approve')))
}

export async function GET() {
  const user = await getCurrentUser()
  if (!authorized(user) || !user) return NextResponse.json({ error: 'You are not authorized to review POS payments.' }, { status: 403 })
  try {
    const rows = await prisma.posTransaction.findMany({
      where: { owner_id: user.id, status: 'synced_pending_review' },
      orderBy: { server_received_at: 'asc' },
      select: {
        id: true,
        receipt_number: true,
        transaction_type: true,
        customer_name_snapshot: true,
        payment_method_snapshot: true,
        payment_reference: true,
        total_snapshot: true,
        server_received_at: true,
        cashier_id: true,
        cashier: { select: { full_name: true, username: true } },
        items: { select: { product_name_snapshot: true, quantity: true, subtotal_snapshot: true } },
      },
    })
    return NextResponse.json({
      approvals: rows.map((row) => ({
        ...row,
        total: Number(row.total_snapshot),
        items: row.items.map((item) => ({ ...item, subtotal: Number(item.subtotal_snapshot) })),
        can_review: (user.actor_id || user.id) !== row.cashier_id,
      })),
    })
  } catch (error) {
    console.error('[POS APPROVAL LIST]', error)
    return NextResponse.json({ error: 'Unable to load pending POS payments.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!authorized(user) || !user) return NextResponse.json({ error: 'You are not authorized to review POS payments.' }, { status: 403 })
  const actorId = user.actor_id || user.id
  try {
    const body = await req.json()
    const transactionId = typeof body.transaction_id === 'string' ? body.transaction_id : ''
    const action = body.action === 'approve' ? 'approve' : body.action === 'needs_correction' ? 'needs_correction' : body.action === 'reject' ? 'reject' : ''
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : ''
    if (!transactionId || !action || (action !== 'approve' && notes.length < 5)) {
      return NextResponse.json({ error: action !== 'approve' ? 'Enter a clear correction or rejection reason of at least 5 characters.' : 'Select a valid payment decision.' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.posTransaction.findFirst({
        where: { id: transactionId, owner_id: user.id, status: 'synced_pending_review' },
        include: {
          order: { select: { id: true, order_number: true } },
          member: { select: { id: true, full_name: true, username: true } },
          items: true,
        },
      })
      if (!transaction || !transaction.order) throw new Error('POS_APPROVAL_NOT_PENDING')
      if (transaction.cashier_id === actorId) throw new Error('POS_SELF_APPROVAL')

      const claimed = await tx.posTransaction.updateMany({
        where: { id: transaction.id, status: 'synced_pending_review' },
        data: { status: action === 'approve' ? 'approved' : action === 'needs_correction' ? 'needs_correction' : 'rejected', reviewed_by_id: actorId, reviewed_at: new Date(), review_notes: notes || null },
      })
      if (claimed.count !== 1) throw new Error('POS_APPROVAL_NOT_PENDING')

      if (action === 'reject') {
        for (const item of transaction.items) {
          await tx.inventory.update({
            where: { owner_id_product_id: { owner_id: user.id, product_id: item.product_id } },
            data: { quantity: { increment: item.quantity } },
          })
        }
        await tx.order.update({ where: { id: transaction.order.id }, data: { status: 'cancelled', payment_status: 'rejected', ...buildOrderCancellationEvidence(user, notes, user.is_staff ? 'outlet_staff' : 'outlet') } })
      } else if (action === 'approve') {
        await tx.order.update({ where: { id: transaction.order.id }, data: { status: 'delivered', payment_status: 'paid', paid_at: new Date(), delivered_at: new Date() } })
        await recordInventoryOutEvents(tx, {
          ownerId: user.id,
          actorId,
          actorName: user.actor_name || user.full_name || user.username,
          eventType: transaction.transaction_type === 'member_sale' ? 'pos_member_sale' : 'pos_non_member_sale',
          referenceType: 'order',
          referenceId: transaction.order.id,
          reason: `Approved POS payment for ${transaction.customer_name_snapshot || 'Walk-in Customer'}`,
          items: transaction.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_cost: Number(item.unit_cost_snapshot) })),
          metadata: { pos_transaction_id: transaction.id, receipt_number: transaction.receipt_number, approver_id: actorId },
        })
        if (transaction.member) {
          for (const item of transaction.items) {
            await tx.inventory.upsert({
              where: { owner_id_product_id: { owner_id: transaction.member.id, product_id: item.product_id } },
              update: { quantity: { increment: item.quantity } },
              create: { owner_id: transaction.member.id, product_id: item.product_id, quantity: item.quantity, low_stock_threshold: 5 },
            })
          }
        }
        await tx.posTransaction.update({ where: { id: transaction.id }, data: { status: 'finalized', finalized_at: new Date() } })
      }

      if (action === 'needs_correction') {
        await tx.notification.create({ data: { user_id: transaction.cashier_id, type: 'pos_payment_needs_correction', title: 'POS payment returned for correction', message: `${transaction.receipt_number}. Manager note: ${notes}`, entity_type: 'pos_transaction', entity_id: transaction.id, action_url: '/dashboard/city/pos/adjustments' } })
      }
      await tx.posSyncEvent.create({
        data: { terminal_id: transaction.terminal_id, pos_transaction_id: transaction.id, event_type: action === 'approve' ? 'payment_approved' : action === 'needs_correction' ? 'payment_returned_for_correction' : 'payment_rejected', outcome: 'success', details: { reviewer_id: actorId, notes: notes || null } },
      })
      const client = getClientInfo(req)
      await createRequiredAuditLog(tx, {
        user_id: actorId,
        user_name: user.actor_name || user.full_name || user.username,
        user_role: user.is_staff ? 'staff' : user.role,
        member_id: formatMemberId(actorId, user.is_staff ? 'staff' : user.role),
        activity_type: action === 'approve' ? 'pos_payment_approved' : action === 'needs_correction' ? 'pos_payment_returned_for_correction' : 'pos_payment_rejected',
        category: 'order',
        description: `${transaction.receipt_number} payment ${action === 'approve' ? 'approved' : action === 'needs_correction' ? 'returned for correction' : 'rejected'} by an independent reviewer.`,
        metadata: { pos_transaction_id: transaction.id, order_id: transaction.order.id, cashier_id: transaction.cashier_id, reviewer_id: actorId, notes: notes || null },
        ...client,
        status: 'completed',
      })
      return { orderId: transaction.order.id, memberSale: transaction.transaction_type === 'member_sale', status: action === 'approve' ? 'approved' : action === 'needs_correction' ? 'needs_correction' : 'rejected' }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 })

    let rewardsPending = false
    if (result.status === 'approved' && result.memberSale) {
      try {
        await processDeliveredProductBinaryOrder(result.orderId)
      } catch (error) {
        rewardsPending = true
        console.error('[POS APPROVAL PRODUCT BINARY]', error)
      }
    }
    return NextResponse.json({ success: true, status: result.status, rewards_pending: rewardsPending })
  } catch (error) {
    console.error('[POS PAYMENT APPROVAL]', error)
    const code = error instanceof Error ? error.message : ''
    if (code === 'POS_SELF_APPROVAL') return NextResponse.json({ error: 'Maker–approver control: you cannot review a payment that you recorded.' }, { status: 403 })
    if (code === 'POS_APPROVAL_NOT_PENDING') return NextResponse.json({ error: 'This payment is no longer pending review. Refresh the approval list.' }, { status: 409 })
    return NextResponse.json({ error: 'The payment decision could not be saved safely.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const actorId = user.actor_id || user.id

  try {
    const body = await req.json()
    const transactionId = typeof body.transaction_id === 'string' ? body.transaction_id.trim().slice(0, 80) : ''
    const paymentReference = typeof body.payment_reference === 'string' ? body.payment_reference.trim().slice(0, 160) : ''
    if (!transactionId || paymentReference.length < 3) {
      return NextResponse.json({ error: 'Enter the corrected payment reference (at least 3 characters).' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.posTransaction.findFirst({
        where: { id: transactionId, owner_id: user.id, cashier_id: actorId, status: 'needs_correction' },
        select: { id: true, receipt_number: true, terminal_id: true, order_id: true, payment_method_id: true },
      })
      if (!transaction || !transaction.order_id || !transaction.payment_method_id) throw new Error('POS_CORRECTION_NOT_AVAILABLE')

      const claimed = await tx.posTransaction.updateMany({
        where: { id: transaction.id, status: 'needs_correction' },
        data: {
          status: 'pending_sync',
          payment_reference: paymentReference,
          reviewed_by_id: null,
          reviewed_at: null,
          review_notes: null,
        },
      })
      if (claimed.count !== 1) throw new Error('POS_CORRECTION_NOT_AVAILABLE')

      await tx.order.update({
        where: { id: transaction.order_id },
        data: { payment_reference: paymentReference, payment_status: 'pending_verification' },
      })
      await tx.posTransaction.update({
        where: { id: transaction.id },
        data: { status: 'synced_pending_review', server_received_at: new Date() },
      })
      await tx.posSyncEvent.create({
        data: {
          terminal_id: transaction.terminal_id,
          pos_transaction_id: transaction.id,
          event_type: 'payment_correction_resubmitted',
          outcome: 'success',
          details: { cashier_id: actorId },
        },
      })
      const client = getClientInfo(req)
      await createRequiredAuditLog(tx, {
        user_id: actorId,
        user_name: user.actor_name || user.full_name || user.username,
        user_role: user.is_staff ? 'staff' : user.role,
        member_id: formatMemberId(actorId, user.is_staff ? 'staff' : user.role),
        activity_type: 'pos_payment_correction_resubmitted',
        category: 'order',
        description: `${transaction.receipt_number} payment reference was corrected and resubmitted for independent review.`,
        metadata: { pos_transaction_id: transaction.id, order_id: transaction.order_id, cashier_id: actorId },
        ...client,
        status: 'completed',
      })
      return transaction
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 })

    await notifyPosReviewers({
      ownerId: user.id,
      actorId,
      permission: 'pos_approve',
      type: 'pos_payment_correction_resubmitted',
      title: 'Corrected POS payment needs review',
      message: `${result.receipt_number} was corrected by the cashier and resubmitted for independent review.`,
      entityType: 'pos_transaction',
      entityId: result.id,
      actionUrl: '/dashboard/city/pos/approvals',
    })
    return NextResponse.json({ success: true, status: 'synced_pending_review' })
  } catch (error) {
    console.error('[POS PAYMENT CORRECTION]', error)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'That payment reference is already used. Check the official receipt and enter the correct unique reference.' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'POS_CORRECTION_NOT_AVAILABLE') {
      return NextResponse.json({ error: 'This payment is no longer waiting for your correction. Refresh the receipt list.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'The corrected payment could not be resubmitted safely.' }, { status: 500 })
  }
}
