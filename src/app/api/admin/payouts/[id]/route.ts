import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const { status, payment_method, payment_reference } = await req.json()

    if (!['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }

    // ── Get payout details ──
    const payout = await prisma.payout.findUnique({
      where: { id },
      select: {
        id: true,
        amount: true,
        status: true,
        user_id: true,
      },
    })

    if (!payout) {
      return NextResponse.json({ error: 'Payout not found.' }, { status: 404 })
    }

    if (payout.status !== 'pending') {
      return NextResponse.json(
        { error: 'This payout has already been processed.' },
        { status: 400 }
      )
    }

    if (status === 'approved') {
      // ── Approve: deduct from wallet + mark as approved ──
      await prisma.$transaction(async (tx) => {

        // 1. Deduct from wallet
        await tx.wallet.update({
          where: { user_id: payout.user_id },
          data: {
            balance: { decrement: payout.amount },
            total_withdrawn: { increment: payout.amount },
          },
        })

        // 2. Mark payout as approved
        await tx.payout.update({
          where: { id },
          data: {
            status: 'approved',
            payment_method: payment_method || null,
            payment_reference: payment_reference || null,
            approved_by: user.id,
            processed_at: new Date(),
          },
        })
      })
    } else {
      // ── Reject: just mark as rejected, no wallet change ──
      await prisma.payout.update({
        where: { id },
        data: {
          status: 'rejected',
          approved_by: user.id,
          processed_at: new Date(),
        },
      })
    }

    return NextResponse.json({
      success: true,
      message: `Payout ${status} successfully.`,
    })
  } catch (error) {
    console.error('[PAYOUT ACTION ERROR]', error)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}