import { NextResponse } from 'next/server'
import { deleteAuthCookie, deleteTwoFactorChallengeCookie } from '@/app/lib/auth'

export async function POST() {
  try {
    // ── Delete the auth cookie ──
    await Promise.all([deleteAuthCookie(), deleteTwoFactorChallengeCookie()])

    return NextResponse.json({
      success: true,
      message: 'Logged out successfully.',
    })
  } catch (error) {
    console.error('[LOGOUT ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
