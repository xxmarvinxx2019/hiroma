import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, hashPassword } from '@/app/lib/auth'
import { isValidSecurityPin, verifyResellerSecurityPin } from '@/app/lib/resellerSecurityPin'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const security = await prisma.user.findUnique({
      where: { id: user.id },
      select: { two_factor_enabled: true },
    })
    return NextResponse.json({ enabled: Boolean(security?.two_factor_enabled) })
  } catch (error) {
    console.error('[RESELLER SECURITY PIN GET ERROR]', error)
    const detail = process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined
    return NextResponse.json({
      error: detail ? `Unable to load security PIN settings: ${detail}` : 'Unable to load security PIN settings. Please refresh and try again.',
    }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { action, current_pin, new_pin, confirm_pin } = await req.json()
    if (!['enable', 'disable', 'change'].includes(action)) {
      return NextResponse.json({ error: 'Invalid security PIN action.' }, { status: 400 })
    }

    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { two_factor_enabled: true },
    })
    if (!account) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

    if (action === 'enable' || action === 'change') {
      if (!isValidSecurityPin(new_pin)) {
        return NextResponse.json({ error: 'Security PIN must contain exactly six digits.' }, { status: 400 })
      }
      if (new_pin !== confirm_pin) {
        return NextResponse.json({ error: 'PINs do not match. Please try again.' }, { status: 400 })
      }
      if (action === 'change') {
        const pinVerified = current_pin ? await verifyResellerSecurityPin(user.id, current_pin) : { valid: false }
        if (!pinVerified.valid) {
          return NextResponse.json({ error: 'Incorrect PIN. Please try again.' }, { status: 400 })
        }
      }
      await prisma.user.update({
        where: { id: user.id },
        data: {
          two_factor_enabled: true,
          two_factor_pin_hash: await hashPassword(new_pin),
          two_factor_failed_attempts: 0,
          two_factor_locked_until: null,
        },
      })
      return NextResponse.json({ success: true, enabled: true, message: action === 'enable' ? 'Security PIN enabled.' : 'Security PIN changed.' })
    }

    if (!account.two_factor_enabled) return NextResponse.json({ success: true, enabled: false })
    const verified = await verifyResellerSecurityPin(user.id, current_pin)
    if (!verified.valid) return NextResponse.json({ error: 'Incorrect PIN. Please try again.' }, { status: 400 })
    await prisma.user.update({
      where: { id: user.id },
      data: {
        two_factor_enabled: false,
        two_factor_pin_hash: null,
        two_factor_failed_attempts: 0,
        two_factor_locked_until: null,
      },
    })
    return NextResponse.json({ success: true, enabled: false, message: 'Security PIN disabled.' })
  } catch (error) {
    console.error('[RESELLER SECURITY PIN ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
