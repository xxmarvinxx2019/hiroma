// src/app/api/admin/resellers/[id]/status/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAuditLog, formatMemberId } from '@/app/lib/auditLog'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { claimIdentityAccountSlot, IdentityAccountLimitError, releaseIdentityAccountSlot } from '@/app/lib/identityAccountLimit'
import { ConcurrentDeactivationError, ReservedPayoutBlocksDeactivationError } from '@/app/lib/resellerDeactivation'
import { expiredBinaryCarryoverValue } from '@/app/lib/deactivationPolicy'

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

    const isDeactivating = reseller.status !== 'inactive' && status === 'inactive'

    if (isDeactivating) {
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.user.updateMany({
          where: { id: userId, role: 'reseller', status: reseller.status },
          data: { status: 'inactive' },
        })
        if (claimed.count !== 1) throw new ConcurrentDeactivationError()

        const wallet = await tx.wallet.findUnique({
          where: { user_id: userId },
          select: { balance: true, reserved_balance: true },
        })
        if (!wallet) throw new Error('Reseller wallet was not found.')
        if (Number(wallet.reserved_balance) > 0) throw new ReservedPayoutBlocksDeactivationError()

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
        const walletBalance = Number(wallet.balance)
        const totalFlush = walletBalance

        const hiromaUser = await tx.user.findFirst({ where: { username: 'hiroma' }, select: { id: true } })
        if (totalFlush > 0 && !hiromaUser) throw new Error('Hiroma receiving account was not found.')

        await tx.$executeRaw`
          UPDATE reseller_profiles
          SET left_points = 0, right_points = 0, is_active = false
          WHERE user_id::text = ${userId}
        `
        await tx.wallet.update({ where: { user_id: userId }, data: { balance: 0 } })
        if (reseller.identity_document_hash) {
          await releaseIdentityAccountSlot(tx, reseller.identity_document_hash)
        }

        if (hiromaUser && walletBalance > 0) {
          await tx.commission.create({ data: {
            user_id: hiromaUser.id, type: 'binary_pairing', amount: walletBalance, points: 0,
            source_user_id: userId, is_pair_overflow: true, overflow_to: hiromaUser.id,
          } })
        }
        if (hiromaUser && totalFlush > 0) {
          await tx.wallet.upsert({
            where: { user_id: hiromaUser.id },
            update: { balance: { increment: totalFlush }, total_earned: { increment: totalFlush } },
            create: { user_id: hiromaUser.id, balance: totalFlush, total_earned: totalFlush, total_withdrawn: 0 },
          })
        }
        const event = await tx.resellerDeactivationEvent.create({ data: {
          reseller_id: userId, processed_by: user.id, flushed_points: totalPts,
          points_value: ptsValue, wallet_value: walletBalance, total_flushed: totalFlush,
        } })
        return { eventId: event.id, totalPts, ptsValue, walletBalance, totalFlush }
      })

      const { eventId, totalPts, ptsValue, walletBalance, totalFlush } = result

          createAuditLog({
      user_id:       user.id,
      user_name:     user.full_name || user.username,
      user_role:     user.role,
      member_id:     formatMemberId(user.id, user.role),
      activity_type: 'reseller_deactivated',
      category:      'reseller',
      description:   `Reseller deactivated. ₱${totalFlush.toFixed(2)} flushed to Hiroma`,
      metadata:      { reseller_id: userId, deactivation_event_id: eventId, flushed_total: totalFlush },
      risk_level:    'warning',
      status:        'completed',
    })
return NextResponse.json({
        success:         true,
        message:         `Reseller deactivated. ₱${totalFlush.toFixed(2)} wallet balance flushed to Hiroma. ${totalPts} unmatched carryover points expired at ₱0.00.`,
        status:          'inactive',
        flushed_points:  totalPts,
        flushed_pts_value: ptsValue,
        flushed_wallet:  walletBalance,
        flushed_total:   totalFlush,
      })
    }

    // Activate or suspend
    await prisma.$transaction(async (tx) => {
      if (reseller.status === 'inactive' && status !== 'inactive' && reseller.identity_document_hash) {
        await claimIdentityAccountSlot(tx, reseller.identity_document_hash)
      } else if (reseller.status !== 'inactive' && status === 'inactive' && reseller.identity_document_hash) {
        await releaseIdentityAccountSlot(tx, reseller.identity_document_hash)
      }
      await tx.user.update({
        where: { id: userId },
        data:  { status },
      })
      await tx.$executeRaw`
        UPDATE reseller_profiles
        SET is_active = ${status === 'active'}
        WHERE user_id::text = ${userId}
      `
    })

    return NextResponse.json({
      success: true,
      message: `Reseller ${status === 'active' ? 'activated' : 'suspended'}.`,
      status,
    })

  } catch (error: any) {
    if (error instanceof ReservedPayoutBlocksDeactivationError || error instanceof ConcurrentDeactivationError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    if (error instanceof IdentityAccountLimitError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[RESELLER STATUS ERROR]', error?.message || error)
    return NextResponse.json({ error: error?.message || 'Something went wrong.' }, { status: 500 })
  }
}
