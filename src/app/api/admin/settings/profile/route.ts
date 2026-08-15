import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import {
  getSensitiveResellerPinFailure,
  isSensitiveResellerPinAccepted,
  verifyResellerSecurityPin,
} from '@/app/lib/resellerSecurityPin'
import { createAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { full_name, email, mobile, security_pin } = await req.json()

    if (!full_name || !mobile) {
      return NextResponse.json(
        { error: 'Full name and mobile are required.' },
        { status: 400 }
      )
    }

    const pinVerification = await verifyResellerSecurityPin(user.id, security_pin)
    if (!isSensitiveResellerPinAccepted(pinVerification)) {
      const failure = getSensitiveResellerPinFailure(pinVerification)
      return NextResponse.json({ error: failure.error }, { status: failure.status })
    }

    // ── Check email uniqueness if provided ──
    if (email) {
      const existing = await prisma.user.findFirst({
        where: {
          email: email.trim().toLowerCase(),
          NOT: { id: user.id },
        },
      })
      if (existing) {
        return NextResponse.json(
          { error: 'Email already in use by another account.' },
          { status: 400 }
        )
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        full_name: full_name.trim(),
        mobile: mobile.trim(),
        email: email?.trim().toLowerCase() || null,
      },
      select: {
        id: true,
        full_name: true,
        username: true,
        email: true,
        mobile: true,
      },
    })

    createAuditLog({
      user_id: user.id,
      user_name: updated.full_name,
      user_role: 'admin',
      member_id: formatMemberId(user.id, 'admin'),
      activity_type: 'sensitive_profile_updated',
      category: 'admin',
      description: 'Admin owner confirmed a sensitive profile update with the Security PIN.',
      metadata: { protected_fields: ['full_name', 'email', 'mobile'] },
      risk_level: 'medium',
      status: 'completed',
      ...getClientInfo(req),
    })

    return NextResponse.json({ success: true, user: updated })
  } catch (error) {
    console.error('[SETTINGS PROFILE ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
