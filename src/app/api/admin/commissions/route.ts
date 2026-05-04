import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '15')))
    const type = searchParams.get('type') || ''
    const search = searchParams.get('search') || ''

    // ── Build where clause ──
    const where: any = {}

    if (type && type !== 'all') {
      where.type = type
    }

    if (search) {
      where.user = {
        OR: [
          { full_name: { contains: search, mode: 'insensitive' } },
          { username: { contains: search, mode: 'insensitive' } },
        ],
      }
    }

    // ── Count total ──
    const total = await prisma.commission.count({ where })

    // ── Fetch paginated commissions ──
    const commissions = await prisma.commission.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        amount: true,
        points: true,
        cascade_remainder: true,
        is_pair_overflow: true,
        created_at: true,
        user: { select: { full_name: true, username: true } },
        source_user: { select: { full_name: true, username: true } },
      },
    })

    // ── Summary stats (all time, no filter) ──
    const [totalAmount, totalPoints, totalOverflow, totalCommissions] = await Promise.all([
      prisma.commission.aggregate({ _sum: { amount: true } }),
      prisma.commission.aggregate({ _sum: { points: true } }),
      prisma.commission.count({ where: { is_pair_overflow: true } }),
      prisma.commission.count(),
    ])

    return NextResponse.json({
      commissions,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
      summary: {
        totalCommissions,
        totalAmount: Number(totalAmount._sum.amount || 0),
        totalPoints: Number(totalPoints._sum.points || 0),
        totalOverflow,
      },
    })
  } catch (error) {
    console.error('[GET COMMISSIONS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}