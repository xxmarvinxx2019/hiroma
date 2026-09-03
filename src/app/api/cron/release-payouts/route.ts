import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { finalizePayoutFunds } from '@/app/lib/payoutFunds'
import { createRequiredAuditLog } from '@/app/lib/auditLog'

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

    let released = 0
    const errors: string[] = []

    for (const payout of duePayouts) {
      try {
        const didRelease = await prisma.$transaction(async (tx) => {
          const claimed = await tx.payout.updateMany({
            where: { id: payout.id, status: 'approved' },
            data:  { status: 'released', released_at: new Date() },
          })
          if (claimed.count !== 1) return false
          await finalizePayoutFunds(tx, payout.id, payout.user_id, Number(payout.amount))
          await createRequiredAuditLog(tx, {
            user_id: payout.user_id,
            user_name: 'Hiroma payout scheduler',
            user_role: 'system',
            activity_type: 'payout_released',
            category: 'payout',
            description: `Released source-backed payout ${payout.id}.`,
            metadata: {
              payout_id: payout.id,
              reseller_id: payout.user_id,
              amount: Number(payout.amount),
              transaction_number: payout.transaction_number,
              actor_type: 'system',
            },
            risk_level: 'high',
            status: 'completed',
          })
          return true
        })
        if (didRelease) released++
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
