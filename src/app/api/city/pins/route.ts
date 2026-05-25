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
    const status    = searchParams.get('status')   || 'all'
    const page      = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize  = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') || '15')))
    const search    = searchParams.get('search')   || ''
    const packageId = searchParams.get('package')  || ''
    const dateFrom  = searchParams.get('dateFrom') || ''
    const dateTo    = searchParams.get('dateTo')   || ''

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
        {
          used_by_user: {
            full_name: { contains: search, mode: 'insensitive' },
          },
        },
      ]
    }

    if (packageId) {
      where.package_id = packageId
    }

    if (dateFrom || dateTo) {
      where.created_at = {
        ...(dateFrom && { gte: new Date(dateFrom) }),
        ...(dateTo   && { lte: new Date(new Date(dateTo).setHours(23, 59, 59, 999)) }),
      }
    }

    // ── Count total ──
    const total = await prisma.pin.count({ where })

    // ── Fetch paginated PINs + packages for filter dropdown ──
    const [pins, packages] = await Promise.all([
      prisma.pin.findMany({
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
      }),

      prisma.package.findMany({
        select:  { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])

    // ── Summary counts (all statuses, no filter) ──
    const [totalAll, unused, used, expired] = await Promise.all([
      prisma.pin.count({ where: { city_dist_id: user.id } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'unused'  } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'used'    } }),
      prisma.pin.count({ where: { city_dist_id: user.id, status: 'expired' } }),
    ])

    return NextResponse.json({
      pins,
      packages,
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