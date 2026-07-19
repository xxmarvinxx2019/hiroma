import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'regional') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))
    const status   = searchParams.get('status') || 'all'
    const search   = searchParams.get('search') || ''

    const myProfile = await prisma.distributorProfile.findUnique({
      where:  { user_id: user.id },
      select: { id: true, region_code: true },
    })

    if (!myProfile) return NextResponse.json({ distributors: [], meta: { total: 0, page: 1, pageSize, totalPages: 0 }, summary: { total: 0, active: 0, inactive: 0 } })

    // Get all provincial dist ids under this regional
    const provincialIds = await prisma.distributorProfile.findMany({
      where:  { dist_level: 'provincial', OR: [{ parent_dist_id: myProfile.id }, ...(myProfile.region_code ? [{ region_code: myProfile.region_code }] : [])] },
      select: { id: true },
    }).then(p => p.map(x => x.id))

    const where: any = {
      dist_level: 'city',
      OR: [
        { parent_dist_id: { in: provincialIds } },
        { parent_dist_id: myProfile.id },
        ...(myProfile.region_code ? [{ region_code: myProfile.region_code }] : []),
      ],
      ...(status !== 'all' && { is_active: status === 'active' }),
      ...(search && {
        user: {
          OR: [
            { full_name: { contains: search, mode: 'insensitive' } },
            { username:  { contains: search, mode: 'insensitive' } },
            { mobile:    { contains: search, mode: 'insensitive' } },
          ],
        },
      }),
    }

    const [total, distributors, activeCount] = await Promise.all([
      prisma.distributorProfile.count({ where }),
      prisma.distributorProfile.findMany({
        where,
        orderBy: { user: { full_name: 'asc' } },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select:  {
          id:             true,
          city_muni_name: true,
          province_name:  true,
          is_active:      true,
          user: {
            select: {
              id: true, full_name: true, username: true,
              mobile: true, status: true, created_at: true,
            },
          },
        },
      }),
      prisma.distributorProfile.count({ where: { ...where, is_active: true } }),
    ])

    // Reseller counts per city dist
    const resellerCounts = await Promise.all(
      distributors.map(d => prisma.user.count({ where: { role: 'reseller', created_by: d.user.id } }).then(count => ({ id: d.user.id, count })))
    )
    const resellerMap = new Map(resellerCounts.map(r => [r.id, r.count]))

    return NextResponse.json({
      distributors: distributors.map(d => ({
        ...d,
        reseller_count: resellerMap.get(d.user.id) || 0,
      })),
      meta:    { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: { total, active: activeCount, inactive: total - activeCount },
    })
  } catch (error) {
    console.error('[REGIONAL CITY DISTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}