import { NextRequest, NextResponse } from 'next/server'
import { deleteAuthCookie, getCurrentUser, verifyPassword, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { createAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

// ── PATCH change password ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = user.is_staff ? user.actor_id : user.id
    if (!accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { current_password, new_password } = await req.json()

    if (!current_password || !new_password) {
      return NextResponse.json(
        { error: 'Both current and new password are required.' },
        { status: 400 }
      )
    }

    if (new_password.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters.' },
        { status: 400 }
      )
    }
    if (new_password === current_password) {
      return NextResponse.json({ error: 'Choose a new password that is different from your temporary password.' }, { status: 400 })
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: accountId },
      select: { password_hash: true, password_change_required: true },
    })

    if (!dbUser) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 })
    }

    const isValid = await verifyPassword(current_password, dbUser.password_hash)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Current password is incorrect.' },
        { status: 400 }
      )
    }

    const newHash = await hashPassword(new_password)
    const changedAt = new Date()
    await prisma.user.update({
      where: { id: accountId },
      data:  {
        password_hash: newHash,
        password_changed_at: changedAt,
        password_change_required: false,
        password_is_temporary: false,
        password_retention_stage: 0,
        password_prompt_due_at: null,
        temporary_password_retained_at: null,
      },
    })
    const client = getClientInfo(req)
    createAuditLog({
      user_id: accountId,
      user_name: user.actor_name || user.full_name,
      user_role: user.is_staff ? 'staff' : user.role,
      member_id: formatMemberId(accountId, user.is_staff ? 'staff' : user.role),
      activity_type: dbUser.password_change_required ? 'temporary_password_changed' : 'password_changed',
      category: 'auth',
      description: `${user.actor_name || user.full_name} changed their account password`,
      metadata: { was_temporary: dbUser.password_change_required, changed_at: changedAt.toISOString(), owner_id: user.is_staff ? user.id : null },
      ...client,
      risk_level: 'medium',
      status: 'completed',
    })
    await deleteAuthCookie()

    return NextResponse.json({ success: true, message: 'Password updated successfully. Sign in again on this device.' })
  } catch (error) {
    console.error('[CITY PASSWORD PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
