import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import { recordInventoryOutEvents } from '@/app/lib/inventoryEvent'
import { processDeliveredProductBinaryOrder } from '@/app/lib/productBinary'
import prisma from '@/app/lib/prisma'

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
    const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : ''
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : ''
    if (!transactionId || !action || (action === 'reject' && notes.length < 5)) {
      return NextResponse.json({ error: action === 'reject' ? 'Enter a clear rejection reason of at least 5 characters.' : 'Select a valid payment decision.' }, { status: 400 })
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
        data: { status: action === 'approve' ? 'approved' : 'rejected', reviewed_by_id: actorId, reviewed_at: new Date(), review_notes: notes || null },
      })
      if (claimed.count !== 1) throw new Error('POS_APPROVAL_NOT_PENDING')

      if (action === 'reject') {
        for (const item of transaction.items) {
          await tx.inventory.update({
            where: { owner_id_product_id: { owner_id: user.id, product_id: item.product_id } },
            data: { quantity: { increment: item.quantity } },
          })
        }
        await tx.order.update({ where: { id: transaction.order.id }, data: { status: 'cancelled', payment_status: 'rejected' } })
      } else {
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

      await tx.posSyncEvent.create({
        data: { terminal_id: transaction.terminal_id, pos_transaction_id: transaction.id, event_type: action === 'approve' ? 'payment_approved' : 'payment_rejected', outcome: 'success', details: { reviewer_id: actorId, notes: notes || null } },
      })
      const client = getClientInfo(req)
      await createRequiredAuditLog(tx, {
        user_id: actorId,
        user_name: user.actor_name || user.full_name || user.username,
        user_role: user.is_staff ? 'staff' : user.role,
        member_id: formatMemberId(actorId, user.is_staff ? 'staff' : user.role),
        activity_type: action === 'approve' ? 'pos_payment_approved' : 'pos_payment_rejected',
        category: 'order',
        description: `${transaction.receipt_number} payment ${action === 'approve' ? 'approved' : 'rejected'} by an independent reviewer.`,
        metadata: { pos_transaction_id: transaction.id, order_id: transaction.order.id, cashier_id: transaction.cashier_id, reviewer_id: actorId, notes: notes || null },
        ...client,
        status: 'completed',
      })
      return { orderId: transaction.order.id, memberSale: transaction.transaction_type === 'member_sale', status: action === 'approve' ? 'approved' : 'rejected' }
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
    if (code === 'POS_SELF_APPROVAL') return NextResponse.json({ error: 'Maker–approver control: you cannot approve or reject a payment that you recorded.' }, { status: 403 })
    if (code === 'POS_APPROVAL_NOT_PENDING') return NextResponse.json({ error: 'This payment is no longer pending review. Refresh the approval list.' }, { status: 409 })
    return NextResponse.json({ error: 'The payment decision could not be saved safely.' }, { status: 500 })
  }
}
