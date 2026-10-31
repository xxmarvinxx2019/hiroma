import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { loadProductRewardHistory, rewardHistoryPagination } from '@/app/lib/productRewardHistory'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'admin' || user.is_staff === true) {
      return NextResponse.json({ error: 'Admin owner access is required.' }, { status: 403 })
    }
    const pagination = rewardHistoryPagination(req.nextUrl.searchParams)
    const history = await prisma.$transaction(tx => loadProductRewardHistory(tx, {
      kind: 'admin', search: req.nextUrl.searchParams.get('search') || '',
    }, pagination), { isolationLevel: 'RepeatableRead' })
    return NextResponse.json({ visible: true, ...history }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid history pagination.') {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[ADMIN REWARD HISTORY]', error)
    return NextResponse.json({ error: 'Unable to load Product Rewards history.' }, { status: 500 })
  }
}
