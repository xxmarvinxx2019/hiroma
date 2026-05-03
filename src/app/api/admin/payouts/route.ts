import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET paginated payouts ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'pending'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '15')))
    const search = searchParams.get('search') || ''

    // ── Build where clause ──
    const where: any = {}

    if (status !== 'all') {
      where.status = status
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
    const total = await prisma.payout.count({ where })

    // ── Fetch paginated data ──
    const payouts = await prisma.payout.findMany({
      where,
      orderBy: { requested_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        amount: true,
        status: true,
        payment_method: true,
        payment_reference: true,
        requested_at: true,
        processed_at: true,
        user: {
          select: {
            full_name: true,
            username: true,
            mobile: true,
          },
        },
        approver: {
          select: { full_name: true },
        },
      },
    })

    return NextResponse.json({
      payouts,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch (error) {
    console.error('[GET PAYOUTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}