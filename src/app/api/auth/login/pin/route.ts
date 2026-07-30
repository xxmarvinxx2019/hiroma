import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import {
  deleteTwoFactorChallengeCookie,
  getDashboardRoute,
  getTwoFactorChallenge,
  JWTPayload,
  setAuthCookie,
  signToken,
} from '@/app/lib/auth'
import { verifyResellerSecurityPin } from '@/app/lib/resellerSecurityPin'
import { createAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

export async function POST(req: NextRequest) {
  const { ip_address, device } = getClientInfo(req)
  try {
    const challenge = await getTwoFactorChallenge()
    if (!challenge || challenge.role !== 'reseller') {
      return NextResponse.json({ error: 'Your sign-in verification has expired. Please sign in again.' }, { status: 401 })
    }

    const { pin } = await req.json()
    const verified = await verifyResellerSecurityPin(challenge.id, pin)
    if (!verified.valid) {
      return NextResponse.json({ error: verified.error || 'Incorrect security PIN.' }, { status: verified.locked ? 429 : 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: challenge.id },
      select: { id: true, username: true, full_name: true, role: true, status: true },
    })
    if (!user || user.status !== 'active' || user.role !== 'reseller') {
      await deleteTwoFactorChallengeCookie()
      return NextResponse.json({ error: 'Your account is not available for sign-in.' }, { status: 403 })
    }

    const payload: JWTPayload = {
      id: user.id,
      username: user.username,
      role: 'reseller',
      full_name: user.full_name,
    }
    await setAuthCookie(await signToken(payload))
    await deleteTwoFactorChallengeCookie()

    createAuditLog({
      user_id: user.id,
      user_name: user.full_name,
      user_role: user.role,
      member_id: formatMemberId(user.id, user.role),
      activity_type: 'login',
      category: 'auth',
      description: `${user.full_name} completed security PIN verification and logged in successfully`,
      ip_address,
      device,
      risk_level: 'low',
      status: 'normal',
    })

    return NextResponse.json({ success: true, redirect: getDashboardRoute('reseller') })
  } catch (error) {
    console.error('[LOGIN PIN ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
