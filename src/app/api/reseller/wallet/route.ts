import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { getCutoffDays, getNextCutoffDate, getPayoutDateMap, getPayoutDateFromCutoff } from '@/app/api/admin/settings/route'
import prisma from '@/app/lib/prisma'

// ── GET wallet balance + commission history + payout history ──
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = req.nextUrl
    const page     = Math.max(1, parseInt(searchParams.get('page')     || '1'))
    const pageSize = Math.max(1, parseInt(searchParams.get('pageSize') || '10'))
    const tab      = searchParams.get('tab') || 'commissions' // commissions | payouts

    const [wallet, commissionSummary, payouts, commissions, totalCount] = await Promise.all([

      // Wallet
      prisma.wallet.findUnique({
        where: { user_id: user.id },
        select: { balance: true, total_earned: true, total_withdrawn: true },
      }),

      // Commission totals by type
      prisma.commission.groupBy({
        by: ['type'],
        where: { user_id: user.id },
        _sum:   { amount: true },
        _count: { type: true },
      }),

      // Payout history
      tab === 'payouts' ? prisma.payout.findMany({
        where:   { user_id: user.id },
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
        },
      }) : Promise.resolve([]),

      // Commission history
      tab === 'commissions' ? prisma.commission.findMany({
        where:   { user_id: user.id },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id:               true,
          type:             true,
          amount:           true,
          points:           true,
          is_pair_overflow: true,
          created_at:       true,
          source_user: { select: { full_name: true, username: true } },
        },
      }) : Promise.resolve([]),

      // Total count for pagination
      tab === 'commissions'
        ? prisma.commission.count({ where: { user_id: user.id } })
        : prisma.payout.count({ where: { user_id: user.id } }),
    ])

    // Shape commission summary
    const summary = {
      direct_referral: { amount: 0, count: 0 },
      binary_pairing:  { amount: 0, count: 0 },
      multilevel:      { amount: 0, count: 0 },
      sponsor_point:   { amount: 0, count: 0 },
    }
    for (const row of commissionSummary) {
      summary[row.type as keyof typeof summary] = {
        amount: Number(row._sum.amount || 0),
        count:  row._count.type,
      }
    }

    // Fetch new payout columns via raw SQL (safe if not migrated yet)
    let enrichedPayouts = payouts
    if (tab === 'payouts' && payouts.length > 0) {
      try {
        const ids = payouts.map((p: any) => p.id)
        const extras = await prisma.$queryRaw<{ id: string; transaction_number: string | null; cutoff_date: string | null; payout_date: string | null; notes: string | null }[]>`
          SELECT id, transaction_number, cutoff_date, payout_date, notes FROM payouts WHERE id::text = ANY(${ids})
        `
        const extraMap: Record<string, any> = {}
        extras.forEach((e) => { extraMap[e.id] = e })
        enrichedPayouts = payouts.map((p: any) => ({
          ...p,
          ...(extraMap[p.id] || { transaction_number: null, cutoff_date: null, payout_date: null, notes: null }),
        }))
      } catch { /* columns not migrated yet — return payouts without extra fields */ }
    }

    return NextResponse.json({
      wallet: {
        balance:         Number(wallet?.balance         || 0),
        total_earned:    Number(wallet?.total_earned    || 0),
        total_withdrawn: Number(wallet?.total_withdrawn || 0),
      },
      commission_summary: summary,
      commissions,
      payouts,
      meta: {
        total:      totalCount,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      },
    })
  } catch (error) {
    console.error('[RESELLER WALLET GET ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}

// ── POST request a payout ──
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { amount, payment_method, payment_reference } = await req.json()

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return NextResponse.json({ error: 'Invalid amount.' }, { status: 400 })
    }
    if (parseFloat(amount) < 500) {
      return NextResponse.json({ error: 'Minimum payout request is ₱500.00.' }, { status: 400 })
    }

    if (!payment_method?.trim()) {
      return NextResponse.json({ error: 'Payment method is required.' }, { status: 400 })
    }

    // Check wallet balance
    const wallet = await prisma.wallet.findUnique({
      where: { user_id: user.id },
      select: { balance: true },
    })

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found.' }, { status: 404 })
    }

    const requestedAmount = parseFloat(amount)
    if (requestedAmount > Number(wallet.balance)) {
      return NextResponse.json({ error: 'Insufficient balance.' }, { status: 400 })
    }

    // Check no pending payout already exists
    const existingPending = await prisma.payout.findFirst({
      where: { user_id: user.id, status: 'pending' },
    })
    if (existingPending) {
      return NextResponse.json({
        error: 'You already have a pending payout request. Please wait for it to be processed.',
      }, { status: 400 })
    }

    // Compute next cutoff and payout dates from admin settings
    const cutoffDays    = await getCutoffDays()
    const payoutDateMap = await getPayoutDateMap()
    const cutoffDate    = getNextCutoffDate(cutoffDays)
    const payoutDate    = getPayoutDateFromCutoff(cutoffDate, payoutDateMap, cutoffDays)
    console.log('[WALLET] cutoffDays:', cutoffDays)
    console.log('[WALLET] payoutDateMap:', payoutDateMap)
    console.log('[WALLET] cutoffDate:', cutoffDate)
    console.log('[WALLET] payoutDate:', payoutDate)

    // Create payout — do NOT deduct balance here
    // Balance is deducted only when admin approves the payout
    const payout = await prisma.payout.create({
      data: {
        user_id:           user.id,
        amount:            requestedAmount,
        status:            'pending',
        payment_method:    payment_method.trim(),
        payment_reference: payment_reference?.trim() || null,
      },
    })

    // Set cutoff_date and payout_date via raw SQL
    console.log('[WALLET] payout.id:', payout.id)
    console.log('[WALLET] cutoffDate to save:', cutoffDate)
    console.log('[WALLET] payoutDate to save:', payoutDate)
    try {
      const updateResult = await prisma.$executeRaw`
        UPDATE payouts SET cutoff_date = ${cutoffDate}, payout_date = ${payoutDate} WHERE id::text = ${payout.id}
      `
      console.log('[WALLET] UPDATE result (rows affected):', updateResult)
    } catch (e) {
      console.error('[WALLET] cutoff/payout date update FAILED:', e)
    }

    // Verify it was saved
    try {
      const verify = await prisma.$queryRaw<any[]>`
        SELECT id, cutoff_date, payout_date FROM payouts WHERE id::text = ${payout.id}
      `
      console.log('[WALLET] Verified saved payout:', verify)
    } catch (e) {
      console.error('[WALLET] Verify query failed:', e)
    }

    return NextResponse.json({
      success: true,
      payout,
      debug: {
        cutoffDays,
        payoutDateMap,
        cutoffDate,
        payoutDate,
      }
    })
  } catch (error) {
    console.error('[RESELLER WALLET POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}