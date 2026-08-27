import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const actorId = user.actor_id || user.id
  const canApprove = !user.is_staff || user.permissions?.includes('pos_approve') === true
  const canEncode = !user.is_staff || user.permissions?.includes('register_reseller') === true
  const canUsePos = !user.is_staff || user.permissions?.includes('pos') === true

  try {
    const [encoding, paymentApprovals, transactionApprovals, shiftApprovals, adjustments, syncAttention] =
      await Promise.all([
        canEncode
          ? prisma.posRegistrationIntake.count({
              where: {
                owner_id: user.id,
                status: { in: ['released_pending_encoding', 'encoding_in_progress'] },
              },
            })
          : 0,
        canApprove
          ? prisma.posRegistrationIntake.count({
              where: { owner_id: user.id, status: 'pending_payment_verification' },
            })
          : 0,
        canApprove
          ? prisma.posTransaction.count({
              where: { owner_id: user.id, status: 'synced_pending_review' },
            })
          : 0,
        canApprove
          ? prisma.inventoryAuditSession.count({
              where: { owner_id: user.id, scope: 'shift_closing', status: 'submitted' },
            })
          : 0,
        canApprove
          ? prisma.posAdjustmentRequest.count({
              where: { owner_id: user.id, status: 'pending' },
            })
          : 0,
        canUsePos
          ? prisma.posTransaction.count({
              where: {
                owner_id: user.id,
                cashier_id: actorId,
                status: { in: ['pending_sync', 'syncing', 'needs_correction'] },
              },
            })
          : 0,
      ])

    const approvalCenter = paymentApprovals + transactionApprovals + shiftApprovals
    return NextResponse.json({
      counts: {
        registration_center: encoding,
        approval_center: approvalCenter,
        void_refunds: adjustments,
        sync_center: syncAttention,
      },
      details: {
        registration_encoding: encoding,
        payment_approvals: paymentApprovals,
        sale_approvals: transactionApprovals,
        shift_approvals: shiftApprovals,
        adjustment_requests: adjustments,
        sync_attention: syncAttention,
      },
      total_actionable: encoding + approvalCenter + adjustments + syncAttention,
    })
  } catch (error) {
    console.error('[POS PENDING SUMMARY]', error)
    return NextResponse.json({ error: 'Unable to load pending work.' }, { status: 500 })
  }
}
