import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const search   = searchParams.get('search') || ''
    const status   = searchParams.get('status') || 'all'
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const where: any = {
      role: 'reseller',
      ...(status !== 'all' && { status }),
      ...(search && {
        OR: [
          { full_name: { contains: search, mode: 'insensitive' } },
          { username:  { contains: search, mode: 'insensitive' } },
          { mobile:    { contains: search, mode: 'insensitive' } },
        ],
      }),
    }

    const [total, resellers, summary] = await Promise.all([
      prisma.user.count({ where }),

      prisma.user.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, full_name: true, username: true,
          mobile: true, address: true, status: true, created_at: true,
          reseller_profile: {
            select: {
              total_points: true,
              daily_referral_count: true,
              daily_pairs_count: true,
              package: { select: { name: true, price: true } },
              city_dist: { select: { full_name: true, username: true } },
            },
          },
          wallet: { select: { balance: true } },
        },
      }),

      prisma.user.groupBy({
        by: ['status'],
        where: { role: 'reseller' },
        _count: { status: true },
      }),
    ])

    const stats = { total: 0, active: 0, inactive: 0, suspended: 0 }
    for (const row of summary) {
      stats.total += row._count.status
      if (row.status === 'active')    stats.active    = row._count.status
      if (row.status === 'inactive')  stats.inactive  = row._count.status
      if (row.status === 'suspended') stats.suspended = row._count.status
    }

    return NextResponse.json({
      resellers,
      stats,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[GET RESELLERS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}