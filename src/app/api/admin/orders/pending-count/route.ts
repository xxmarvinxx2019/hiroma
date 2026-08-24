import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pending = await prisma.order.count({
    where: {
      seller: { role: 'admin' },
      status: 'pending',
      buyer: { role: { in: ['regional', 'provincial', 'city', 'reseller'] } },
    },
  })

  return NextResponse.json({ pending })
}
