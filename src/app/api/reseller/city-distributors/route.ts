import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET all active city distributors ──
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get reseller's own city dist for default selection
    const profile = await prisma.resellerProfile.findUnique({
      where:  { user_id: user.id },
      select: { city_dist_id: true },
    })

    const distributors = await prisma.user.findMany({
      where: {
        role:   'city',
        status: 'active',
      },
      select: {
        id:        true,
        full_name: true,
        username:  true,
        distributor_profile: {
          select: { coverage_area: true },
        },
      },
      orderBy: { full_name: 'asc' },
    })

    return NextResponse.json({
      distributors,
      default_city_dist_id: profile?.city_dist_id || null,
    })
  } catch (error) {
    console.error('[RESELLER CITY DISTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}