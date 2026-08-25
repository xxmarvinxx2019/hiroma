import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { getManilaQuarter } from '@/app/lib/productBinaryQuarter'

export const maxDuration = 60

// Runs daily. The order engine also performs the same reset lazily, so a missed
// cron can never carry qualification PU into a new quarter.
// vercel.json: add { "path": "/api/cron/reset-ranks", "schedule": "0 16 * * *" }

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const quarter = getManilaQuarter()
    const reset = await prisma.$executeRaw`
      UPDATE reseller_profiles
      SET rank = 'default', total_pu = 0, qualification_quarter_start = ${quarter.start}
      WHERE qualification_quarter_start IS NULL OR qualification_quarter_start <> ${quarter.start}
    `
    console.log(`[CRON] Reset ${reset} reseller qualification(s) for ${quarter.label}`)
    return NextResponse.json({ success: true, reset, quarter: quarter.label })
  } catch (error) {
    console.error('[CRON RESET RANKS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
