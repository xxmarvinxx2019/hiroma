import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { sendSMS, smsWelcomeReseller } from '@/app/lib/sms'
import { createPasswordResetToken, PASSWORD_RESET_TTL_MS } from '@/app/lib/passwordReset'
import { ApplicationUrlConfigurationError, resolveApplicationUrl } from '@/app/lib/applicationUrl'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

class WelcomeLinkAlreadyIssuedError extends Error {}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || !['admin', 'city'].includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    }
    if (user.is_staff && !user.permissions?.includes('register_reseller')) {
      return NextResponse.json({ error: 'Your staff account cannot send registration credentials.' }, { status: 403 })
    }

    const { reseller_id } = await req.json().catch(() => ({}))
    if (typeof reseller_id !== 'string' || !reseller_id.trim()) {
      return NextResponse.json({ error: 'Reseller is required.' }, { status: 400 })
    }

    const reseller = await prisma.user.findFirst({
      where: {
        id: reseller_id,
        role: 'reseller',
        created_by: user.id,
        created_at: { gte: new Date(Date.now() - 30 * 60 * 1000) },
        ...(user.role === 'city' && {
          reseller_profile: { is: { city_dist_id: user.id } },
        }),
      },
      select: {
        id: true,
        full_name: true,
        username: true,
        mobile: true,
        reseller_profile: {
          select: { package: { select: { name: true } } },
        },
      },
    })

    if (!reseller) {
      return NextResponse.json(
        { error: 'The newly registered reseller was not found or is no longer eligible for credential SMS.' },
        { status: 404 },
      )
    }
    if (!reseller.mobile) {
      return NextResponse.json({ error: 'The reseller has no mobile number.' }, { status: 400 })
    }

    let baseUrl: string
    try {
      baseUrl = resolveApplicationUrl({
        configuredUrl: process.env.APP_URL,
        requestOrigin: req.nextUrl.origin,
        production: process.env.NODE_ENV === 'production',
      })
    } catch (error) {
      if (!(error instanceof ApplicationUrlConfigurationError)) throw error
      console.error('[WELCOME SMS APP URL CONFIGURATION ERROR]', error.message)
      return NextResponse.json({ error: 'Secure welcome-link delivery is not configured.' }, { status: 503 })
    }

    const actorId = user.actor_id || user.id
    const { token, tokenHash } = createPasswordResetToken()
    const reset = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${reseller.id}::uuid FOR UPDATE`
      const activeToken = await tx.passwordResetToken.findFirst({
        where: {
          user_id: reseller.id,
          used_at: null,
          expires_at: { gt: new Date() },
        },
        select: { id: true },
      })
      if (activeToken) throw new WelcomeLinkAlreadyIssuedError()

      const created = await tx.passwordResetToken.create({
        data: {
          user_id: reseller.id,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
          requested_by: actorId,
        },
      })
      await createRequiredAuditLog(tx, {
        user_id: actorId,
        user_name: user.actor_name || user.full_name || user.username,
        user_role: user.is_staff ? 'staff' : user.role,
        member_id: formatMemberId(actorId, user.is_staff ? 'staff' : user.role),
        activity_type: 'reseller_welcome_link_created',
        category: 'reseller',
        description: 'Created a single-use reseller password setup link for SMS delivery.',
        metadata: { reseller_id: reseller.id, reset_token_id: created.id },
        risk_level: 'medium',
        status: 'under_review',
        ...getClientInfo(req),
      })
      return created
    })

    const setupUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`

    const result = await sendSMS(
      reseller.mobile,
      smsWelcomeReseller({
        full_name: reseller.full_name,
        username: reseller.username,
        package_name: reseller.reseller_profile?.package?.name || 'Starter',
        setup_url: setupUrl,
      }),
    )

    if (!result.success) {
      await prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.deleteMany({ where: { id: reset.id, used_at: null } })
        await createRequiredAuditLog(tx, {
          user_id: actorId,
          user_name: user.actor_name || user.full_name || user.username,
          user_role: user.is_staff ? 'staff' : user.role,
          member_id: formatMemberId(actorId, user.is_staff ? 'staff' : user.role),
          activity_type: 'reseller_welcome_link_delivery_failed',
          category: 'reseller',
          description: 'Welcome-link SMS delivery failed; the unused setup token was revoked.',
          metadata: { reseller_id: reseller.id, reset_token_id: reset.id },
          risk_level: 'warning',
          status: 'failed',
          ...getClientInfo(req),
        })
      })
      return NextResponse.json({ error: result.error || 'SMS could not be sent.' }, { status: 502 })
    }

    return NextResponse.json({ success: true, message: 'A secure one-time password setup link was sent by SMS.' })
  } catch (error) {
    if (error instanceof WelcomeLinkAlreadyIssuedError) {
      return NextResponse.json(
        { error: 'A valid one-time setup link was already issued for this reseller. Wait for it to expire before requesting another.' },
        { status: 409 },
      )
    }
    console.error('[WELCOME SMS ERROR]', error)
    return NextResponse.json({ error: 'SMS could not be sent.' }, { status: 500 })
  }
}
