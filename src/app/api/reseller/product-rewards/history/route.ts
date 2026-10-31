import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getPackageRewardPolicy } from '@/app/lib/packageBinaryReward'
import { loadProductRewardHistory, rewardHistoryPagination } from '@/app/lib/productRewardHistory'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const pagination = rewardHistoryPagination(req.nextUrl.searchParams)
    const result = await prisma.$transaction(async tx => {
      if (!(await getPackageRewardPolicy(tx)).enabled) return { visible: false }
      const history = await loadProductRewardHistory(tx, { kind: 'reseller', userId: user.id }, pagination)
      return { visible: true, ...history }
    }, { isolationLevel: 'RepeatableRead' })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid history pagination.') {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[RESELLER REWARD HISTORY]', error)
    return NextResponse.json({ error: 'Unable to load Product Rewards history.' }, { status: 500 })
  }
}
