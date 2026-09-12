import { NextRequest, NextResponse } from 'next/server'
import { Prisma, UserStatus } from '@prisma/client'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const ALLOWED_STATUSES = new Set(['active', 'inactive', 'suspended'])
const ALLOWED_SORTS = new Set(['latest', 'oldest', 'name_asc', 'name_desc'])

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const search   = (searchParams.get('search') || '').trim().slice(0, 100)
    const requestedStatus = searchParams.get('status') || 'all'
    const status = ALLOWED_STATUSES.has(requestedStatus) ? requestedStatus as UserStatus : null
    const requestedSort = searchParams.get('sort') || 'latest'
    const sort = ALLOWED_SORTS.has(requestedSort) ? requestedSort : 'latest'
    const parsedPage = Number(searchParams.get('page') || '1')
    const parsedPageSize = Number(searchParams.get('pageSize') || '15')
    const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(10_000, parsedPage) : 1
    const pageSize = Math.min(
      50,
      Number.isSafeInteger(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : 15,
    )

    const orderBy: Prisma.UserOrderByWithRelationInput[] = sort === 'name_asc'
      ? [
          { last_name: { sort: 'asc', nulls: 'last' } },
          { first_name: { sort: 'asc', nulls: 'last' } },
          { full_name: 'asc' },
          { id: 'asc' },
        ]
      : sort === 'name_desc'
        ? [
            { last_name: { sort: 'desc', nulls: 'last' } },
            { first_name: { sort: 'asc', nulls: 'last' } },
            { full_name: 'asc' },
            { id: 'asc' },
          ]
        : sort === 'oldest'
          ? [{ created_at: 'asc' }, { id: 'asc' }]
          : [{ created_at: 'desc' }, { id: 'asc' }]

    const where: Prisma.UserWhereInput = {
      role: 'reseller',
      ...(status && { status }),
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
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, full_name: true, first_name: true, middle_name: true,
          last_name: true, name_suffix: true, username: true, email: true,
          mobile: true, address: true, status: true, created_at: true,
          reseller_profile: {
            select: {
              total_points: true,
              daily_referral_count: true,
              daily_pairs_count: true,
              package: { select: { name: true, price: true } },
              city_dist: {
                select: {
                  full_name: true,
                  username:  true,
                  distributor_profile: { select: { coverage_area: true } },
                },
              },
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
