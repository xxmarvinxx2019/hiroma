// src/app/api/admin/resellers/[id]/status/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { claimIdentityAccountSlot, IdentityAccountLimitError, releaseIdentityAccountSlot } from '@/app/lib/identityAccountLimit'
import {
  ConcurrentDeactivationError,
  ReservedPayoutBlocksDeactivationError,
  UnreconciledWalletBlocksDeactivationError,
} from '@/app/lib/resellerDeactivation'
import { expiredBinaryCarryoverValue } from '@/app/lib/deactivationPolicy'
import { appendWalletLedgerEntryExactlyOnce, lockFinancialUser } from '@/app/lib/walletLedger'
import { recordCommissionExactlyOnce } from '@/app/lib/commissionCredit'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: userId } = await params
    const { status } = await req.json()

    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    // Check reseller exists
    const reseller = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, status: true, role: true, identity_document_hash: true },
    })

    if (!reseller) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (reseller.role !== 'reseller') {
      return NextResponse.json({ error: 'Reseller not found' }, { status: 404 })
    }

    const isDeactivating = reseller.status !== 'inactive' && status === 'inactive'

    if (isDeactivating) {
      const result = await prisma.$transaction(async (tx) => {
        // The same per-user lock is acquired before every wallet credit,
        // payout reservation, and deactivation. A concurrent commission must
        // finish first or observe the inactive status and roll back.
        await lockFinancialUser(tx, userId)
        const claimed = await tx.user.updateMany({
          where: { id: userId, role: 'reseller', status: reseller.status },
          data: { status: 'inactive' },
        })
        if (claimed.count !== 1) throw new ConcurrentDeactivationError()

        const walletRows = await tx.$queryRaw<{ balance: string; reserved_balance: string }[]>`
          SELECT balance::text,reserved_balance::text
          FROM wallets
          WHERE user_id=${userId}
          FOR UPDATE
        `
        const wallet = walletRows[0]
        if (!wallet) throw new Error('Reseller wallet was not found.')
        if (Number(wallet.reserved_balance) > 0) throw new ReservedPayoutBlocksDeactivationError()

        const payableRows = await tx.$queryRaw<{ funded_liability: string }[]>`
          SELECT (
            COALESCE((SELECT SUM(remaining_amount) FROM direct_referral_reserve_lots WHERE user_id=${userId}), 0)
            + COALESCE((SELECT SUM(remaining_amount) FROM binary_payable_lots WHERE user_id=${userId}), 0)
            + COALESCE((SELECT SUM(remaining_amount) FROM product_binary_payable_lots WHERE user_id=${userId}), 0)
          )::text AS funded_liability
        `
        const walletBalance = Number(wallet.balance)
        const fundedLiability = Number(payableRows[0]?.funded_liability || 0)
        if (!Number.isFinite(fundedLiability) || Math.abs(walletBalance - fundedLiability) >= 0.005) {
          throw new UnreconciledWalletBlocksDeactivationError()
        }

        const profileRaw = await tx.$queryRaw<{ left_points: number; right_points: number }[]>`
          SELECT COALESCE(left_points, 0)::int AS left_points,
                 COALESCE(right_points, 0)::int AS right_points
          FROM reseller_profiles
          WHERE user_id::text = ${userId}
          FOR UPDATE
        `
        const leftPts = Number(profileRaw[0]?.left_points || 0)
        const rightPts = Number(profileRaw[0]?.right_points || 0)
        const totalPts = leftPts + rightPts
        const ptsValue = expiredBinaryCarryoverValue(leftPts, rightPts)
        const totalFlush = walletBalance

        const hiromaUser = await tx.user.findFirst({
          where: { username: 'hiroma', role: 'admin', status: 'active' },
          select: { id: true },
        })
        if (totalFlush > 0 && !hiromaUser) throw new Error('Hiroma receiving account was not found.')

        await tx.$executeRaw`
          UPDATE reseller_profiles
          SET left_points = 0, right_points = 0, is_active = false
          WHERE user_id::text = ${userId}
        `
        await tx.$executeRaw`
          UPDATE product_binary_positions
          SET left_carryover_pu = 0, right_carryover_pu = 0,
              updated_at = transaction_timestamp()
          WHERE user_id::text = ${userId}
        `
        const event = await tx.resellerDeactivationEvent.create({ data: {
          reseller_id: userId, processed_by: user.id, flushed_points: totalPts,
          points_value: ptsValue, wallet_value: walletBalance, total_flushed: totalFlush,
        } })

        // Every sealed deactivation has one ledger row, including a zero-value
        // event. The deferred database constraint rejects a partial lifecycle.
        await appendWalletLedgerEntryExactlyOnce(tx, {
          eventKey: `deactivation:${event.id}:wallet-forfeit`,
          userId,
          entryType: 'deactivation_forfeit',
          balanceDelta: -walletBalance,
          sourceKind: 'deactivation',
          sourceEventId: event.id,
          metadata: {
            processed_by: user.id,
            funded_liability: fundedLiability,
            liquidation_version: 'deactivation-liability-v1',
          },
        })
        if (walletBalance > 0) {
          await recordCommissionExactlyOnce(tx, {
            eventKey: `deactivation:${event.id}:wallet-retained`,
            sourceEventKind: 'deactivation',
            sourceEventId: event.id,
            ruleVersion: 'reseller-deactivation-v1',
            userId: hiromaUser!.id,
            type: 'deactivation_wallet_transfer',
            amount: walletBalance,
            points: 0,
            sourceUserId: userId,
            isOverflow: true,
            overflowTo: hiromaUser!.id,
          })
        }
        if (reseller.identity_document_hash) {
          await releaseIdentityAccountSlot(tx, reseller.identity_document_hash)
        }
        await createRequiredAuditLog(tx, {
          user_id: user.id,
          user_name: user.full_name || user.username,
          user_role: user.role,
          member_id: formatMemberId(user.id, user.role),
          activity_type: 'reseller_deactivated',
          category: 'reseller',
          description: `Reseller deactivated. ₱${totalFlush.toFixed(2)} forfeited from the member wallet.`,
          metadata: { reseller_id: userId, deactivation_event_id: event.id, flushed_total: totalFlush },
          ...getClientInfo(req),
          risk_level: 'warning',
          status: 'completed',
        })
        return { eventId: event.id, totalPts, ptsValue, walletBalance, totalFlush }
      })

      const { eventId, totalPts, ptsValue, walletBalance, totalFlush } = result

      return NextResponse.json({
        success:         true,
        message:         `Reseller deactivated. ₱${totalFlush.toFixed(2)} wallet balance flushed to Hiroma. ${totalPts} unmatched carryover points expired at ₱0.00.`,
        status:          'inactive',
        flushed_points:  totalPts,
        flushed_pts_value: ptsValue,
        flushed_wallet:  walletBalance,
        flushed_total:   totalFlush,
        deactivation_event_id: eventId,
      })
    }

    // Activate or suspend
    await prisma.$transaction(async (tx) => {
      if (reseller.status === 'inactive' && status !== 'inactive' && reseller.identity_document_hash) {
        await claimIdentityAccountSlot(tx, reseller.identity_document_hash)
      } else if (reseller.status !== 'inactive' && status === 'inactive' && reseller.identity_document_hash) {
        await releaseIdentityAccountSlot(tx, reseller.identity_document_hash)
      }
      const claimed = await tx.user.updateMany({
        where: { id: userId, role: 'reseller', status: reseller.status },
        data:  { status },
      })
      if (claimed.count !== 1) throw new ConcurrentDeactivationError()
      await tx.$executeRaw`
        UPDATE reseller_profiles
        SET is_active = ${status === 'active'}
        WHERE user_id::text = ${userId}
      `
      await createRequiredAuditLog(tx, {
        user_id: user.id,
        user_name: user.full_name || user.username,
        user_role: user.role,
        member_id: formatMemberId(user.id, user.role),
        activity_type: 'reseller_status_changed',
        category: 'reseller',
        description: `Reseller status changed from ${reseller.status} to ${status}.`,
        metadata: { reseller_id: userId, from_status: reseller.status, to_status: status },
        ...getClientInfo(req),
        risk_level: status === 'suspended' ? 'warning' : 'medium',
        status: 'completed',
      })
    })

    return NextResponse.json({
      success: true,
      message: `Reseller ${status === 'active' ? 'activated' : 'suspended'}.`,
      status,
    })

  } catch (error: unknown) {
    if (
      error instanceof ReservedPayoutBlocksDeactivationError
      || error instanceof ConcurrentDeactivationError
      || error instanceof UnreconciledWalletBlocksDeactivationError
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof IdentityAccountLimitError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    const message = error instanceof Error ? error.message : 'Something went wrong.'
    console.error('[RESELLER STATUS ERROR]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
