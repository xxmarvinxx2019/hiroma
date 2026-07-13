import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'

export const maxDuration = 60

// ── Vercel Cron: runs daily at midnight PH time (UTC+8 = 16:00 UTC) ──
// vercel.json: { "crons": [{ "path": "/api/cron/release-payouts", "schedule": "0 16 * * *" }] }

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

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
        AND payout_date::date <= ${today}::date
    `

    if (!duePayouts || duePayouts.length === 0) {
      return NextResponse.json({ success: true, released: 0, message: 'No payouts due today.' })
    }

    let released = 0
    const errors: string[] = []

    for (const payout of duePayouts) {
      try {
        await prisma.$transaction(async (tx) => {
          // Update status to released
          await tx.payout.update({
            where: { id: payout.id },
            data:  { status: 'released' },
          })

          // Deduct from wallet
          await tx.wallet.update({
            where: { user_id: payout.user_id },
            data:  {
              balance:         { decrement: Number(payout.amount) },
              total_withdrawn: { increment: Number(payout.amount) },
            },
          })
        })
        released++
      } catch (e) {
        errors.push(`Payout ${payout.id}: ${e}`)
      }
    }

    console.log(`[CRON] Released ${released}/${duePayouts.length} payouts`)
    if (errors.length) console.error('[CRON] Errors:', errors)

    return NextResponse.json({
      success: true,
      released,
      total:   duePayouts.length,
      errors:  errors.length ? errors : undefined,
    })
  } catch (error) {
    console.error('[CRON RELEASE PAYOUTS ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}