import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getProfilePhotoDisplayUrl } from '@/app/lib/profilePhoto'
import { getPasswordReviewReason, isPasswordReviewDue } from '@/app/lib/passwordReviewPolicy'

export async function GET() {
  try {
    // ── Get current user from cookie ──
    const currentUser = await getCurrentUser()

    if (!currentUser) {
      return NextResponse.json(
        { error: 'Not authenticated.' },
        { status: 401 }
      )
    }

    // ── Fetch fresh user data from database ──
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: {
        id: true,
        username: true,
        full_name: true,
        email: true,
        mobile: true,
        profile_photo: true,
        role: true,
        status: true,
        address: true,
        created_at: true,
        // Include reseller profile if role is reseller
        password_change_required: true,
        password_is_temporary: true,
        password_retention_stage: true,
        password_prompt_due_at: true,
        reseller_profile: {
          select: {
            id: true,
            total_points: true,
            daily_referral_count: true,
            daily_pairs_count: true,
            points_reset_at: true,
            package: {
              select: {
                id: true,
                name: true,
                price: true,
                direct_referral_bonus: true,
                pairing_bonus_value: true,
                point_php_value: true,
              },
            },
          },
        },
        // Include distributor profile if role is distributor
        distributor_profile: {
          select: {
            id: true,
            dist_level: true,
            coverage_area: true,
            is_active: true,
          },
        },
        // Include wallet balance
        wallet: {
          select: {
            balance: true,
            total_earned: true,
            total_withdrawn: true,
          },
        },
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'User not found.' },
        { status: 404 }
      )
    }

    // ── Check if account is still active ──
    if (user.status !== 'active') {
      return NextResponse.json(
        { error: 'Account suspended.' },
        { status: 403 }
      )
    }

    const passwordReviewDue = user.role === 'reseller' && isPasswordReviewDue(
      user.password_change_required,
      user.password_prompt_due_at,
    )
    const response = NextResponse.json({
      user: {
        ...user,
        password_change_required: passwordReviewDue,
        password_review_reason: getPasswordReviewReason(user.password_is_temporary, user.password_retention_stage),
        profile_photo: await getProfilePhotoDisplayUrl(user.profile_photo),
        ...(currentUser.is_staff && {
          full_name: currentUser.actor_name || currentUser.full_name,
          username: currentUser.actor_username || currentUser.username,
        }),
        is_staff: Boolean(currentUser.is_staff),
        permissions: currentUser.permissions || [],
        owner_id: currentUser.owner_id || user.id,
      },
    })
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    return response

  } catch (error) {
    console.error('[ME ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
