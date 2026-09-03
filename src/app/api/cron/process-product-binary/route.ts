import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { processDeliveredProductBinaryOrder } from '@/app/lib/productBinary'

export const maxDuration = 60

// Durable retry worker for Product Binary obligations. The order-delivery
// trigger creates the job atomically; this route only settles pending work.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Claim a short lease in one statement. SKIP LOCKED prevents concurrent
    // cron workers from selecting the same obligation, while the lease makes
    // an interrupted worker eligible again without losing the job.
    const jobs = await prisma.$queryRaw<{ order_id: string }[]>`
      WITH due_jobs AS (
        SELECT id
        FROM product_binary_settlement_jobs
        WHERE status IN ('pending','failed')
          AND next_attempt_at <= CURRENT_TIMESTAMP
        ORDER BY next_attempt_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 10
      )
      UPDATE product_binary_settlement_jobs AS jobs
      SET next_attempt_at = CURRENT_TIMESTAMP + INTERVAL '2 minutes',
          updated_at = CURRENT_TIMESTAMP
      FROM due_jobs
      WHERE jobs.id = due_jobs.id
      RETURNING jobs.order_id
    `

    let completed = 0
    const errors: Array<{ order_id: string; error: string }> = []
    for (const job of jobs) {
      try {
        await processDeliveredProductBinaryOrder(job.order_id)
        completed++
      } catch (error) {
        errors.push({
          order_id: job.order_id,
          error: error instanceof Error ? error.message : 'Unknown settlement error',
        })
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      attempted: jobs.length,
      completed,
      failed: errors.length,
      errors: errors.length ? errors : undefined,
    })
  } catch (error) {
    console.error('[PRODUCT BINARY RETRY ERROR]', error)
    return NextResponse.json({ error: 'Product Binary retry worker failed.' }, { status: 500 })
  }
}
