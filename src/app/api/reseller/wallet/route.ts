import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { getCutoffDays, getNextCutoffDate, getPayoutDateMap, getPayoutDateFromCutoff } from '@/app/api/admin/settings/route'
import prisma from '@/app/lib/prisma'
import { getResellerPayoutMode } from '@/app/lib/resellerPayoutPolicy'
import {
  getSensitiveResellerPinFailure,
  isSensitiveResellerPinAccepted,
  verifyResellerSecurityPin,
} from '@/app/lib/resellerSecurityPin'
import { CommissionType } from '@prisma/client'
import { InsufficientPayoutFundsError, lockPayoutRequestsForUser, reservePayoutFunds } from '@/app/lib/payoutFunds'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

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
    const requestedDate = searchParams.get('date')
    const requestedCommissionType = searchParams.get('commissionType')
    const commissionType = requestedCommissionType && Object.values(CommissionType).includes(requestedCommissionType as CommissionType)
      ? requestedCommissionType as CommissionType
      : null
    const validDate = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : null
    // Use Manila calendar-day boundaries so a reseller selecting Aug 4 sees
    // precisely the credits made on Aug 4 in the application timezone.
    const dateRange = validDate
      ? {
          gte: new Date(`${validDate}T00:00:00.000+08:00`),
          lt: new Date(new Date(`${validDate}T00:00:00.000+08:00`).getTime() + 24 * 60 * 60 * 1000),
        }
      : undefined
    const commissionWhere = {
      user_id: user.id,
      ...(commissionType ? { type: commissionType } : {}),
      ...(dateRange ? { created_at: dateRange } : {}),
    }
    const payoutHistoryWhere = {
      user_id: user.id,
      ...(dateRange ? { requested_at: dateRange } : {}),
    }

    const [wallet, commissionSummary, payouts, commissions, allCommissionCredits, totalCount, creditsThroughDate, releasedThroughDate, releasedOnDate] = await Promise.all([

      // Wallet
      prisma.wallet.findUnique({
        where: { user_id: user.id },
        select: { balance: true, reserved_balance: true, total_earned: true, total_withdrawn: true },
      }),

      // Commission totals by type
      prisma.commission.groupBy({
        by: ['type'],
        where: { user_id: user.id, ...(dateRange ? { created_at: dateRange } : {}) },
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
          transaction_number: true,
          cutoff_date:        true,
          payout_date:        true,
          notes:              true,
          requested_at:       true,
          processed_at:       true,
        },
      }) : Promise.resolve([]),

      // Commission history
      tab === 'commissions' ? prisma.commission.findMany({
        where:   commissionWhere,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
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

      // The complete credit ledger lets each paginated commission row show the
      // balance immediately after that credit, rather than only the live balance.
      tab === 'commissions' ? prisma.commission.findMany({
        where:   { user_id: user.id },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        select:  { id: true, amount: true },
      }) : Promise.resolve([]),

      // Total count for pagination
      tab === 'commissions'
        ? prisma.commission.count({ where: commissionWhere })
        : prisma.payout.count({ where: payoutHistoryWhere }),

      // A chosen day makes the balance a historical snapshot at the end of
      // that Manila day, while earnings and withdrawals are for that day.
      dateRange
        ? prisma.commission.aggregate({
            where: { user_id: user.id, created_at: { lt: dateRange.lt } },
            _sum: { amount: true },
          })
        : Promise.resolve(null),
      dateRange
        ? prisma.payout.aggregate({
            where: { user_id: user.id, status: 'released', released_at: { lt: dateRange.lt } },
            _sum: { amount: true },
          })
        : Promise.resolve(null),
      dateRange
        ? prisma.payout.aggregate({
            where: { user_id: user.id, status: 'released', released_at: dateRange },
            _sum: { amount: true },
          })
        : Promise.resolve(null),
    ])

    const balanceAfterCredit = new Map<string, number>()
    let runningCreditBalance = 0
    for (const credit of allCommissionCredits) {
      runningCreditBalance += Number(credit.amount)
      balanceAfterCredit.set(credit.id, runningCreditBalance)
    }

    const commissionsWithBalances = commissions.map((commission) => ({
      ...commission,
      balance_after_credit: balanceAfterCredit.get(commission.id) || 0,
    }))

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

    const selectedDateWallet = dateRange
      ? {
          balance: Number(creditsThroughDate?._sum.amount || 0) - Number(releasedThroughDate?._sum.amount || 0),
          total_earned: commissionSummary.reduce((total, row) => total + Number(row._sum.amount || 0), 0),
          total_withdrawn: Number(releasedOnDate?._sum.amount || 0),
        }
      : null

    return NextResponse.json({
      wallet: {
        balance:         selectedDateWallet?.balance ?? Number(wallet?.balance || 0),
        reserved_balance: selectedDateWallet ? 0 : Number(wallet?.reserved_balance || 0),
        available_balance: selectedDateWallet?.balance ?? (Number(wallet?.balance || 0) - Number(wallet?.reserved_balance || 0)),
        total_earned:    selectedDateWallet?.total_earned ?? Number(wallet?.total_earned || 0),
        total_withdrawn: selectedDateWallet?.total_withdrawn ?? Number(wallet?.total_withdrawn || 0),
      },
      commission_summary: summary,
      commissions: commissionsWithBalances,
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

    const { amount, payment_method, payment_reference, security_pin } = await req.json()
    const pinVerification = await verifyResellerSecurityPin(user.id, security_pin)
    if (!isSensitiveResellerPinAccepted(pinVerification)) {
      const failure = getSensitiveResellerPinFailure(pinVerification)
      return NextResponse.json({ error: failure.error }, { status: failure.status })
    }
    const payoutMode = await getResellerPayoutMode()

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return NextResponse.json({ error: 'Invalid amount.' }, { status: 400 })
    }
    if (parseFloat(amount) < 500) {
      return NextResponse.json({ error: 'Minimum payout request is ₱500.00.' }, { status: 400 })
    }

    let resolvedMethod = payoutMode === 'cash' ? 'Cash' : payoutMode === 'check' ? 'Check' : ''
    let resolvedReference: string | null = payoutMode === 'account' ? null : user.full_name
    if (payoutMode === 'account') {
      const approved = await prisma.paymentMethod.findFirst({
        where: { id: payment_method, user_id: user.id, status: 'approved' },
      })
      if (!approved) {
        return NextResponse.json({ error: 'Select an approved payout account.' }, { status: 400 })
      }
      resolvedMethod = approved.type === 'gcash' ? 'GCash' : approved.bank_name || 'Bank Transfer'
      resolvedReference = `${approved.account_name} · ${approved.account_number}`
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

    // Compute next cutoff and payout dates from admin settings
    const cutoffDays    = await getCutoffDays()
    const payoutDateMap = await getPayoutDateMap()
    const cutoffDate    = getNextCutoffDate(cutoffDays)
    const payoutDate    = getPayoutDateFromCutoff(cutoffDate, payoutDateMap, cutoffDays)
    // Create payout — do NOT deduct balance here
    // Balance is deducted only when admin approves the payout
    const payout = await prisma.$transaction(async (tx) => {
      await lockPayoutRequestsForUser(tx, user.id)
      const existingPending = await tx.payout.findFirst({
        where: { user_id: user.id, status: 'pending' },
        select: { id: true },
      })
      if (existingPending) throw new Error('PENDING_PAYOUT_EXISTS')
      const created = await tx.payout.create({ data: {
        user_id:           user.id,
        amount:            requestedAmount,
        status:            'pending',
        payment_method:    resolvedMethod,
        payment_reference: resolvedReference || payment_reference?.trim() || null,
        cutoff_date:       cutoffDate,
        payout_date:       payoutDate,
      } })
      await reservePayoutFunds(tx, created.id, user.id, requestedAmount)
      await createRequiredAuditLog(tx, {
        user_id: user.id,
        user_name: user.full_name || user.username,
        user_role: user.role,
        member_id: formatMemberId(user.id, user.role),
        activity_type: 'payout_requested',
        category: 'payout',
        description: `Requested a source-backed payout of ₱${requestedAmount.toFixed(2)}.`,
        metadata: { payout_id: created.id, reseller_id: user.id, amount: requestedAmount, payment_method: resolvedMethod },
        ...getClientInfo(req),
        risk_level: 'medium',
        status: 'completed',
      })
      return created
    })

    return NextResponse.json({
      success: true,
      payout,
    })
  } catch (error) {
    if (error instanceof InsufficientPayoutFundsError) {
      return NextResponse.json({ error: 'Insufficient available balance. Existing payouts may have reserved part of your wallet.' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'PENDING_PAYOUT_EXISTS') {
      return NextResponse.json({ error: 'You already have a pending payout request. Please wait for it to be processed.' }, { status: 409 })
    }
    console.error('[RESELLER WALLET POST ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
