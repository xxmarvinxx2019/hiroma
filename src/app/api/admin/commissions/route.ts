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
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '20'))
    const type     = searchParams.get('type')   || 'all'
    const search   = searchParams.get('search') || ''

    const where: any = {
      // Exclude multilevel from display
      type: type !== 'all'
        ? type
        : { in: ['direct_referral', 'binary_pairing', 'sponsor_point'] },
      ...(search && {
        user: {
          OR: [
            { full_name: { contains: search, mode: 'insensitive' } },
            { username:  { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    }

    const [total, commissions] = await Promise.all([
      prisma.commission.count({ where }),
      prisma.commission.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select:  {
          id: true, type: true, amount: true, points: true,
          created_at: true, is_pair_overflow: true,
          user:        { select: { full_name: true, username: true } },
          source_user: { select: { full_name: true, username: true } },
        },
      }),
    ])

    // Summary aggregates
    const [allSummary, overflowCount] = await Promise.all([
      prisma.commission.groupBy({
        by:    ['type'],
        where: { type: { in: ['direct_referral', 'binary_pairing', 'sponsor_point'] } },
        _sum:  { amount: true, points: true },
        _count: { id: true },
      }),
      prisma.commission.count({
        where: { is_pair_overflow: true },
      }),
    ])

    const typeMap: Record<string, { amount: number; count: number }> = {
      direct_referral: { amount: 0, count: 0 },
      binary_pairing:  { amount: 0, count: 0 },
      sponsor_point:   { amount: 0, count: 0 },
    }
    let total_amount = 0
    let total_points = 0

    for (const row of allSummary) {
      const amt = Number(row._sum.amount || 0)
      const pts = Number(row._sum.points || 0)
      total_amount += amt
      total_points += pts
      if (typeMap[row.type]) {
        typeMap[row.type] = { amount: amt, count: row._count.id }
      }
    }

    const total_records = (typeMap.direct_referral.count || 0) +
                          (typeMap.binary_pairing.count  || 0) +
                          (typeMap.sponsor_point.count   || 0)

    return NextResponse.json({
      commissions,
      summary: {
        total_records,
        total_amount,
        total_points,
        overflow_to_hiroma: overflowCount,
        ...typeMap,
      },
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[ADMIN COMMISSIONS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}