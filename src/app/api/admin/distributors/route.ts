import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET all distributors ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const parentLevel = searchParams.get('parent_level') || ''
    const search      = searchParams.get('search')       || ''
    const level       = searchParams.get('level')        || 'all'
    const page        = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize    = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const levels = parentLevel
      ? parentLevel.split(',').filter((l) => ['regional', 'provincial', 'city'].includes(l))
      : level !== 'all'
        ? [level]
        : ['regional', 'provincial', 'city']

    const where: any = {
      role: { in: levels },
      ...(search && {
        OR: [
          { full_name: { contains: search, mode: 'insensitive' } },
          { username:  { contains: search, mode: 'insensitive' } },
        ],
      }),
    }

    const total = await prisma.user.count({ where })

    const distributors = await prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        full_name: true,
        username: true,
        mobile: true,
        address: true,
        status: true,
        created_at: true,
        distributor_profile: {
          select: {
            id:            true,
            dist_level:    true,
            coverage_area: true,
            is_active:     true,
            contract_signed_at: true,
            region_name:   true,
            province_name: true,
            city_muni_name: true,
            parent: {
              select: {
                user: { select: { full_name: true, username: true } },
                dist_level:    true,
                coverage_area: true,
              },
            },
          },
        },
      },
    })

    return NextResponse.json({
      distributors,
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[GET DISTRIBUTORS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST create new distributor ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const {
      full_name, username, mobile, password, address, dist_level, parent_dist_id,
      region_code, region_name, province_code, province_name,
      city_muni_code, city_muni_name,
    } = body

    if (!full_name || !username || !mobile || !password || !dist_level) {
      return NextResponse.json({ error: 'All required fields must be filled.' }, { status: 400 })
    }

    if (!region_code || !region_name) {
      return NextResponse.json({ error: 'Region is required.' }, { status: 400 })
    }
    if (dist_level === 'provincial' && (!province_code || !province_name)) {
      return NextResponse.json({ error: 'Province is required for provincial distributors.' }, { status: 400 })
    }
    if (dist_level === 'city' && (!city_muni_code || !city_muni_name)) {
      return NextResponse.json({ error: 'City/Municipality is required for city distributors.' }, { status: 400 })
    }

    // Auto-generate coverage_area display label
    const coverage_area = [city_muni_name, province_name, region_name].filter(Boolean).join(', ')

    const existing = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    })
    if (existing) {
      return NextResponse.json({ error: 'Username already taken.' }, { status: 400 })
    }

    // Parent is optional — city distributors can operate without provincial/regional
    // Validate parent only if one is explicitly provided
    if (parent_dist_id) {
      const parentProfile = await prisma.distributorProfile.findUnique({
        where: { id: parent_dist_id },
        select: { dist_level: true, is_active: true },
      })
      if (!parentProfile) {
        return NextResponse.json({ error: 'Parent distributor not found.' }, { status: 400 })
      }
      if (!parentProfile.is_active) {
        return NextResponse.json({ error: 'Parent distributor is inactive.' }, { status: 400 })
      }
      if (dist_level === 'provincial' && parentProfile.dist_level !== 'regional') {
        return NextResponse.json({ error: 'Provincial must be assigned under a regional distributor.' }, { status: 400 })
      }
      if (dist_level === 'city' && !['provincial', 'regional'].includes(parentProfile.dist_level)) {
        return NextResponse.json({ error: 'City must be assigned under a provincial or regional distributor.' }, { status: 400 })
      }
    }

    const roleMap: Record<string, string> = {
      regional: 'regional',
      provincial: 'provincial',
      city: 'city',
    }
    const role = roleMap[dist_level]
    if (!role) {
      return NextResponse.json({ error: 'Invalid distributor level.' }, { status: 400 })
    }

    const hashedPassword = await hashPassword(password)

    const newDist = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username: username.trim().toLowerCase(),
          full_name: full_name.trim(),
          mobile: mobile.trim(),
          password_hash: hashedPassword,
          role: role as any,
          status: 'active',
          address: address?.trim() || null,
          created_by: user.id,
        },
      })

      await tx.distributorProfile.create({
        data: {
          user_id:           newUser.id,
          dist_level:        dist_level as any,
          coverage_area:     coverage_area,
          parent_dist_id:    parent_dist_id || null,
          contract_signed_at: new Date(),
          is_active:         true,
          region_code:       region_code       || null,
          region_name:       region_name       || null,
          province_code:     province_code     || null,
          province_name:     province_name     || null,
          city_muni_code:    city_muni_code    || null,
          city_muni_name:    city_muni_name    || null,
        },
      })

      await tx.wallet.create({
        data: {
          user_id: newUser.id,
          balance: 0,
          total_earned: 0,
          total_withdrawn: 0,
        },
      })

      return newUser
    })

    return NextResponse.json({
      success: true,
      message: 'Distributor registered successfully.',
      distributor: { id: newDist.id, username: newDist.username },
    })
  } catch (error) {
    console.error('[CREATE DISTRIBUTOR ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
// ── PATCH assign or update parent distributor ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { distributor_id, parent_dist_id } = await req.json()

    if (!distributor_id) {
      return NextResponse.json({ error: 'distributor_id is required.' }, { status: 400 })
    }

    // Get the distributor profile being updated
    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: distributor_id },
      select: { dist_level: true, id: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'Distributor not found.' }, { status: 404 })
    }

    // If removing parent (null), just clear it
    if (!parent_dist_id) {
      await prisma.distributorProfile.update({
        where: { user_id: distributor_id },
        data:  { parent_dist_id: null },
      })
      return NextResponse.json({ success: true, message: 'Parent removed successfully.' })
    }

    // Validate the new parent
    const parentProfile = await prisma.distributorProfile.findUnique({
      where: { id: parent_dist_id },
      select: { dist_level: true, is_active: true, user_id: true },
    })

    if (!parentProfile) {
      return NextResponse.json({ error: 'Parent distributor not found.' }, { status: 404 })
    }
    if (!parentProfile.is_active) {
      return NextResponse.json({ error: 'Parent distributor is inactive.' }, { status: 400 })
    }
    if (parentProfile.user_id === distributor_id) {
      return NextResponse.json({ error: 'Cannot assign distributor as their own parent.' }, { status: 400 })
    }

    // Validate hierarchy
    if (profile.dist_level === 'provincial' && parentProfile.dist_level !== 'regional') {
      return NextResponse.json({ error: 'Provincial must be under a regional distributor.' }, { status: 400 })
    }
    if (profile.dist_level === 'city' && !['provincial', 'regional'].includes(parentProfile.dist_level)) {
      return NextResponse.json({ error: 'City must be under a provincial or regional distributor.' }, { status: 400 })
    }
    if (profile.dist_level === 'regional') {
      return NextResponse.json({ error: 'Regional distributors cannot have a parent.' }, { status: 400 })
    }

    await prisma.distributorProfile.update({
      where: { user_id: distributor_id },
      data:  { parent_dist_id },
    })

    return NextResponse.json({ success: true, message: 'Parent assigned successfully.' })
  } catch (error) {
    console.error('[ADMIN DISTRIBUTORS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}