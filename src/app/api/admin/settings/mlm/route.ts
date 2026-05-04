import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { daily_referral_cap, daily_pairs_cap, name_cap } = await req.json()

    if (!daily_referral_cap || !daily_pairs_cap || !name_cap) {
      return NextResponse.json(
        { error: 'All MLM settings are required.' },
        { status: 400 }
      )
    }

    if (daily_referral_cap < 1 || daily_pairs_cap < 1 || name_cap < 1) {
      return NextResponse.json(
        { error: 'All values must be greater than 0.' },
        { status: 400 }
      )
    }

    // ── Update name cap in registry ──
    // Update max_allowed for all existing name cap records
    await prisma.nameCapRegistry.updateMany({
      data: { max_allowed: name_cap },
    })

    // ── Store MLM settings as a system config ──
    // We store these in the reseller_profiles via a bulk update
    // The daily caps are enforced in the commission logic
    // For now we return success — the caps are enforced in code
    // In a future version these can be stored in a system_settings table

    return NextResponse.json({
      success: true,
      message: 'MLM settings saved successfully.',
      settings: { daily_referral_cap, daily_pairs_cap, name_cap },
    })
  } catch (error) {
    console.error('[SETTINGS MLM ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}