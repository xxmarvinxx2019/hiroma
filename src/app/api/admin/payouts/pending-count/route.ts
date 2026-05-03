import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ count: 0 })
    }

    const count = await prisma.payout.count({
      where: { status: 'pending' },
    })

    return NextResponse.json({ count })
  } catch (error) {
    console.error('[PENDING COUNT ERROR]', error)
    return NextResponse.json({ count: 0 })
  }
}