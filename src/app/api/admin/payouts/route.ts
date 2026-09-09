import { NextRequest, NextResponse } from 'next/server'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { releasePayoutFunds } from '@/app/lib/payoutFunds'
import { generatePayoutTransactionNumber } from '@/app/lib/payoutTransactionNumber'

function isPayoutSourceAllocationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Payout is not fully backed by payable commission lots.') ||
    message.includes('Historical payouts require full source-allocation reconciliation.')
  )
}

// ── GET all payouts with filter & pagination ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const status   = searchParams.get('status')   || 'all'
    const search   = searchParams.get('search')   || ''
    const cutoff   = searchParams.get('cutoff')   || ''
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '15'))

    const where: any = {
      ...(status !== 'all' && { status }),
      ...(search && {
        OR: [
          { transaction_number:        { contains: search, mode: 'insensitive' } },
          { user: { full_name:         { contains: search, mode: 'insensitive' } } },
          { user: { username:          { contains: search, mode: 'insensitive' } } },
        ],
      }),
      ...(cutoff && {
        cutoff_date: {
          gte: new Date(cutoff + 'T00:00:00'),
          lte: new Date(cutoff + 'T23:59:59'),
        },
      }),
    }

    const [payouts, total, pendingCount, totalAmount] = await Promise.all([
      prisma.payout.findMany({
        where,
        orderBy: { requested_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id:                 true,
          amount:             true,
          status:             true,
          payment_method:     true,
          payment_reference:  true,
          requested_at:       true,
          processed_at:       true,
          user: { select: { id: true, full_name: true, username: true, role: true } },
          approver: { select: { full_name: true } },
        },
      }),
      prisma.payout.count({ where }),
      prisma.payout.count({ where: { ...where, status: 'pending' } }),
      prisma.payout.aggregate({ where, _sum: { amount: true } }),
    ])

    // Fetch new columns separately via raw SQL (safe if columns don't exist yet)
    const extraData: Record<string, { transaction_number: string | null; cutoff_date: string | null; payout_date: string | null; batch_id: string | null; notes: string | null }> = {}
    try {
      const extras = await prisma.$queryRaw<{ id: string; transaction_number: string | null; cutoff_date: string | null; payout_date: string | null; batch_id: string | null; notes: string | null }[]>`
        SELECT id, transaction_number, cutoff_date, payout_date, batch_id, notes FROM payouts WHERE id::text = ANY(${payouts.map(p => p.id)})
      `
      extras.forEach((e) => { extraData[e.id] = { transaction_number: e.transaction_number, cutoff_date: e.cutoff_date ? String(e.cutoff_date) : null, payout_date: e.payout_date ? String(e.payout_date) : null, batch_id: e.batch_id, notes: e.notes } })
    } catch {
      // Columns don't exist yet — run migration SQL to add them
    }

    const enrichedPayouts = payouts.map((p) => ({ ...p, ...(extraData[p.id] || { transaction_number: null, cutoff_date: null, payout_date: null, batch_id: null, notes: null }) }))

    return NextResponse.json({
      payouts: enrichedPayouts,
      summary: {
        pending_count: pendingCount,
        total_amount:  Number(totalAmount._sum.amount || 0),
      },
      meta: { total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    })
  } catch (error) {
    console.error('[ADMIN PAYOUTS GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── PATCH approve or reject payout ──
export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { payout_id, action, notes } = await req.json()
    if (!payout_id || !action) {
      return NextResponse.json({ error: 'payout_id and action are required.' }, { status: 400 })
    }
    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
    }

    const payout = await prisma.payout.findUnique({
      where:  { id: payout_id },
      select: { id: true, status: true, amount: true, user_id: true, requested_at: true },
    })
    if (!payout) {
      return NextResponse.json({ error: 'Payout not found.' }, { status: 404 })
    }
    if (payout.status !== 'pending') {
      return NextResponse.json({ error: 'Payout is already processed.' }, { status: 400 })
    }

    if (action === 'approve') {
      const txNumber = generatePayoutTransactionNumber(payout.id, payout.requested_at)

      // Approve only — wallet is deducted when cron releases on payout_date
      const approved = await prisma.$transaction(async (tx) => {
        const claimed = await tx.payout.updateMany({
          where: { id: payout_id, status: 'pending' },
          data: {
            status: 'approved', approved_by: user.id, processed_at: new Date(),
            transaction_number: txNumber, notes: notes || null,
          },
        })
        if (claimed.count !== 1) return false
        await createRequiredAuditLog(tx, {
          user_id: user.id,
          user_name: user.full_name || user.username,
          user_role: user.role,
          member_id: formatMemberId(user.id, user.role),
          activity_type: 'payout_approved',
          category: 'payout',
          description: `Approved fully allocated payout ${payout_id}.`,
          metadata: { payout_id, reseller_id: payout.user_id, amount: Number(payout.amount), transaction_number: txNumber },
          ...getClientInfo(req),
          risk_level: 'high',
          status: 'completed',
        })
        return true
      })
      if (!approved) {
        return NextResponse.json({ error: 'Payout was already processed by another request.' }, { status: 409 })
      }

      return NextResponse.json({ success: true, transaction_number: txNumber, message: 'Payout approved. Will be released on payout date.' })
    }

    if (action === 'reject') {
      const rejected = await prisma.$transaction(async (tx) => {
        const claimed = await tx.payout.updateMany({
          where: { id: payout_id, status: 'pending' },
          data: { status: 'rejected', approved_by: user.id, processed_at: new Date(), notes: notes || null },
        })
        if (claimed.count !== 1) return false
        await releasePayoutFunds(tx, payout.id, payout.user_id, Number(payout.amount))
        await createRequiredAuditLog(tx, {
          user_id: user.id,
          user_name: user.full_name || user.username,
          user_role: user.role,
          member_id: formatMemberId(user.id, user.role),
          activity_type: 'payout_rejected',
          category: 'payout',
          description: `Rejected payout ${payout_id} and released its reservation.`,
          metadata: { payout_id, reseller_id: payout.user_id, amount: Number(payout.amount), notes: notes || null },
          ...getClientInfo(req),
          risk_level: 'high',
          status: 'completed',
        })
        return true
      })
      if (!rejected) {
        return NextResponse.json({ error: 'Payout was already processed by another request.' }, { status: 409 })
      }
      return NextResponse.json({ success: true, message: 'Payout rejected.' })
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
  } catch (error) {
    if (isPayoutSourceAllocationError(error)) {
      console.error('[ADMIN PAYOUTS FUNDING CONFLICT]', error)
      return NextResponse.json(
        {
          error:
            'Payout cannot be approved because its spendable commission sources are not fully allocated. Reconcile the member ledger first.',
        },
        { status: 409 },
      )
    }
    console.error('[ADMIN PAYOUTS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
