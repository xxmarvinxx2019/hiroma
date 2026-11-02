import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { loadPackageBinaryDailyCaps } from '@/app/lib/packageBinaryDailyCap'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const requestedPage = Number(req.nextUrl.searchParams.get('page') || 1)
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1000000) : 1
  try {
    const result = await prisma.$transaction(async tx => {
      const [cap] = await loadPackageBinaryDailyCaps(tx, [user.id])
      const events = await tx.binaryPairEvent.findMany({
        where: { recipient_user_id: user.id }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: (page - 1) * 10, take: 11,
        select: { id: true, created_at: true, source_kind: true, source_event_id: true, source_leg: true,
          source_points: true, source_points_flushed: true, cap_session: true, cap_mode: true, cap_cutoff: true, cap_policy_id: true, carryover_policy_id: true, session_flushed_points: true, carryover_flushed_points: true, carryover_cap_enabled: true, carryover_cap_points: true, payable_pairs: true, product_reward_pairs: true },
      })
      const balance=await tx.resellerProfile.findUnique({where:{user_id:user.id},select:{left_points:true,right_points:true}})
      const used = Number(cap?.used_session ?? 0), dailyUsed = Number(cap?.used_today ?? 0)
      const remaining = cap?.enabled === false ? null : Math.max(0, Math.min(Number(cap?.session_cap ?? 5) - used, Number(cap?.cap ?? 10) - dailyUsed))
      return { carryover: {enabled:cap?.carryover_enabled??false,max_points:cap?.carryover_limit??180000,left_points:balance?.left_points??0,right_points:balance?.right_points??0},mode: cap?.mode ?? 'two_sessions', cutoff: cap?.cutoff ?? null, session: cap?.session ?? 1, session_cap: cap?.session_cap ?? 5, daily_cap: cap?.cap ?? 10,
        used_session: used, used_today: dailyUsed, remaining, closed: remaining === 0,
        events: events.slice(0, 10), page, has_more: events.length > 10 }
    }, { isolationLevel: 'RepeatableRead' })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[PACKAGE BINARY ACTIVITY]', error)
    return NextResponse.json({ error: 'Unable to load Package Binary activity.' }, { status: 500 })
  }
}
