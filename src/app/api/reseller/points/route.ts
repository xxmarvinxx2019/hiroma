import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    // Get reseller profile + package for point value and reset info
    const profile = await prisma.resellerProfile.findUnique({
      where: { user_id: user.id },
      select: {
        total_points:  true,
        points_reset_at: true,
        package: {
          select: {
            name:             true,
            point_php_value:  true,
            point_reset_days: true,
          },
        },
      },
    })

    // Get sponsor point commissions (paginated)
    const [total, pointLogs] = await Promise.all([
      prisma.commission.count({
        where: { user_id: user.id, type: 'sponsor_point' },
      }),
      prisma.commission.findMany({
        where:   { user_id: user.id, type: 'sponsor_point' },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id:         true,
          points:     true,
          amount:     true,
          created_at: true,
          source_user: { select: { full_name: true, username: true } },
        },
      }),
    ])

    // Total points earned all time
    const totalEarned = await prisma.commission.aggregate({
      where: { user_id: user.id, type: 'sponsor_point' },
      _sum:  { points: true, amount: true },
    })

    // Calculate reset info
    const resetDays     = profile?.package?.point_reset_days || 30
    const pointsResetAt = profile?.points_reset_at
    const nextReset     = pointsResetAt
      ? new Date(new Date(pointsResetAt).getTime() + resetDays * 24 * 60 * 60 * 1000)
      : null

    const phpValue      = Number(profile?.package?.point_php_value || 0)
    const totalPoints   = profile?.total_points || 0
    const pointsInPHP   = totalPoints * phpValue

    return NextResponse.json({
      summary: {
        total_points:       totalPoints,
        points_in_php:      pointsInPHP,
        php_value_per_point: phpValue,
        points_reset_at:    pointsResetAt,
        next_reset:         nextReset,
        reset_days:         resetDays,
        all_time_points:    totalEarned._sum.points || 0,
        all_time_amount:    Number(totalEarned._sum.amount || 0),
        package_name:       profile?.package?.name || null,
      },
      point_logs: pointLogs,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[RESELLER POINTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}