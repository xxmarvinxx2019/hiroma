import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'

const DISTRIBUTOR_ROLES = ['regional', 'provincial', 'city'] as const

export async function GET(_request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  const normalized = decodeURIComponent(memberId).trim().toUpperCase()
  if (!/^HRM-\d{4}-\d{6}$/.test(normalized)) return NextResponse.json({ error: 'Invalid Distributor ID.' }, { status: 400 })
  try {
    const distributor = await prisma.user.findUnique({ where: { member_id: normalized }, select: {
      member_id: true, full_name: true, role: true, status: true,
      distributor_profile: { select: { dist_level: true, coverage_area: true, is_active: true, fulfillment_outlet_name: true, fulfillment_outlet_city_muni_name: true } },
    } })
    if (!distributor || !DISTRIBUTOR_ROLES.includes(distributor.role as typeof DISTRIBUTOR_ROLES[number]) || !distributor.distributor_profile) return NextResponse.json({ error: 'Distributor not found.' }, { status: 404 })
    return NextResponse.json({ verified: distributor.status === 'active' && distributor.distributor_profile.is_active, distributor: {
      member_id: distributor.member_id, full_name: distributor.full_name, level: distributor.distributor_profile.dist_level,
      coverage_area: distributor.distributor_profile.coverage_area, outlet_name: distributor.distributor_profile.fulfillment_outlet_name,
      outlet_city: distributor.distributor_profile.fulfillment_outlet_city_muni_name,
    } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { console.error('[DISTRIBUTOR VERIFICATION ERROR]', error); return NextResponse.json({ error: 'Verification is temporarily unavailable.' }, { status: 500 }) }
}