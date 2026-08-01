import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, verifyPassword, hashPassword } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { verifyResellerSecurityPin } from '@/app/lib/resellerSecurityPin'
import { getNextQuarterlyPasswordReview, getNextRetainedPasswordReview, isPasswordReviewDue } from '@/app/lib/passwordReviewPolicy'

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { current_password, new_password, security_pin, action: requestedAction } = await req.json()
    const action = requestedAction === 'retain' ? 'retain' : 'change'
    const pinVerification = await verifyResellerSecurityPin(user.id, security_pin)
    if (!pinVerification.valid) {
      return NextResponse.json({ error: pinVerification.error || 'Security PIN is required.' }, { status: pinVerification.locked ? 429 : 401 })
    }

    if (action === 'change' && !new_password) return NextResponse.json({ error: 'Enter your new password.' }, { status: 400 })
    if (action === 'change' && new_password.length < 8) return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 })

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        password_hash: true,
        password_change_required: true,
        password_is_temporary: true,
        password_retention_stage: true,
        password_prompt_due_at: true,
        created_at: true,
      },
    })
    if (!dbUser) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

    if (action === 'retain') {
      if (!isPasswordReviewDue(dbUser.password_change_required, dbUser.password_prompt_due_at)) {
        return NextResponse.json({ error: 'Your password review is not due yet.' }, { status: 400 })
      }
      const nextReview = dbUser.password_is_temporary
        ? getNextRetainedPasswordReview(dbUser.created_at)
        : { stage: dbUser.password_retention_stage, dueAt: getNextQuarterlyPasswordReview() }
      const reviewDate = nextReview.dueAt.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' })

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            password_change_required: false,
            temporary_password_retained_at: new Date(),
            password_retention_stage: nextReview.stage,
            password_prompt_due_at: nextReview.dueAt,
          },
        }),
        prisma.notification.create({
          data: {
            user_id: user.id,
            type: 'security_temporary_password_retained',
            title: 'Password retained',
            message: `You retained your current password. Your next required password review is ${reviewDate}.`,
            entity_type: 'security',
            action_url: '/dashboard/reseller/profile',
          },
        }),
      ])
      return NextResponse.json({ success: true, password_change_required: false, next_password_review_at: nextReview.dueAt.toISOString(), message: 'Current password retained.' })
    }

    if (!current_password) return NextResponse.json({ error: 'Enter your current password.' }, { status: 400 })
    const isValid = await verifyPassword(current_password, dbUser.password_hash)
    if (!isValid) return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })

    const passwordHash = await hashPassword(new_password)
    const now = new Date()
    const nextReviewAt = getNextQuarterlyPasswordReview(now)
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          password_hash: passwordHash,
          password_change_required: false,
          temporary_password_retained_at: null,
          password_is_temporary: false,
          password_retention_stage: 0,
          password_changed_at: now,
          password_prompt_due_at: nextReviewAt,
        },
      }),
      prisma.notification.create({
        data: {
          user_id: user.id,
          type: 'security_password_changed',
          title: 'Password changed',
          message: 'Your Hiroma account password was changed successfully. If this was not you, contact Hiroma support immediately.',
          entity_type: 'security',
          action_url: '/dashboard/reseller/profile',
        },
      }),
    ])
    return NextResponse.json({ success: true, password_change_required: false, next_password_review_at: nextReviewAt.toISOString(), message: 'Password updated successfully.' })
  } catch (error) {
    console.error('[RESELLER PASSWORD PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
