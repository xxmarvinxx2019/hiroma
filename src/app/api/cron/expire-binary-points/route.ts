import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'

export const maxDuration = 60
const MEMBER_BATCH_SIZE = 10_000
const WRITE_BATCH_SIZE = 1_000

type DueLot = {
  id: string
  recipient_user_id: string
  leg: 'left' | 'right'
  remaining_points: number
  generated_at: Date
  expires_at: Date
  expiry_years: number
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('binary-point-expiry-policy'))`
    const users = await tx.$queryRaw<{ recipient_user_id: string }[]>`
      SELECT DISTINCT recipient_user_id
      FROM binary_point_lots
      WHERE remaining_points>0 AND expires_at<=${now}
      ORDER BY recipient_user_id
      LIMIT ${MEMBER_BATCH_SIZE}
    `
    const userIds = users.map((row) => row.recipient_user_id)
    if (userIds.length === 0) return { members: 0, lots: 0, left: 0, right: 0 }

    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext('binary:' || user_id))
      FROM unnest(${userIds}::text[]) AS user_id
      ORDER BY user_id
    `
    const lots = await tx.$queryRaw<DueLot[]>`
      SELECT id::text,recipient_user_id,leg,remaining_points,generated_at,expires_at,expiry_years
      FROM binary_point_lots
      WHERE recipient_user_id=ANY(${userIds}::text[])
        AND remaining_points>0
        AND expires_at<=${now}
      ORDER BY recipient_user_id,expires_at,id
      FOR UPDATE
    `
    const totals = new Map<string, { user_id: string; left_points: number; right_points: number }>()
    for (const lot of lots) {
      const row = totals.get(lot.recipient_user_id) || { user_id: lot.recipient_user_id, left_points: 0, right_points: 0 }
      if (lot.leg === 'left') row.left_points += Number(lot.remaining_points)
      else row.right_points += Number(lot.remaining_points)
      totals.set(lot.recipient_user_id, row)
    }

    for (let index = 0; index < lots.length; index += WRITE_BATCH_SIZE) {
      const batch = lots.slice(index, index + WRITE_BATCH_SIZE)
      await tx.binaryPointExpiration.createMany({
        data: batch.map((lot) => ({
          point_lot_id: lot.id,
          recipient_user_id: lot.recipient_user_id,
          leg: lot.leg,
          points: Number(lot.remaining_points),
          generated_at: lot.generated_at,
          scheduled_at: lot.expires_at,
          expired_at: now,
          expiry_years: lot.expiry_years,
        })),
      })
      const changed = await tx.binaryPointLot.updateMany({
        where: { id: { in: batch.map((lot) => lot.id) }, remaining_points: { gt: 0 } },
        data: { remaining_points: 0 },
      })
      if (changed.count !== batch.length) throw new Error('A binary point lot changed during expiration.')
    }

    const totalsJson = JSON.stringify([...totals.values()])
    const updated = await tx.$executeRaw`
      WITH expired AS (
        SELECT * FROM jsonb_to_recordset(${totalsJson}::jsonb)
          AS row(user_id text,left_points integer,right_points integer)
      )
      UPDATE reseller_profiles profile
      SET left_points=COALESCE(profile.left_points,0)-expired.left_points,
          right_points=COALESCE(profile.right_points,0)-expired.right_points
      FROM expired
      WHERE profile.user_id=expired.user_id
        AND COALESCE(profile.left_points,0)>=expired.left_points
        AND COALESCE(profile.right_points,0)>=expired.right_points
    `
    if (updated !== totals.size) throw new Error('Expired point lots do not reconcile with aggregate carryover balances.')
    return {
      members: totals.size,
      lots: lots.length,
      left: [...totals.values()].reduce((sum, row) => sum + row.left_points, 0),
      right: [...totals.values()].reduce((sum, row) => sum + row.right_points, 0),
    }
  }, { timeout: 55_000 })

  return NextResponse.json({
    success: true,
    members_processed: result.members,
    expired_lots: result.lots,
    expired_left_points: result.left,
    expired_right_points: result.right,
    has_more: result.members === MEMBER_BATCH_SIZE,
  })
}
