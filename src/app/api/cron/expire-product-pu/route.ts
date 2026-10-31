import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/app/lib/prisma'
import { expireProductPu } from '@/app/lib/productBinaryExpiry'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const users = await prisma.$queryRaw<{ recipient_user_id: string }[]>`
      SELECT DISTINCT recipient_user_id FROM product_binary_pu_lots
      WHERE remaining_pu>0 AND expires_at<=CURRENT_TIMESTAMP
      ORDER BY recipient_user_id LIMIT 500
    `
    for (const user of users) {
      await prisma.$transaction(tx => expireProductPu(tx, user.recipient_user_id))
    }
    return NextResponse.json({ success: true, members: users.length, more_possible: users.length === 500 })
  } catch (error) {
    console.error('[PRODUCT PU EXPIRY]', error)
    return NextResponse.json({ error: 'Product PU expiry failed.' }, { status: 500 })
  }
}
