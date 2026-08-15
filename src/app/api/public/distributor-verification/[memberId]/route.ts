import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { consumePublicVerificationAllowance } from '@/app/lib/publicVerificationProtection'
import { maskVerificationName } from '@/app/lib/publicVerificationPolicy'

const DISTRIBUTOR_ROLES = ['regional', 'provincial', 'city'] as const

export async function GET(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  const normalized = decodeURIComponent(memberId).trim().toUpperCase()
  if (!/^HRM-\d{4}-\d{6}$/.test(normalized)) return NextResponse.json({ error: 'Invalid Distributor ID.' }, { status: 400 })
  try {
    if (!(await consumePublicVerificationAllowance(request.headers))) return NextResponse.json({ error: 'Too many verification requests. Please try again shortly.' }, { status: 429, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' } })
    const distributor = await prisma.user.findUnique({ where: { member_id: normalized }, select: {
      member_id: true, full_name: true, role: true, status: true,
      distributor_profile: { select: { dist_level: true, coverage_area: true, is_active: true, fulfillment_outlet_name: true, fulfillment_outlet_city_muni_name: true } },
    } })
    if (!distributor || !DISTRIBUTOR_ROLES.includes(distributor.role as typeof DISTRIBUTOR_ROLES[number]) || !distributor.distributor_profile || distributor.status !== 'active' || !distributor.distributor_profile.is_active) return NextResponse.json({ verified: false, distributor: { member_id: normalized, full_name: null, level: null, coverage_area: null, outlet_name: null, outlet_city: null } }, { headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.json({ verified: true, distributor: {
      member_id: distributor.member_id, full_name: maskVerificationName(distributor.full_name), level: distributor.distributor_profile.dist_level,
      coverage_area: distributor.distributor_profile.coverage_area, outlet_name: distributor.distributor_profile.fulfillment_outlet_name,
      outlet_city: distributor.distributor_profile.fulfillment_outlet_city_muni_name,
    } }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { console.error('[DISTRIBUTOR VERIFICATION ERROR]', error); return NextResponse.json({ error: 'Verification is temporarily unavailable.' }, { status: 500 }) }
}
