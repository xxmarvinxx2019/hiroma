import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params
  const normalizedMemberId = decodeURIComponent(memberId).trim().toUpperCase()

  if (!/^HRM-\d{4}-\d{6}$/.test(normalizedMemberId)) {
    return NextResponse.json({ error: 'Invalid Member ID.' }, { status: 400 })
  }

  try {
    const member = await prisma.user.findUnique({
      where: { member_id: normalizedMemberId },
      select: { member_id: true, full_name: true, status: true },
    })

    if (!member) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })

    return NextResponse.json({
      verified: member.status === 'active',
      member: {
        member_id: member.member_id,
        full_name: member.full_name,
        status: member.status,
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
