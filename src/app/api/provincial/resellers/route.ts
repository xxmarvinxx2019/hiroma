import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'provincial') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))
    const status   = searchParams.get('status') || 'all'
    const search   = searchParams.get('search') || ''

    const myProfile = await prisma.distributorProfile.findUnique({
      where:  { user_id: user.id },
      select: { id: true, province_code: true },
    })
    if (!myProfile) return NextResponse.json({ resellers: [], meta: { total: 0, page: 1, pageSize, totalPages: 0 }, summary: { total: 0, active: 0, inactive: 0 } })

    // Get all city dist ids under this provincial
    const cityDists = await prisma.distributorProfile.findMany({
      where:  { dist_level: 'city', OR: [{ parent_dist_id: myProfile.id }, ...(myProfile.province_code ? [{ province_code: myProfile.province_code }] : [])] },
      select: { user_id: true },
    })
    const cityDistIds = cityDists.map(c => c.user_id)

    const where: any = {
      role:       'reseller',
      created_by: { in: cityDistIds },
      ...(status !== 'all' && { status }),
      ...(search && {
        OR: [
          { full_name: { contains: search, mode: 'insensitive' } },
          { username:  { contains: search, mode: 'insensitive' } },
          { mobile:    { contains: search, mode: 'insensitive' } },
        ],
      }),
    }

    const [total, resellers, activeCount] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { full_name: 'asc' },
        skip:    (page - 1) * pageSize,
        take:    pageSize,
        select:  {
          id: true, full_name: true, username: true,
          mobile: true, address: true, status: true, created_at: true,
          reseller_profile: {
            select: {
              total_points: true,
              package: { select: { name: true } },
              city_dist: { select: { full_name: true, username: true } },
            },
          },
          wallet: { select: { balance: true, total_earned: true } },
        },
      }),
      prisma.user.count({ where: { ...where, status: 'active' } }),
    ])

    return NextResponse.json({
      resellers: resellers.map(r => ({
        ...r,
        city_dist: r.reseller_profile?.city_dist || null,
      })),
      meta:    { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: { total, active: activeCount, inactive: total - activeCount },
    })
  } catch (error) {
    console.error('[PROVINCIAL RESELLERS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}