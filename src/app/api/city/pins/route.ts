import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'all'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '15')))
    const search = searchParams.get('search') || ''

    // ── Build where clause ──
    const where: any = {
      city_dist_id: user.id,
    }

    if (status !== 'all') {
      where.status = status
    }

    if (search) {
      where.OR = [
        { pin_code: { contains: search.toUpperCase(), mode: 'insensitive' } },
        {
          used_by_user: {
            username: { contains: search.toLowerCase(), mode: 'insensitive' },
          },
        },
      ]
    }

    // ── Count total ──
    const total = await prisma.pin.count({ where })

    // ── Fetch paginated PINs ──
    const pins = await prisma.pin.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        pin_code: true,
        status: true,
        created_at: true,
        used_at: true,
        package: {
          select: { name: true, price: true },
        },
        used_by_user: {
          select: { full_name: true, username: true },
        },
      },
    })

    // ── Summary counts (all statuses, no filter) ──
    const [totalAll, unused, used, expired] = await Promise.all([
      prisma.pin.count({ where: { city_dist_id: user.id } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'unused' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'used' } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'expired' } }),
    ])

    return NextResponse.json({
      pins,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
      summary: {
        total: totalAll,
        unused,
        used,
        expired,
      },
    })
  } catch (error) {
    console.error('[CITY PINS ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong.' },
      { status: 500 }
    )
  }
}