import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import {
  getSensitiveResellerPinFailure,
  isSensitiveResellerPinAccepted,
  verifyResellerSecurityPin,
} from '@/app/lib/resellerSecurityPin'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

// ── PATCH — edit reseller details ──
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const { full_name, username, mobile, address, email, password, security_pin } = await req.json()

    if (!full_name?.trim()) {
      return NextResponse.json({ error: 'Full name is required.' }, { status: 400 })
    }
    // Check reseller exists first
    const reseller = await prisma.user.findFirst({
      where:  { id, role: 'reseller' },
      select: { id: true, full_name: true, email: true, username: true, mobile: true, address: true },
    })
    if (!reseller) {
      return NextResponse.json({ error: 'Reseller not found.' }, { status: 404 })
    }

    if (typeof password === 'string' && password.trim()) {
      return NextResponse.json(
        { error: 'Passwords cannot be assigned from the profile editor. Use the secure password-reset email.' },
        { status: 400 }
      )
    }

    const cleanUsername = typeof username === 'string' ? username.trim().toLowerCase() : reseller.username
    const cleanEmail = email === undefined ? reseller.email : (typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null)
    const cleanMobile = mobile === undefined ? reseller.mobile : (typeof mobile === 'string' && mobile.trim() ? mobile.trim() : null)
    const cleanAddress = address === undefined ? reseller.address : (typeof address === 'string' && address.trim() ? address.trim() : null)
    const protectedFields = [
      ...(cleanUsername !== reseller.username ? ['username'] : []),
      ...(cleanEmail !== reseller.email ? ['email'] : []),
      ...(cleanMobile !== reseller.mobile ? ['mobile'] : []),
    ]

    if (!cleanUsername) {
      return NextResponse.json({ error: 'Username is required.' }, { status: 400 })
    }
    if (user.is_staff && protectedFields.length > 0) {
      return NextResponse.json(
        { error: 'Only the admin owner can change reseller username, email, or mobile.' },
        { status: 403 }
      )
    }
    if (protectedFields.length > 0) {
      const pinVerification = await verifyResellerSecurityPin(user.id, security_pin)
      if (!isSensitiveResellerPinAccepted(pinVerification)) {
        const failure = getSensitiveResellerPinFailure(pinVerification)
        return NextResponse.json({ error: failure.error }, { status: failure.status })
      }
    }

    // Only check username uniqueness if it actually changed
    if (cleanUsername !== reseller.username) {
      const existingUsername = await prisma.user.findFirst({
        where: { username: cleanUsername, id: { not: id } },
      })
      if (existingUsername) {
        return NextResponse.json({ error: 'Username already taken.' }, { status: 400 })
      }
    }

    // Check email uniqueness if changed
    if (cleanEmail && cleanEmail !== reseller.email) {
      const existing = await prisma.user.findFirst({
        where: { email: cleanEmail, id: { not: id } },
      })
      if (existing) {
        return NextResponse.json({ error: 'Email already in use.' }, { status: 400 })
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data: {
          full_name: full_name.trim(),
          ...(full_name.trim() !== reseller.full_name && {
            first_name: null,
            middle_name: null,
            last_name: null,
            name_suffix: null,
          }),
          username: cleanUsername,
          mobile: cleanMobile,
          address: cleanAddress,
          email: cleanEmail,
          ...(protectedFields.length > 0 && { password_changed_at: new Date() }),
        },
        select: { id: true, full_name: true, username: true, email: true, mobile: true, address: true },
      })

      if (protectedFields.length > 0) {
        const actorId = user.actor_id || user.id
        await createRequiredAuditLog(tx, {
          user_id: actorId,
          user_name: user.full_name,
          user_role: user.is_staff ? 'staff' : 'admin',
          member_id: formatMemberId(actorId, user.is_staff ? 'staff' : 'admin'),
          activity_type: 'reseller_sensitive_profile_updated',
          category: 'reseller',
          description: 'Admin owner confirmed a sensitive reseller profile update with the Security PIN.',
          metadata: { reseller_id: reseller.id, protected_fields: protectedFields },
          risk_level: 'medium',
          status: 'completed',
          ...getClientInfo(req),
        })
      }
      return result
    })

    return NextResponse.json({ success: true, reseller: updated })
  } catch (error) {
    console.error('[ADMIN RESELLER PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
