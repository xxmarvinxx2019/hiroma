import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import prisma from '@/app/lib/prisma'
import { notifyPosReviewers } from '@/app/lib/posNotifications'

function canApprove(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return Boolean(user && user.role === 'city' && (!user.is_staff || user.permissions?.includes('pos_approve')))
}

const clean = (value: unknown, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : ''

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const actorId = user.actor_id || user.id
  try {
    const where = canApprove(user)
      ? { owner_id: user.id, status: 'pending' }
      : { owner_id: user.id, requested_by_id: actorId }
    const rows = await prisma.posAdjustmentRequest.findMany({
      where,
      orderBy: { requested_at: 'desc' },
      take: 100,
      include: {
        items: { include: { transaction_item: { select: { product_name_snapshot: true } } } },
        requester: { select: { full_name: true, username: true } },
        reviewer: { select: { full_name: true, username: true } },
        transaction: {
          select: {
            receipt_number: true, transaction_type: true, customer_name_snapshot: true,
            payment_method_snapshot: true, total_snapshot: true, cashier_id: true,
            items: { select: { product_name_snapshot: true, quantity: true } },
          },
        },
      },
    })
    const eligible = canApprove(user) ? [] : await prisma.posTransaction.findMany({
      where: { owner_id: user.id, cashier_id: actorId },
      orderBy: { finalized_at: 'desc' },
      take: 50,
      select: {
        id: true, client_transaction_id: true, receipt_number: true, transaction_type: true, customer_name_snapshot: true,
        payment_method_snapshot: true, payment_reference: true, total_snapshot: true, finalized_at: true, server_received_at: true, status: true,
        adjustment_requests: {
          orderBy: { requested_at: 'desc' },
          select: {
            request_type: true, status: true, reason: true, requested_at: true,
            items: { select: { pos_transaction_item_id: true, quantity: true } },
          },
        },
        items: { select: { id: true, product_name_snapshot: true, quantity: true, unit_price_snapshot: true, subtotal_snapshot: true } },
      },
    })
    return NextResponse.json({
      requests: rows.map((row) => ({
        ...row,
        amount: Number(row.amount_snapshot),
        can_review: canApprove(user) && row.requested_by_id !== actorId,
      })),
      eligible_receipts: eligible.map((row) => ({
        ...row,
        total: Number(row.total_snapshot),
        items: row.items.map((item) => {
          const reserved = row.adjustment_requests
            .filter((request) => request.status === 'pending' || request.status === 'approved')
            .flatMap((request) => request.items)
            .filter((reservedItem) => reservedItem.pos_transaction_item_id === item.id)
            .reduce((sum, reservedItem) => sum + reservedItem.quantity, 0)
          return { ...item, refundable_quantity: Math.max(0, item.quantity - reserved), unit_price: Number(item.unit_price_snapshot), subtotal: Number(item.subtotal_snapshot) }
        }),
      })),
      access: { can_approve: canApprove(user) },
    })
  } catch (error) {
    console.error('[POS ADJUSTMENT LIST]', error)
    return NextResponse.json({ error: 'Unable to load POS void and refund requests.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const actorId = user.actor_id || user.id
  try {
    const body = await req.json()
    const transactionId = clean(body.transaction_id, 80)
    const requestType = body.request_type === 'void' ? 'void' : body.request_type === 'refund' ? 'refund' : ''
    const reason = clean(body.reason)
    const requestedItems = Array.isArray(body.items) ? body.items.map((row: Record<string, unknown>) => ({
      item_id: clean(row.item_id, 80),
      quantity: Number(row.quantity),
      disposition: ['resellable', 'damaged', 'expired'].includes(String(row.disposition)) ? String(row.disposition) : '',
    })) : []
    if (!transactionId || !requestType || reason.length < 10) return NextResponse.json({ error: 'Choose Void or Refund and enter a clear reason of at least 10 characters.' }, { status: 400 })
    if (requestType === 'refund' && (!requestedItems.length || requestedItems.some((row: { item_id: string; quantity: number; disposition: string }) => !row.item_id || !Number.isInteger(row.quantity) || row.quantity < 1 || !row.disposition))) {
      return NextResponse.json({ error: 'Select at least one product, a valid quantity, and its return condition.' }, { status: 400 })
    }

    const created = await prisma.$transaction(async (tx) => {
      const transaction = await tx.posTransaction.findFirst({
        where: { id: transactionId, owner_id: user.id, cashier_id: actorId, status: 'finalized' },
        include: {
          items: true,
          adjustment_requests: {
            where: { status: { in: ['pending', 'approved'] }, request_type: 'refund' },
            include: { items: true },
          },
        },
      })
      if (!transaction) throw new Error('POS_RECEIPT_NOT_ADJUSTABLE')
      if (transaction.transaction_type !== 'non_member_sale') throw new Error('POS_MEMBER_REVERSAL_LOCKED')
      if (requestType === 'void' && transaction.adjustment_requests.length) throw new Error('POS_RECEIPT_ALREADY_PARTIALLY_REFUNDED')

      const itemById = new Map(transaction.items.map((item) => [item.id, item]))
      const reserved = new Map<string, number>()
      for (const request of transaction.adjustment_requests) for (const item of request.items) {
        reserved.set(item.pos_transaction_item_id, (reserved.get(item.pos_transaction_item_id) || 0) + item.quantity)
      }
      const normalized = requestType === 'refund' ? requestedItems.map((row: { item_id: string; quantity: number; disposition: string }) => {
        const item = itemById.get(row.item_id)
        if (!item || row.quantity > item.quantity - (reserved.get(item.id) || 0)) throw new Error('POS_REFUND_QUANTITY_EXCEEDED')
        return { item, quantity: row.quantity, disposition: row.disposition }
      }) : []
      if (new Set(normalized.map((row) => row.item.id)).size !== normalized.length) throw new Error('POS_DUPLICATE_REFUND_ITEM')
      const amount = requestType === 'void'
        ? Number(transaction.total_snapshot)
        : normalized.reduce((sum, row) => sum + Number(row.item.unit_price_snapshot) * row.quantity, 0)

      const request = await tx.posAdjustmentRequest.create({
        data: {
          owner_id: user.id,
          pos_transaction_id: transaction.id,
          requested_by_id: actorId,
          request_type: requestType,
          reason,
          amount_snapshot: amount,
          items: requestType === 'refund' ? { create: normalized.map((row) => ({
            pos_transaction_item_id: row.item.id,
            quantity: row.quantity,
            disposition: row.disposition,
            unit_price_snapshot: row.item.unit_price_snapshot,
            subtotal_snapshot: Number(row.item.unit_price_snapshot) * row.quantity,
          })) } : undefined,
        },
        select: { id: true, status: true },
      })
      return { request, transaction }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 })

    const client = getClientInfo(req)
    await createRequiredAuditLog(prisma, {
      user_id: actorId, user_name: user.actor_name || user.full_name || user.username,
      user_role: user.is_staff ? 'staff' : user.role, member_id: formatMemberId(actorId, user.is_staff ? 'staff' : user.role),
      activity_type: 'pos_adjustment_requested', category: 'order',
      description: `${requestType === 'void' ? 'Void' : 'Refund'} requested for ${created.transaction.receipt_number}.`,
      metadata: { pos_transaction_id: created.transaction.id, request_id: created.request.id, request_type: requestType, reason, items: requestedItems },
      ...client, status: 'under_review',
    })
    await notifyPosReviewers({
      ownerId: user.id, actorId, permission: 'pos_approve', type: 'pos_adjustment_pending',
      title: `${requestType === 'void' ? 'Void' : 'Refund'} request needs review`,
      message: `Receipt ${created.transaction.receipt_number} has a ${requestType} request waiting for an independent decision.`,
      entityType: 'pos_adjustment_request', entityId: created.request.id, actionUrl: '/dashboard/city/pos/adjustments',
    })
    return NextResponse.json({ request: created.request }, { status: 201 })
  } catch (error) {
    console.error('[POS ADJUSTMENT REQUEST]', error)
    const code = error instanceof Error ? error.message : ''
    if (code === 'POS_MEMBER_REVERSAL_LOCKED') return NextResponse.json({ error: 'Member and reseller sales remain final and cannot be refunded.' }, { status: 409 })
    if (code === 'POS_RECEIPT_NOT_ADJUSTABLE') return NextResponse.json({ error: 'Only your own finalized POS receipt can be submitted for adjustment.' }, { status: 404 })
    if (code === 'POS_REFUND_QUANTITY_EXCEEDED' || code === 'POS_DUPLICATE_REFUND_ITEM') return NextResponse.json({ error: 'A selected quantity is unavailable because it exceeds the purchased or already-requested quantity.' }, { status: 409 })
    if (code === 'POS_RECEIPT_ALREADY_PARTIALLY_REFUNDED') return NextResponse.json({ error: 'A receipt with a partial refund cannot be fully voided.' }, { status: 409 })
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return NextResponse.json({ error: 'Another refund changed this receipt. Refresh and try again.' }, { status: 409 })
    return NextResponse.json({ error: 'Unable to submit this void or refund request safely.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || !canApprove(user)) return NextResponse.json({ error: 'You are not authorized to review POS adjustments.' }, { status: 403 })
  const actorId = user.actor_id || user.id
  try {
    const body = await req.json()
    const requestId = clean(body.request_id, 80)
    const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : ''
    const notes = clean(body.notes)
    if (!requestId || !action || notes.length < 5) return NextResponse.json({ error: 'Enter a review note of at least 5 characters before deciding.' }, { status: 400 })

    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.posAdjustmentRequest.findFirst({
        where: { id: requestId, owner_id: user.id, status: 'pending' },
        include: { items: { include: { transaction_item: true } }, transaction: { include: { items: true, order: { select: { id: true } } } } },
      })
      if (!request || !request.transaction.order) throw new Error('POS_ADJUSTMENT_NOT_PENDING')
      if (request.requested_by_id === actorId) throw new Error('POS_SELF_APPROVAL')
      if (request.transaction.transaction_type !== 'non_member_sale') throw new Error('POS_MEMBER_REVERSAL_LOCKED')

      const claimed = await tx.posAdjustmentRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: { status: action === 'approve' ? 'approved' : 'rejected', reviewed_by_id: actorId, reviewed_at: new Date(), review_notes: notes },
      })
      if (claimed.count !== 1) throw new Error('POS_ADJUSTMENT_NOT_PENDING')

      if (action === 'approve') {
        if (request.transaction.status !== 'finalized') throw new Error('POS_TRANSACTION_NOT_ADJUSTABLE')
        const returned = request.request_type === 'void'
          ? request.transaction.items.map((item) => ({ transaction_item: item, quantity: item.quantity, disposition: 'resellable' }))
          : request.items
        for (const row of returned) {
          const item = row.transaction_item
          const before = await tx.inventory.findUniqueOrThrow({ where: { owner_id_product_id: { owner_id: user.id, product_id: item.product_id } }, select: { quantity: true } })
          const restock = row.disposition === 'resellable' ? row.quantity : 0
          const after = restock ? await tx.inventory.update({ where: { owner_id_product_id: { owner_id: user.id, product_id: item.product_id } }, data: { quantity: { increment: restock } }, select: { quantity: true } }) : before
          await tx.inventoryAuditEvent.create({ data: {
            owner_id: user.id, product_id: item.product_id, actor_id: actorId,
            actor_name_snapshot: user.actor_name || user.full_name || user.username,
            event_type: request.request_type === 'void' ? 'pos_void_return' : `pos_refund_${row.disposition}`,
            quantity_delta: restock, quantity_before: before.quantity, quantity_after: after.quantity,
            unit_cost_snapshot: item.unit_cost_snapshot, total_value: Number(item.unit_cost_snapshot) * row.quantity,
            reference_type: 'order', reference_id: request.transaction.order.id,
            reason: `${request.request_type === 'void' ? 'Voided' : 'Refunded'} ${request.transaction.receipt_number}: ${notes}`,
            metadata: { pos_transaction_id: request.transaction.id, adjustment_request_id: request.id, original_receipt: request.transaction.receipt_number, refunded_quantity: row.quantity, disposition: row.disposition },
          } })
        }
        const fullyReversed = request.request_type === 'void' || (await Promise.all(request.transaction.items.map(async (item) => {
          const approved = await tx.posAdjustmentItem.aggregate({
            where: { pos_transaction_item_id: item.id, request: { request_type: 'refund', status: 'approved' } },
            _sum: { quantity: true },
          })
          return Number(approved._sum.quantity || 0) >= item.quantity
        }))).every(Boolean)
        if (fullyReversed) {
          await tx.posTransaction.update({ where: { id: request.transaction.id }, data: { status: request.request_type === 'void' ? 'voided' : 'refunded', reviewed_by_id: actorId, reviewed_at: new Date(), review_notes: notes } })
          await tx.order.update({ where: { id: request.transaction.order.id }, data: { status: 'cancelled', payment_status: request.request_type === 'void' ? 'voided' : 'refunded' } })
        }
      }

      await tx.posSyncEvent.create({
        data: {
          terminal_id: request.transaction.terminal_id, pos_transaction_id: request.transaction.id,
          event_type: action === 'approve' ? `adjustment_${request.request_type}_approved` : 'adjustment_rejected',
          outcome: 'success', details: { request_id: request.id, reviewer_id: actorId, notes },
        },
      })
      const client = getClientInfo(req)
      await createRequiredAuditLog(tx, {
        user_id: actorId, user_name: user.actor_name || user.full_name || user.username,
        user_role: user.is_staff ? 'staff' : user.role, member_id: formatMemberId(actorId, user.is_staff ? 'staff' : user.role),
        activity_type: action === 'approve' ? 'pos_adjustment_approved' : 'pos_adjustment_rejected', category: 'order',
        description: `${request.transaction.receipt_number} ${request.request_type} request ${action === 'approve' ? 'approved' : 'rejected'}.`,
        metadata: { request_id: request.id, pos_transaction_id: request.transaction.id, requester_id: request.requested_by_id, reviewer_id: actorId, notes },
        ...client, status: 'completed',
      })
      return { status: action === 'approve' ? 'approved' : 'rejected', receipt: request.transaction.receipt_number }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[POS ADJUSTMENT REVIEW]', error)
    const code = error instanceof Error ? error.message : ''
    if (code === 'POS_SELF_APPROVAL') return NextResponse.json({ error: 'Maker–approver control: a different authorized account must review this request.' }, { status: 403 })
    if (code === 'POS_ADJUSTMENT_NOT_PENDING' || code === 'POS_TRANSACTION_NOT_ADJUSTABLE') return NextResponse.json({ error: 'This request is no longer pending or the receipt was already adjusted.' }, { status: 409 })
    if (code === 'POS_MEMBER_REVERSAL_LOCKED') return NextResponse.json({ error: 'Hiroma policy: member and reseller sales are not eligible for void or refund because rewards and financial credits must remain final.' }, { status: 409 })
    return NextResponse.json({ error: 'Unable to save the void or refund decision safely.' }, { status: 500 })
  }
}
