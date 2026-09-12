import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await prisma.pinRequest.updateMany({
    where: {
      status: 'pending',
      payment_due_at: { lt: new Date() },
      payment_status: { in: ['awaiting_payment', 'payment_rejected'] },
    },
    data: { status: 'expired', payment_status: 'expired' },
  })
  return NextResponse.json({ success: true, expired: result.count })
}
