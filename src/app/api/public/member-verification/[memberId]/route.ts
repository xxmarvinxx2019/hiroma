import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { consumePublicVerificationAllowance } from '@/app/lib/publicVerificationProtection'
import { maskVerificationName } from '@/app/lib/publicVerificationPolicy'

export async function GET(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  const normalizedMemberId = decodeURIComponent(memberId).trim().toUpperCase()

  if (!/^HRM-\d{4}-\d{6}$/.test(normalizedMemberId)) {
    return NextResponse.json({ error: 'Invalid Member ID.' }, { status: 400 })
  }

  try {
    if (!(await consumePublicVerificationAllowance(request.headers))) {
      return NextResponse.json({ error: 'Too many verification requests. Please try again shortly.' }, { status: 429, headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' } })
    }
    const member = await prisma.user.findUnique({
      where: { member_id: normalizedMemberId },
      select: { member_id: true, full_name: true, status: true },
    })

    if (!member || member.status !== 'active') return NextResponse.json({ verified: false, member: { member_id: normalizedMemberId, full_name: null, status: 'not_verified' } }, { headers: { 'Cache-Control': 'no-store' } })

    return NextResponse.json({
      verified: true,
      member: {
        member_id: member.member_id,
        full_name: maskVerificationName(member.full_name),
        status: 'active',
      },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2022') {
      return NextResponse.json({ error: 'Member ID verification is not active yet.' }, { status: 503 })
    }
    console.error('[MEMBER VERIFICATION ERROR]', error)
    return NextResponse.json({ error: 'Verification is temporarily unavailable.' }, { status: 500 })
  }
}
