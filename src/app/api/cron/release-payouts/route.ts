import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'

export const maxDuration = 60

// ── Vercel Cron: runs daily at midnight PH time (UTC+8 = 16:00 UTC) ──
// vercel.json: { "crons": [{ "path": "/api/cron/release-payouts", "schedule": "0 16 * * *" }] }

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Find all approved payouts whose payout_date has arrived
    const duePayouts = await prisma.$queryRaw<{
      id: string
      user_id: string
      amount: string
      transaction_number: string | null
    }[]>`
      SELECT id, user_id, amount::text, transaction_number
      FROM payouts
      WHERE status = 'approved'
        AND payout_date IS NOT NULL
        AND payout_date::date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
    `

    if (!duePayouts || duePayouts.length === 0) {
      return NextResponse.json({ success: true, released: 0, message: 'No payouts due today.' })
    }

    // Reaching the scheduled date never proves that money was sent. Keep the
    // payout approved until an authorized maker file supplies validated bank
    // or e-wallet evidence through the payout batch workflow.
    console.log(`[CRON] ${duePayouts.length} payouts are due and awaiting disbursement evidence`)
    return NextResponse.json({
      success: true,
      released: 0,
      due: duePayouts.length,
      message: 'Due payouts remain approved until external disbursement evidence is confirmed.',
    })
  } catch (error) {
    console.error('[CRON RELEASE PAYOUTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
