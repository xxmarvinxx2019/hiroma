import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

function generateTransactionNumber() {
  const now  = new Date()
  const year = now.getFullYear()
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `PAY-${year}-${rand}`
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
    let extraData: Record<string, { transaction_number: string | null; cutoff_date: string | null; notes: string | null }> = {}
    try {
      const extras = await prisma.$queryRaw<{ id: string; transaction_number: string | null; cutoff_date: string | null; notes: string | null }[]>`
        SELECT id, transaction_number, cutoff_date, payout_date, notes FROM payouts WHERE id = ANY(${payouts.map(p => p.id)}::uuid[])
      `
      extras.forEach((e) => { extraData[e.id] = { transaction_number: e.transaction_number, cutoff_date: e.cutoff_date ? String(e.cutoff_date) : null, notes: e.notes } })
    } catch {
      // Columns don't exist yet — run migration SQL to add them
    }

    const enrichedPayouts = payouts.map((p) => ({ ...p, ...(extraData[p.id] || { transaction_number: null, cutoff_date: null, notes: null }) }))

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

    const payout = await prisma.payout.findUnique({
      where:  { id: payout_id },
      select: { id: true, status: true, amount: true, user_id: true },
    })
    if (!payout) {
      return NextResponse.json({ error: 'Payout not found.' }, { status: 404 })
    }
    if (payout.status !== 'pending') {
      return NextResponse.json({ error: 'Payout is already processed.' }, { status: 400 })
    }

    if (action === 'approve') {
      const txNumber = generateTransactionNumber()

      await prisma.$transaction(async (tx) => {
        // Update base fields
        await tx.payout.update({
          where: { id: payout_id },
          data:  { status: 'approved', approved_by: user.id, processed_at: new Date() },
        })
        // Update new columns via raw SQL
        try {
          await tx.$executeRaw`
            UPDATE payouts SET transaction_number = ${txNumber}, notes = ${notes || null}
            WHERE id = ${payout_id}
          `
        } catch { /* columns not migrated yet */ }
        // Deduct from wallet
        await tx.wallet.update({
          where: { user_id: payout.user_id },
          data:  {
            balance:         { decrement: Number(payout.amount) },
            total_withdrawn: { increment: Number(payout.amount) },
          },
        })
      })

      return NextResponse.json({ success: true, transaction_number: txNumber, message: 'Payout approved.' })
    }

    if (action === 'reject') {
      await prisma.payout.update({
        where: { id: payout_id },
        data:  { status: 'rejected', approved_by: user.id, processed_at: new Date() },
      })
      try {
        await prisma.$executeRaw`
          UPDATE payouts SET notes = ${notes || null} WHERE id = ${payout_id}
        `
      } catch { /* columns not migrated yet */ }
      return NextResponse.json({ success: true, message: 'Payout rejected.' })
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
  } catch (error) {
    console.error('[ADMIN PAYOUTS PATCH ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}