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
    const search   = searchParams.get('search')   || ''
    const status   = searchParams.get('status')   || 'all'
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    // Get provincial's own distributor profile
    const myProfile = await prisma.distributorProfile.findUnique({
      where:  { user_id: user.id },
      select: { id: true, coverage_area: true, province_code: true },
    })

    if (!myProfile) {
      return NextResponse.json({
        distributors: [],
        meta:    { total: 0, page: 1, pageSize, totalPages: 0 },
        summary: { total: 0, active: 0, inactive: 0 },
      })
    }

    // Build OR conditions — only include code filter if code exists
    const orConditions: any[] = [{ parent_dist_id: myProfile.id }]
    if (myProfile.province_code) {
      orConditions.push({ province_code: myProfile.province_code })
    }

    const where: any = {
      dist_level: 'city',
      OR: orConditions,
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
        select: {
          id:            true,
          coverage_area: true,
          is_active:     true,
          user: {
            select: {
              id:        true,
              full_name: true,
              username:  true,
              mobile:    true,
              email:     true,
              status:    true,
              created_at: true,
            },
          },
          children: {
            where:  { dist_level: 'city', is_active: true },
            select: { id: true },
          },
        },
      }),
      prisma.distributorProfile.count({ where: { ...where, is_active: true } }),
    ])

    return NextResponse.json({
      distributors,
      meta:    { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary: { total, active: activeCount, inactive: total - activeCount },
    })
  } catch (error) {
    console.error('[PROVINCIAL DISTRIBUTORS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}