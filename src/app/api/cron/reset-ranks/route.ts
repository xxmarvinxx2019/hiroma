import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'

export const maxDuration = 60

// Runs daily — resets reseller ranks when rank period has expired
// vercel.json: add { "path": "/api/cron/reset-ranks", "schedule": "0 16 * * *" }

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const now = new Date()

    // Find packages whose rank period has expired
    const expiredPeriods = await prisma.$queryRaw<{ package_id: string }[]>`
      SELECT DISTINCT package_id::text FROM rank_periods
      WHERE is_active = true AND end_date < ${now}
    `

    if (!expiredPeriods || expiredPeriods.length === 0) {
      return NextResponse.json({ success: true, reset: 0, message: 'No expired rank periods.' })
    }

    let reset = 0
    for (const { package_id } of expiredPeriods) {
      // Reset all resellers in this package back to default rank and 0 PU
      await prisma.$executeRaw`
        UPDATE reseller_profiles
        SET rank = 'default', total_pu = 0
        WHERE package_id::text = ${package_id}
      `
      // Mark period as inactive
      await prisma.$executeRaw`
        UPDATE rank_periods SET is_active = false
        WHERE package_id::text = ${package_id} AND end_date < ${now}
      `
      reset++
    }

    console.log(`[CRON] Reset ranks for ${reset} package(s)`)
    return NextResponse.json({ success: true, reset, packages_reset: expiredPeriods.map(p => p.package_id) })
  } catch (error) {
    console.error('[CRON RESET RANKS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}