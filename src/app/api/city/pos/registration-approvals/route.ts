import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const rows = await prisma.posRegistrationIntake.findMany({
    where: {
      owner_id: user.id,
      status: { in: ['pending_payment_verification', 'payment_verified_ready_for_release', 'payment_rejected', 'needs_correction'] },
    },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      receipt_number: true,
      status: true,
      applicant_full_name: true,
      applicant_mobile: true,
      payment_method_snapshot: true,
      payment_reference: true,
      payment_proof_url: true,
      amount_snapshot: true,
      created_at: true,
      package: { select: { name: true } },
      cashier: { select: { full_name: true, username: true } },
      approver: { select: { full_name: true, username: true } },
    },
  })
  return NextResponse.json({ approvals: rows.map((row) => ({ ...row, amount: Number(row.amount_snapshot) })) })
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const actorId = user.actor_id || user.id
  try {
    const body = await req.json()
    const id = typeof body.id === 'string' ? body.id : ''
    const action = body.action
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
    if (!id || !['verify_payment', 'reject_payment', 'needs_correction'].includes(action)) {
      return NextResponse.json({ error: 'Choose a valid registration payment action.' }, { status: 400 })
    }
    if (action !== 'verify_payment' && !reason) {
      return NextResponse.json({ error: 'A reason is required for rejection or correction.' }, { status: 400 })
    }
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: string; cashier_id: string }>>`
        SELECT id, status, cashier_id FROM pos_registration_intakes
        WHERE id = ${id}::uuid AND owner_id = ${user.id}
        FOR UPDATE`
      const row = locked[0]
      if (!row) throw new Error('NOT_FOUND')
      if (row.cashier_id === actorId) throw new Error('SELF_APPROVAL')
      if (row.status !== 'pending_payment_verification' && action !== 'verify_payment') {
        throw new Error('NOT_PENDING')
      }
      if (row.status !== 'pending_payment_verification' && action === 'verify_payment') {
        if (row.status === 'payment_verified_ready_for_release') return { replayed: true }
        throw new Error('NOT_PENDING')
      }
      const next = action === 'verify_payment'
        ? 'payment_verified_ready_for_release'
        : action === 'reject_payment'
          ? 'payment_rejected'
          : 'needs_correction'
      await tx.posRegistrationIntake.update({
        where: { id },
        data: {
          status: next,
          approver_id: actorId,
          payment_verified_at: action === 'verify_payment' ? new Date() : null,
          exception_reason: reason || null,
        },
      })
      await tx.posRegistrationEvent.create({
        data: {
          intake_id: id,
          actor_id: actorId,
          from_status: 'pending_payment_verification',
          to_status: next,
          action,
          reason: reason || null,
        },
      })
      return { replayed: false }
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'NOT_FOUND') return NextResponse.json({ error: 'Registration intake not found.' }, { status: 404 })
    if (message === 'NOT_PENDING') return NextResponse.json({ error: 'This payment is no longer pending verification.' }, { status: 409 })
    if (message === 'SELF_APPROVAL') return NextResponse.json({ error: 'The cashier who recorded this payment cannot approve it.' }, { status: 403 })
    console.error('[POS REGISTRATION APPROVAL]', error)
    return NextResponse.json({ error: 'Unable to update this payment verification.' }, { status: 500 })
  }
}
