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

    // Get reseller's own city_dist_id for default selection
    const profile = await prisma.resellerProfile.findUnique({
      where:  { user_id: user.id },
      select: { city_dist_id: true },
    })

    // Get all active city distributors
    const cityDists = await prisma.user.findMany({
      where:  { role: 'city', status: 'active' },
      select: {
        id:        true,
        full_name: true,
        username:  true,
        distributor_profile: { select: { coverage_area: true } },
      },
      orderBy: { full_name: 'asc' },
    })

    // Only include admin if there are NO city distributors available
    let allDistributors = [...cityDists]
    if (cityDists.length === 0) {
      const admin = await prisma.user.findFirst({
        where:  { role: 'admin' },
        select: { id: true, full_name: true, username: true },
      })
      if (admin) {
        allDistributors = [{ id: admin.id, full_name: 'Hiroma (Direct)', username: admin.username, distributor_profile: null }]
      }
    }

    return NextResponse.json({
      distributors:         allDistributors,
      default_city_dist_id: profile?.city_dist_id || null,
    })
  } catch (error) {
    console.error('[RESELLER CITY DISTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}