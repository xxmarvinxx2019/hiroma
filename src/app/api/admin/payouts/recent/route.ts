import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payouts = await prisma.payout.findMany({
      where: { status: 'pending' },
      orderBy: { requested_at: 'desc' },
      take: 5,
      select: {
        id: true,
        amount: true,
        requested_at: true,
        payment_method: true,
        user: {
          select: {
            full_name: true,
            username: true,
          },
        },
      },
    })

    return NextResponse.json({ payouts })
  } catch (error) {
    console.error('[RECENT PAYOUTS ERROR]', error)
    return NextResponse.json(
      { error: 'Something went wrong.' },
      { status: 500 }
    )
  }
}