// src/app/api/admin/resellers/[id]/status/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createAuditLog, formatMemberId } from '@/app/lib/auditLog'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

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
      select: { id: true, status: true, role: true },
    })

    if (!reseller) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const isDeactivating = reseller.status === 'active' && status === 'inactive'

    if (isDeactivating) {
      const profileRaw = await prisma.$queryRaw<{ left_points: number; right_points: number }[]>`
        SELECT COALESCE(left_points, 0)::int  AS left_points,
               COALESCE(right_points, 0)::int AS right_points
        FROM reseller_profiles
        WHERE user_id::text = ${userId}
        LIMIT 1
      `

      const leftPts  = Number(profileRaw[0]?.left_points  || 0)
      const rightPts = Number(profileRaw[0]?.right_points || 0)
      const totalPts = leftPts + rightPts
      const ptsValue = totalPts * 0.50

      // Get wallet balance
      const wallet = await prisma.wallet.findUnique({
        where:  { user_id: userId },
        select: { balance: true },
      })
      const walletBalance = Number(wallet?.balance || 0)
      const totalFlush    = ptsValue + walletBalance

      // Get Hiroma user
      const hiromaUser = await prisma.user.findFirst({
        where:  { username: 'hiroma' },
        select: { id: true },
      })

      // Deactivate + reset points + zero wallet in parallel
      await Promise.all([
        prisma.user.update({
          where: { id: userId },
          data:  { status: 'inactive' },
        }),
        prisma.$executeRaw`
          UPDATE reseller_profiles
          SET left_points = 0, right_points = 0
          WHERE user_id::text = ${userId}
        `,
        // Zero out reseller wallet
        prisma.wallet.update({
          where: { user_id: userId },
          data:  { balance: 0 },
        }),
      ])

      // Flush points value + wallet balance to Hiroma
      if (totalFlush > 0 && hiromaUser) {
        const ops: Promise<any>[] = []

        if (ptsValue > 0) {
          ops.push(
            prisma.commission.create({
              data: {
                user_id:          hiromaUser.id,
                type:             'binary_pairing',
                amount:           ptsValue,
                points:           totalPts,
                source_user_id:   userId,
                is_pair_overflow: true,
                overflow_to:      hiromaUser.id,
              },
            })
          )
        }

        if (walletBalance > 0) {
          ops.push(
            prisma.commission.create({
              data: {
                user_id:          hiromaUser.id,
                type:             'binary_pairing',
                amount:           walletBalance,
                points:           0,
                source_user_id:   userId,
                is_pair_overflow: true,
                overflow_to:      hiromaUser.id,
              },
            })
          )
        }

        ops.push(
          prisma.wallet.upsert({
            where:  { user_id: hiromaUser.id },
            update: { balance: { increment: totalFlush }, total_earned: { increment: totalFlush } },
            create: { user_id: hiromaUser.id, balance: totalFlush, total_earned: totalFlush, total_withdrawn: 0 },
          })
        )

        await Promise.all(ops)
      }

          createAuditLog({
      user_id:       user.id,
      user_name:     user.full_name || user.username,
      user_role:     user.role,
      member_id:     formatMemberId(user.id, user.role),
      activity_type: 'reseller_deactivated',
      category:      'reseller',
      description:   `Reseller deactivated. ₱${totalFlush.toFixed(2)} flushed to Hiroma`,
      metadata:      { reseller_id: userId, flushed_total: totalFlush },
      risk_level:    'warning',
      status:        'completed',
    })
return NextResponse.json({
        success:         true,
        message:         `Reseller deactivated. ₱${totalFlush.toFixed(2)} total flushed to Hiroma (${totalPts} pts = ₱${ptsValue.toFixed(2)} + wallet ₱${walletBalance.toFixed(2)}).`,
        status:          'inactive',
        flushed_points:  totalPts,
        flushed_pts_value: ptsValue,
        flushed_wallet:  walletBalance,
        flushed_total:   totalFlush,
      })
    }

    // Activate or suspend
    await Promise.all([
      prisma.user.update({
        where: { id: userId },
        data:  { status },
      }),
      prisma.$executeRaw`
        UPDATE reseller_profiles
        SET is_active = ${status === 'active'}
        WHERE user_id::text = ${userId}
      `,
    ])

    return NextResponse.json({
      success: true,
      message: `Reseller ${status === 'active' ? 'activated' : 'suspended'}.`,
      status,
    })

  } catch (error: any) {
    console.error('[RESELLER STATUS ERROR]', error?.message || error)
    return NextResponse.json({ error: error?.message || 'Something went wrong.' }, { status: 500 })
  }
}