import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    const payout = await prisma.payout.findUnique({
      where:  { id, user_id: user.id },
      select: {
        id:               true,
        amount:           true,
        status:           true,
        payment_method:   true,
        payment_reference: true,
        requested_at:     true,
        processed_at:     true,
        approver: { select: { full_name: true } },
      },
    })

    if (!payout) return NextResponse.json({ error: 'Payout not found.' }, { status: 404 })

    // Fetch new columns via raw SQL
    let extra = { transaction_number: null, cutoff_date: null, notes: null }
    try {
      const rows = await prisma.$queryRaw<{ transaction_number: string | null; cutoff_date: string | null; notes: string | null }[]>`
        SELECT transaction_number, cutoff_date, payout_date, notes FROM payouts WHERE id = ${id}::uuid
      `
      if (rows[0]) extra = rows[0] as any
    } catch {}

    return NextResponse.json({ payout: { ...payout, ...extra } })
  } catch (error) {
    console.error('[RESELLER WALLET PAYOUT DETAIL ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}