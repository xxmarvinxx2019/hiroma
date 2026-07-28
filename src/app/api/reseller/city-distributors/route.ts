import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

// ── GET all available city distributors + admin ──
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.resellerProfile.findUnique({
      where:  { user_id: user.id },
      select: {
        city_dist_id: true,
        city_dist: {
          select: {
            id: true,
            full_name: true,
            username: true,
            status: true,
            distributor_profile: { select: { coverage_area: true, dist_level: true } },
          },
        },
      },
    })

    if (!profile?.city_dist || profile.city_dist.status !== 'active') {
      return NextResponse.json({
        distributors: [],
        assigned_distributor: null,
        default_city_dist_id: null,
        error: 'No active distributor is assigned to this reseller.',
      })
    }

    const { status: _status, ...assignedDistributor } = profile.city_dist
    return NextResponse.json({
      distributors: [assignedDistributor],
      assigned_distributor: assignedDistributor,
      default_city_dist_id: profile.city_dist_id,
    })
  } catch (error) {
    console.error('[RESELLER CITY DISTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
