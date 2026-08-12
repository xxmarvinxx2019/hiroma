import { NextRequest, NextResponse } from 'next/server'
import { hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { hashPasswordResetToken } from '@/app/lib/passwordReset'
import { createAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

export async function POST(req: NextRequest) {
  const client = getClientInfo(req)
  try {
    const { token, password } = await req.json()
    if (typeof token !== 'string' || !token || typeof password !== 'string' || password.length < 8) return NextResponse.json({ error: 'Use a valid reset link and a password with at least 8 characters.' }, { status: 400 })
    const reset = await prisma.passwordResetToken.findUnique({ where: { token_hash: hashPasswordResetToken(token) }, include: { user: { select: { id: true, full_name: true, role: true } } } })
    if (!reset || reset.used_at || reset.expires_at <= new Date()) return NextResponse.json({ error: 'This reset link is invalid or has expired. Request a new one from your administrator.' }, { status: 400 })
    const passwordHash = await hashPassword(password)
    const recoveredAt = new Date()
    const completed = await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: reset.id, used_at: null, expires_at: { gt: recoveredAt } }, data: { used_at: recoveredAt } })
      if (claimed.count !== 1) return null
      await tx.user.update({ where: { id: reset.user_id }, data: { password_hash: passwordHash, password_change_required: false, password_is_temporary: false, temporary_password_retained_at: null, password_changed_at: recoveredAt } })
      await tx.passwordResetToken.updateMany({ where: { user_id: reset.user_id, used_at: null }, data: { used_at: recoveredAt } })
      const revoked = reset.user.role === 'reseller' ? await tx.passkeyCredential.deleteMany({ where: { user_id: reset.user_id } }) : { count: 0 }
      return { revokedPasskeys: revoked.count }
    })
    if (!completed) return NextResponse.json({ error: 'This reset link is invalid or has expired. Request a new one from your administrator.' }, { status: 400 })
    if (reset.user.role === 'reseller') {
      createAuditLog({
        user_id: reset.user.id,
        user_name: reset.user.full_name,
        user_role: 'reseller',
        member_id: formatMemberId(reset.user.id, 'reseller'),
        activity_type: 'passkeys_revoked_for_recovery',
        category: 'auth',
        description: 'Password recovery completed and all reseller passkeys were revoked.',
        metadata: { revoked_passkey_count: completed.revokedPasskeys, reseller_sessions_revoked: true },
        risk_level: 'medium',
        status: 'completed',
        ...client,
      })
    }
    return NextResponse.json({ success: true, message: 'Password reset successfully. Any registered passkeys were removed; you can now sign in with your new password.' })
  } catch (error) {
    console.error('[PASSWORD RESET ERROR]', error)
    return NextResponse.json({ error: 'Unable to reset the password.' }, { status: 500 })
  }
}
