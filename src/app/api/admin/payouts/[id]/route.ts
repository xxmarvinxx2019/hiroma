import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { maskPayoutDestination } from '@/app/lib/payoutDestination'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const payout = await prisma.payout.findUnique({
      where:  { id },
      select: {
        id:               true,
        amount:           true,
        status:           true,
        payment_method:   true,
        payment_reference: true,
        requested_at:     true,
        processed_at:     true,
        user:     { select: { full_name: true, username: true, mobile: true, address: true, role: true } },
        approver: { select: { full_name: true } },
      },
    })

    if (!payout) return NextResponse.json({ error: 'Payout not found.' }, { status: 404 })

    // Fetch new columns via raw SQL
    let extra: Record<string, string | null> = { transaction_number: null, cutoff_date: null, payout_date: null, notes: null, disbursement_provider: null, external_reference: null, disbursed_amount: null, disbursed_at: null, released_at: null, released_by_name: null }
    try {
      const rows = await prisma.$queryRaw<Record<string, string | null>[]>`
        SELECT payout.transaction_number, payout.cutoff_date::text, payout.payout_date::text, payout.notes,
               payout.disbursement_provider, payout.external_reference, payout.disbursed_amount::text,
               payout.disbursed_at::text, payout.released_at::text, releaser.full_name AS released_by_name
        FROM payouts payout LEFT JOIN users releaser ON releaser.id = payout.released_by
        WHERE payout.id::text = ${id}
      `
      if (rows[0]) extra = rows[0]
    } catch {}

    return NextResponse.json({ payout: { ...payout, payment_reference: maskPayoutDestination(payout.payment_reference), ...extra } })
  } catch (error) {
    console.error('[ADMIN PAYOUT DETAIL ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
