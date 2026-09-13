import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getOrderPaymentProofUrl, removeOrderPaymentProof, uploadOrderPaymentProof } from '@/app/lib/orderPaymentProof'

type Context = { params: Promise<{ id: string }> }
class OrderPaymentReviewConflictError extends Error {}

async function participantOrder(id: string, userId: string) {
  return prisma.order.findFirst({
    where: { id, OR: [{ buyer_id: userId }, { seller_id: userId }] },
    include: { payment_evidence: { orderBy: { created_at: 'desc' } } },
  })
}

export async function GET(_req: NextRequest, context: Context) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const order = await participantOrder(id, user.id)
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
  const evidence = await Promise.all(order.payment_evidence.map(async (item) => ({
    id: item.id,
    sender_name: item.sender_name,
    reference_number: item.reference_number,
    amount: item.amount,
    paid_at: item.paid_at,
    status: item.status,
    reviewed_at: item.reviewed_at,
    rejection_reason: item.rejection_reason,
    created_at: item.created_at,
    proof_url: user.id === order.seller_id ? await getOrderPaymentProofUrl(item.proof_path) : null,
  })))
  return NextResponse.json({
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    payment_due_at: order.payment_due_at,
    payment_destination: order.payment_destination_snapshot,
    total_amount: order.total_amount,
    is_buyer: user.id === order.buyer_id,
    evidence,
  })
}

export async function POST(req: NextRequest, context: Context) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const order = await participantOrder(id, user.id)
  if (!order || order.buyer_id !== user.id) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
  if (!['gcash', 'bank_transfer'].includes(order.payment_method || '')) return NextResponse.json({ error: 'This order does not require electronic payment proof.' }, { status: 400 })
  if (order.status !== 'pending' || !['awaiting_payment', 'payment_rejected'].includes(order.payment_status || '')) return NextResponse.json({ error: 'Payment proof cannot be submitted in the current status.' }, { status: 409 })
  if (!order.payment_due_at || order.payment_due_at <= new Date()) return NextResponse.json({ error: 'The payment deadline has passed.' }, { status: 410 })
  const body = await req.json()
  const senderName = typeof body.sender_name === 'string' ? body.sender_name.trim().slice(0, 160) : ''
  const referenceNumber = typeof body.reference_number === 'string' ? body.reference_number.trim().slice(0, 160) : ''
  const amount = Number(body.amount)
  const paidAt = new Date(body.paid_at)
  if (senderName.length < 2 || referenceNumber.length < 3 || !Number.isFinite(amount) || amount !== Number(order.total_amount) || Number.isNaN(paidAt.getTime()) || paidAt > new Date()) {
    return NextResponse.json({ error: 'Provide the sender name, valid reference number, exact order amount, and valid transaction time.' }, { status: 400 })
  }
  if (typeof body.proof_data_url !== 'string') return NextResponse.json({ error: 'Payment proof image is required.' }, { status: 400 })
  const evidenceId = randomUUID()
  let proofPath: string | null = null
  try {
    proofPath = await uploadOrderPaymentProof(user.id, id, evidenceId, body.proof_data_url)
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id, buyer_id: user.id, status: 'pending', payment_status: { in: ['awaiting_payment', 'payment_rejected'] }, payment_due_at: { gt: new Date() } },
        data: { payment_status: 'verification_pending', payment_reference: referenceNumber, payment_sender_name: senderName, payment_evidence_at: new Date(), payment_recorded_by_actor_id: user.id },
      })
      if (claimed.count !== 1) throw new Error('ORDER_PAYMENT_STATE_CHANGED')
      await tx.orderPaymentEvidence.create({ data: { id: evidenceId, order_id: id, submitted_by: user.id, sender_name: senderName, reference_number: referenceNumber, amount, paid_at: paidAt, proof_path: proofPath! } })
      await tx.notification.create({ data: { user_id: order.seller_id, type: 'order_payment_submitted', title: 'Order payment needs verification', message: `${user.full_name} submitted payment proof for ${order.order_number || 'an order'}.`, entity_type: 'order', entity_id: id, action_url: '/dashboard/city/orders' } })
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (proofPath) await removeOrderPaymentProof(proofPath)
    if (error instanceof Error && error.message.includes('Unique constraint')) return NextResponse.json({ error: 'That reference number was already submitted for this order.' }, { status: 409 })
    console.error('[ORDER PAYMENT POST]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to submit payment proof.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await context.params
    const order = await participantOrder(id, user.id)
    if (!order || order.seller_id !== user.id) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    const body = await req.json()
    const action = body.action
    const evidence = order.payment_evidence.find((item) => item.status === 'submitted')
    if (!evidence || order.status !== 'pending' || order.payment_status !== 'verification_pending') {
      return NextResponse.json({ error: 'No submitted proof is awaiting review.' }, { status: 409 })
    }
    if (!['approve', 'reject'].includes(action)) return NextResponse.json({ error: 'Choose approve or reject.' }, { status: 400 })
    const rejectionReason = typeof body.rejection_reason === 'string' ? body.rejection_reason.trim().slice(0, 500) : ''
    if (action === 'reject' && rejectionReason.length < 3) return NextResponse.json({ error: 'A rejection reason is required.' }, { status: 400 })
    const actorId = user.actor_id || user.id
    const reviewed = await prisma.$transaction(async (tx) => {
      const evidenceUpdate = await tx.orderPaymentEvidence.updateMany({
        where: { id: evidence.id, order_id: id, status: 'submitted' },
        data: { status: action === 'approve' ? 'verified' : 'rejected', reviewed_by: actorId, reviewed_at: new Date(), rejection_reason: action === 'reject' ? rejectionReason : null },
      })
      if (evidenceUpdate.count !== 1) return false

      const orderUpdate = await tx.order.updateMany({
        where: { id, seller_id: user.id, status: 'pending', payment_status: 'verification_pending' },
        data: action === 'approve'
          ? { payment_status: 'paid', paid_at: new Date(), payment_verified_by_actor_id: actorId }
          : { payment_status: 'payment_rejected' },
      })
      if (orderUpdate.count !== 1) throw new OrderPaymentReviewConflictError()
      return true
    })
    if (!reviewed) return NextResponse.json({ error: 'Payment evidence was already reviewed.' }, { status: 409 })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof OrderPaymentReviewConflictError) {
      return NextResponse.json({ error: 'The order changed before the payment review completed.' }, { status: 409 })
    }
    console.error('[ORDER PAYMENT PATCH]', error)
    return NextResponse.json({ error: 'Unable to review the payment proof.' }, { status: 500 })
  }
}
