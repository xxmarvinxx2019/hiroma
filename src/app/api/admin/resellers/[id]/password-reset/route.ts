import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { createPasswordResetToken, escapeEmailHtml, PASSWORD_RESET_TTL_MS } from '@/app/lib/passwordReset'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await getCurrentUser()
    if (!admin || admin.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await params
    const reseller = await prisma.user.findFirst({ where: { id, role: 'reseller' }, select: { id: true, full_name: true, email: true } })
    if (!reseller) return NextResponse.json({ error: 'Reseller not found.' }, { status: 404 })
    if (!reseller.email) return NextResponse.json({ error: 'This reseller has no registered email address.' }, { status: 400 })
    const apiKey = process.env.RESEND_API_KEY
    const from = process.env.EMAIL_FROM
    if (!apiKey || !from) return NextResponse.json({ error: 'Email delivery is not configured yet. Add RESEND_API_KEY and EMAIL_FROM to .env after domain verification.' }, { status: 503 })

    const { token, tokenHash } = createPasswordResetToken()
    const reset = await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { user_id: reseller.id, used_at: null } })
      return tx.passwordResetToken.create({ data: { user_id: reseller.id, token_hash: tokenHash, expires_at: new Date(Date.now() + PASSWORD_RESET_TTL_MS), requested_by: admin.id } })
    })
    const baseUrl = (process.env.APP_URL || req.nextUrl.origin).replace(/\/$/, '')
    const link = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`
    const safeName = escapeEmailHtml(reseller.full_name)
    const templateId = process.env.RESEND_PASSWORD_RESET_TEMPLATE_ID
    const resend = new Resend(apiKey)
    const { error } = templateId
      ? await resend.emails.send({
          from,
          to: [reseller.email],
          template: {
            id: templateId,
            variables: {
              USER_NAME: reseller.full_name,
              EXPIRY_HOURS: 30,
              RESET_URL: link,
              CURRENT_YEAR: String(new Date().getFullYear()),
            },
          },
        })
      : await resend.emails.send({
          from, to: [reseller.email], subject: 'Reset your Hiroma password',
          html: `<div style="font-family:Arial,sans-serif;color:#0D1B3E"><h2>Reset your password</h2><p>Hello ${safeName},</p><p>An administrator requested a password reset for your Hiroma account.</p><p><a href="${link}" style="display:inline-block;background:#C9A84C;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Set a new password</a></p><p>This link expires in 30 minutes and can be used only once.</p></div>`,
        })
    if (error) {
      await prisma.passwordResetToken.delete({ where: { id: reset.id } }).catch(() => undefined)
      console.error('[RESEND PASSWORD RESET DELIVERY ERROR]', error)
      return NextResponse.json({
        error: error.message
          ? `Email delivery failed: ${error.message}`
          : 'Unable to send the reset email. Please try again.',
      }, { status: 502 })
    }
    return NextResponse.json({ success: true, message: `A password-reset link was sent to ${reseller.email}.` })
  } catch (error) {
    console.error('[ADMIN RESELLER PASSWORD RESET ERROR]', error)
    const message = error instanceof Error ? error.message : ''
    return NextResponse.json({
      error: message
        ? `Password-reset request failed: ${message}`
        : 'Unable to create the password reset request.',
    }, { status: 500 })
  }
}
