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
    const type     = searchParams.get('type')     || 'all'
    const search   = searchParams.get('search')   || ''
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const where: Record<string, unknown> = {
      user_id: user.id,
      ...(type !== 'all' && { type }),
      ...(search && {
        source_user: {
          OR: [
            { full_name: { contains: search, mode: 'insensitive' } },
            { username:  { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    }

    const [total, commissions, summaryRaw, totalAmount] = await Promise.all([
      prisma.commission.count({ where }),

      prisma.commission.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id:                true,
          type:              true,
          amount:            true,
          points:            true,
          cascade_remainder: true,
          is_pair_overflow:  true,
          created_at:        true,
          source_user: { select: { full_name: true, username: true } },
        },
      }),

      // Summary by type
      prisma.commission.groupBy({
        by: ['type'],
        where: { user_id: user.id },
        _sum:   { amount: true },
        _count: { type: true },
      }),

      // Grand total
      prisma.commission.aggregate({
        where:  { user_id: user.id },
        _sum:   { amount: true },
        _count: { id: true },
      }),
    ])

    const summary = {
      direct_referral: { amount: 0, count: 0 },
      binary_pairing:  { amount: 0, count: 0 },
      multilevel:      { amount: 0, count: 0 },
      sponsor_point:   { amount: 0, count: 0 },
    }
    for (const row of summaryRaw) {
      summary[row.type as keyof typeof summary] = {
        amount: Number(row._sum.amount || 0),
        count:  row._count.type,
      }
    }

    return NextResponse.json({
      commissions,
      summary,
      grand_total: {
        amount: Number(totalAmount._sum.amount || 0),
        count:  totalAmount._count.id,
      },
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[RESELLER COMMISSIONS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}