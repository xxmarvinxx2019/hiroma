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
    if (!myProfile) return NextResponse.json({ resellers: [], meta: { total: 0, page: 1, pageSize, totalPages: 0 }, summary: { total: 0, active: 0, inactive: 0 } })

    // Get all city dist ids in this region
    const provincialIds = await prisma.distributorProfile.findMany({
      where:  { dist_level: 'provincial', OR: [{ parent_dist_id: myProfile.id }, ...(myProfile.region_code ? [{ region_code: myProfile.region_code }] : [])] },
      select: { id: true },
    }).then(p => p.map(x => x.id))

    const cityDists = await prisma.distributorProfile.findMany({
      where:  { dist_level: 'city', OR: [{ parent_dist_id: { in: provincialIds } }, { parent_dist_id: myProfile.id }, ...(myProfile.region_code ? [{ region_code: myProfile.region_code }] : [])] },
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
            },
          },
          wallet: { select: { balance: true, total_earned: true } },
        },
      }),
      prisma.user.count({ where: { ...where, status: 'active' } }),
    ])

    // Fetch city dist info for each reseller via created_by
    const cityDistUserIds = [...new Set(resellers.map(r => r.id))]
    const createdByMap = await prisma.user.findMany({
      where:   { id: { in: resellers.map(() => '').filter(Boolean) } },
      select: { id: true },
    }).then(() => new Map<string, { full_name: string; username: string }>())

    // Get city dist names via reseller_profile.city_dist_id relation
    const resellerProfiles = await prisma.resellerProfile.findMany({
      where:  { user_id: { in: resellers.map(r => r.id) } },
      select: { user_id: true, city_dist: { select: { full_name: true, username: true } } },
    })
    const cityDistByReseller = new Map(resellerProfiles.map(p => [p.user_id, p.city_dist]))

    return NextResponse.json({
      resellers: resellers.map(r => ({
        ...r,
        city_dist: cityDistByReseller.get(r.id) || null,
      })),
      meta:    { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: { total, active: activeCount, inactive: total - activeCount },
    })
  } catch (error) {
    console.error('[REGIONAL RESELLERS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}