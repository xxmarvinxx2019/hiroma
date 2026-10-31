import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { assertRewardClaimShift, hashRewardClaimProof, listClaimableRewardBottles, UUID_PATTERN } from '@/app/lib/productRewardClaims'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city' || (user.is_staff && !user.permissions?.includes('pos'))) return NextResponse.json({ error: 'POS access is required.' }, { status: 403 })
    const body = await req.json()
    if (typeof body.member_id !== 'string' || !/^HRM-\d{4}-\d{6}$/.test(body.member_id)
      || typeof body.terminal_id !== 'string' || !UUID_PATTERN.test(body.terminal_id)
      || typeof body.shift_id !== 'string' || !UUID_PATTERN.test(body.shift_id)) return NextResponse.json({ error: 'Scan a valid Member ID from an open POS shift.' }, { status: 400 })
    const actorId = user.actor_id || user.id
    const result = await prisma.$transaction(async tx => {
      await assertRewardClaimShift(tx, user.id, actorId, body.terminal_id, body.shift_id)
      const member = await tx.user.findFirst({ where: { member_id: body.member_id, role: 'reseller', status: 'active' },
        select: { id: true, member_id: true, full_name: true, username: true, two_factor_enabled: true, two_factor_pin_hash: true } })
      if (!member) throw new Error('Active reseller not found for this Member ID.')
      const products = await listClaimableRewardBottles(tx, member.id, user.id)
      const token = randomBytes(32).toString('base64url')
      const expires = new Date(Date.now() + 5 * 60 * 1000)
      await tx.$executeRaw`INSERT INTO product_reward_claim_proofs(token_hash,owner_id,actor_id,reseller_id,terminal_id,shift_id,expires_at)
        VALUES(${hashRewardClaimProof(token)},${user.id},${actorId},${member.id},${body.terminal_id}::uuid,${body.shift_id}::uuid,${expires})`
      return { member: { id: member.id, member_id: member.member_id, full_name: member.full_name, username: member.username },
        pin_ready: member.two_factor_enabled && Boolean(member.two_factor_pin_hash), products, scan_proof: token, expires_at: expires.toISOString() }
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('Open your own') || message.startsWith('Active reseller not found')) return NextResponse.json({ error: message }, { status: 409 })
    console.error('[REWARD CLAIM SCAN]', error)
    return NextResponse.json({ error: 'Unable to verify reward claim. Check database setup and connection.' }, { status: 500 })
  }
}
