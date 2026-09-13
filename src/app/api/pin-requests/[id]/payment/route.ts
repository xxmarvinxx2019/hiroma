import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'
import {
  getPinRequestPaymentProofUrl,
  removePinRequestPaymentProof,
  uploadPinRequestPaymentProof,
} from '@/app/lib/pinRequestPaymentProof'
import { notifyActiveAdmins } from '@/app/lib/adminRequestNotifications'

type Context = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Context) {
  const user = await getCurrentUser()
  if (!user || !['admin', 'city'].includes(user.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const request = await prisma.pinRequest.findFirst({
    where: { id, ...(user.role === 'city' && { city_dist_id: user.id }) },
    select: {
      id: true, city_dist_id: true, payment_due_at: true, payment_status: true,
      payment_destination_snapshot: true,
      payment_evidence: {
        orderBy: { created_at: 'desc' },
        select: { id: true, sender_name: true, reference_number: true, paid_at: true, status: true, reviewed_at: true, review_notes: true, proof_path: true, created_at: true },
      },
    },
  })
  if (!request) return NextResponse.json({ error: 'PIN request not found.' }, { status: 404 })
  const evidence = await Promise.all(request.payment_evidence.map(async ({ proof_path, ...item }) => ({
    ...item,
    proof_url: await getPinRequestPaymentProofUrl(proof_path),
  })))
  return NextResponse.json({ request: { ...request, payment_evidence: evidence } })
}

export async function POST(req: NextRequest, { params }: Context) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  let uploadedPath: string | null = null
  try {
    const body = await req.json()
    const senderName = typeof body.sender_name === 'string' ? body.sender_name.trim().slice(0, 160) : ''
    const referenceNumber = typeof body.reference_number === 'string' ? body.reference_number.trim().slice(0, 160) : ''
    const paidAt = body.paid_at ? new Date(body.paid_at) : null
    const proofData = typeof body.proof_data === 'string' ? body.proof_data : ''
    if (senderName.length < 2 || referenceNumber.length < 3 || !paidAt || Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 5 * 60 * 1000 || !proofData) {
      return NextResponse.json({ error: 'Enter valid sender, reference, payment time, and payment proof.' }, { status: 400 })
    }
    const request = await prisma.pinRequest.findFirst({
      where: { id, city_dist_id: user.id },
      select: { id: true, status: true, created_at: true, payment_status: true, payment_due_at: true, payment_method_id: true, payment_destination_snapshot: true },
    })
    if (!request || request.status !== 'pending') return NextResponse.json({ error: 'PIN request is not open for payment.' }, { status: 409 })
    if (!request.payment_due_at || new Date() >= request.payment_due_at) {
      await prisma.pinRequest.updateMany({ where: { id, status: 'pending' }, data: { status: 'expired', payment_status: 'expired' } })
      return NextResponse.json({ error: 'The 48-hour payment window has expired.' }, { status: 410 })
    }
    if (paidAt < request.created_at || paidAt > request.payment_due_at) {
      return NextResponse.json({ error: 'Payment time must fall within this request’s 48-hour payment window.' }, { status: 400 })
    }
    if (!['awaiting_payment', 'payment_rejected'].includes(request.payment_status) || !request.payment_method_id) {
      return NextResponse.json({ error: 'Payment evidence has already been submitted.' }, { status: 409 })
    }
    const destination = request.payment_destination_snapshot as Record<string, unknown> | null
    if (!destination) return NextResponse.json({ error: 'Payment destination snapshot is unavailable.' }, { status: 409 })
    const evidenceId = crypto.randomUUID()
    uploadedPath = await uploadPinRequestPaymentProof(user.id, id, evidenceId, proofData)
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.pinRequest.updateMany({
        where: { id, city_dist_id: user.id, status: 'pending', payment_status: request.payment_status, payment_due_at: { gt: new Date() } },
        data: { payment_status: 'payment_submitted', payment_reference: referenceNumber, payment_sender_name: senderName, payment_datetime: paidAt },
      })
      if (claimed.count !== 1) throw new Error('PIN_REQUEST_PAYMENT_NOT_OPEN')
      await tx.pinRequestPaymentEvidence.create({
        data: {
          id: evidenceId, pin_request_id: id, payment_method_id: request.payment_method_id!,
          provider_snapshot: String(destination.type || ''),
          account_name_snapshot: String(destination.account_name || ''),
          account_number_snapshot: String(destination.account_number || ''),
          bank_name_snapshot: destination.bank_name ? String(destination.bank_name) : null,
          sender_name: senderName, reference_number: referenceNumber, paid_at: paidAt, proof_path: uploadedPath!,
        },
      })
      await createRequiredAuditLog(tx, {
        user_id: user.actor_id || user.id,
        user_name: user.actor_name || user.full_name || user.username,
        user_role: user.role,
        activity_type: 'pin_request_payment_submitted', category: 'pin',
        description: 'Submitted City Distributor PIN-request payment evidence.',
        metadata: { owner_city_id: user.id, request_id: id, evidence_id: evidenceId, reference_number: referenceNumber },
        status: 'under_review', ...getClientInfo(req),
      })
      await notifyActiveAdmins(tx, {
        type: 'pin_request_payment_submitted',
        title: 'PIN payment proof needs review',
        message: `${user.full_name || user.username} submitted payment proof for a City PIN request. Reference: ${referenceNumber}.`,
        entityType: 'pin_request',
        entityId: id,
        actionUrl: '/dashboard/admin/pin-requests',
      })
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (uploadedPath) await removePinRequestPaymentProof(uploadedPath)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'This payment reference has already been used for the selected destination.' }, { status: 409 })
    }
    console.error('[PIN PAYMENT SUBMIT ERROR]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to submit payment proof.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Context) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const body = await req.json()
  const action = String(body.action || '')
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) : ''
  if (!['verify', 'reject'].includes(action) || notes.length < 5) return NextResponse.json({ error: 'Verification action and review notes are required.' }, { status: 400 })
  const actorId = user.actor_id || user.id
  const result = await prisma.$transaction(async (tx) => {
    const evidence = await tx.pinRequestPaymentEvidence.findFirst({
      where: { pin_request_id: id, status: 'submitted', pin_request: { status: 'pending', payment_status: 'payment_submitted' } },
      orderBy: { created_at: 'desc' },
    })
    if (!evidence) return false
    const updated = await tx.pinRequestPaymentEvidence.updateMany({
      where: { id: evidence.id, status: 'submitted' },
      data: { status: action === 'verify' ? 'verified' : 'rejected', reviewed_by_actor_id: actorId, reviewed_at: new Date(), review_notes: notes },
    })
    if (updated.count !== 1) return false
    const requestUpdate = await tx.pinRequest.updateMany({
      where: { id, status: 'pending', payment_status: 'payment_submitted' },
      data: { payment_status: action === 'verify' ? 'paid' : 'payment_rejected' },
    })
    if (requestUpdate.count !== 1) throw new Error('PIN_REQUEST_PAYMENT_REVIEW_CONFLICT')
    await createRequiredAuditLog(tx, {
      user_id: actorId,
      user_name: user.actor_name || user.full_name || user.username,
      user_role: user.role,
      activity_type: action === 'verify' ? 'pin_request_payment_verified' : 'pin_request_payment_rejected',
      category: 'pin', description: action === 'verify' ? 'Verified PIN-request payment against the official provider record.' : 'Rejected PIN-request payment evidence.',
      metadata: { owner_admin_id: user.id, request_id: id, evidence_id: evidence.id, review_notes: notes },
      status: action === 'verify' ? 'completed' : 'failed', risk_level: action === 'verify' ? 'low' : 'warning', ...getClientInfo(req),
    })
    return true
  })
  if (!result) return NextResponse.json({ error: 'Payment evidence was already reviewed.' }, { status: 409 })
  return NextResponse.json({ success: true })
}
