import { NextRequest, NextResponse } from 'next/server'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true, is_active: true },
    })
    if (!profile?.is_active || profile.dist_level !== 'branch') {
      return NextResponse.json({ error: 'Only an active Hiroma Branch may receive internal PIN transfers.' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const action = body.action === 'received' ? 'received' : body.action === 'rejected' ? 'rejected' : null
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!action) return NextResponse.json({ error: 'A valid receiving action is required.' }, { status: 400 })
    if (action === 'rejected' && (reason.length < 3 || reason.length > 500)) {
      return NextResponse.json({ error: 'A rejection reason between 3 and 500 characters is required.' }, { status: 400 })
    }

    const transfer = await prisma.pinTransfer.findFirst({
      where: { id, recipient_id: user.id },
    })
    if (!transfer) return NextResponse.json({ error: 'PIN transfer not found.' }, { status: 404 })
    if (transfer.status !== 'in_transit') {
      return NextResponse.json({ error: 'This PIN transfer has already been resolved.' }, { status: 409 })
    }

    const actorId = user.actor_id || user.id
    const actorName = user.actor_name || user.full_name || user.username
    const resolvedAt = new Date()
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.pinTransfer.updateMany({
        where: { id, recipient_id: user.id, status: 'in_transit' },
        data: action === 'received'
          ? { status: 'received', received_at: resolvedAt, received_by_actor_id: actorId }
          : {
              status: 'rejected',
              rejected_at: resolvedAt,
              rejected_by_actor_id: actorId,
              rejection_reason: reason,
            },
      })
      if (claimed.count !== 1) throw new Error('PIN_TRANSFER_ALREADY_RESOLVED')

      const changedPins = await tx.pin.updateMany({
        where: { funding_pin_transfer_id: id, status: 'in_transit' },
        data: action === 'received'
          ? { status: 'unused' }
          : {
              status: 'cancelled',
              cancelled_at: resolvedAt,
              cancelled_by: actorId,
              cancellation_reason: reason,
              cancellation_disposition: 'internal_transfer_rejected',
              cancellation_amount: 0,
            },
      })
      if (changedPins.count !== transfer.quantity) throw new Error('PIN_TRANSFER_BATCH_MISMATCH')

      await tx.notification.create({
        data: {
          user_id: transfer.admin_id,
          type: action === 'received' ? 'pin_transfer_received' : 'pin_transfer_rejected',
          title: action === 'received' ? 'Branch received PIN transfer' : 'Branch rejected PIN transfer',
          message: action === 'received'
            ? `${actorName} accepted ${transfer.quantity} PIN(s) under ${transfer.reference_number}.`
            : `${actorName} rejected ${transfer.reference_number}: ${reason}`,
          entity_type: 'pin_transfer',
          entity_id: id,
          action_url: '/dashboard/admin/pins',
        },
      })
      await createRequiredAuditLog(tx, {
        user_id: actorId,
        user_name: actorName,
        user_role: user.role,
        activity_type: `branch_pin_transfer_${action}`,
        category: 'pin',
        description: `Branch ${action} PIN transfer ${transfer.reference_number} as one complete batch.`,
        metadata: {
          owner_branch_id: user.id,
          transfer_id: id,
          reference_number: transfer.reference_number,
          quantity: transfer.quantity,
          sale_value: 0,
          reference_value: Number(transfer.reference_value),
          reason: action === 'rejected' ? reason : null,
        },
        status: 'completed',
        risk_level: action === 'rejected' ? 'warning' : 'low',
        ...getClientInfo(req),
      })
    })

    return NextResponse.json({
      success: true,
      status: action,
      message: action === 'received'
        ? 'PIN transfer received. The complete batch is now available to the Branch.'
        : 'PIN transfer rejection recorded. No PIN from the batch became usable.',
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'PIN_TRANSFER_ALREADY_RESOLVED') {
      return NextResponse.json({ error: 'This PIN transfer was resolved by another request.' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'PIN_TRANSFER_BATCH_MISMATCH') {
      return NextResponse.json({ error: 'PIN batch integrity check failed. Nothing was received; contact Admin.' }, { status: 409 })
    }
    console.error('[PIN TRANSFER PATCH ERROR]', error)
    return NextResponse.json({ error: 'Unable to resolve PIN transfer.' }, { status: 500 })
  }
}
