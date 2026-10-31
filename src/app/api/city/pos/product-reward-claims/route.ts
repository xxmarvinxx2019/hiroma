import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { parseRewardClaim, findRewardClaimReplay, hashRewardClaimProof, claimReceipt, type ClaimReceipt } from '@/app/lib/productRewardClaims'
import { verifyResellerSecurityPin, isSensitiveResellerPinAccepted, getSensitiveResellerPinFailure } from '@/app/lib/resellerSecurityPin'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'

export async function POST(req: NextRequest) {
  let input: ReturnType<typeof parseRewardClaim> | undefined
  let ownerId = '', actorId = ''
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city' || (user.is_staff && !user.permissions?.includes('pos'))) return NextResponse.json({ error: 'POS access is required.' }, { status: 403 })
    const body = await req.json()
    input = parseRewardClaim(body)
    ownerId = user.id; actorId = user.actor_id || user.id
    const replay = await findRewardClaimReplay(prisma, input, ownerId, actorId)
    if (replay) return NextResponse.json({ receipt: replay, replayed: true })
    const [proof] = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM product_reward_claim_proofs WHERE token_hash=${hashRewardClaimProof(input.scan_proof)}
        AND owner_id=${ownerId} AND actor_id=${actorId} AND reseller_id=${input.reseller_id}
        AND terminal_id=${input.terminal_id}::uuid AND shift_id=${input.shift_id}::uuid
        AND used_at IS NULL AND expires_at>clock_timestamp()
    `
    if (!proof) return NextResponse.json({ error: 'Scan the reseller Member ID again for this claim.' }, { status: 409 })
    // Verify outside the release transaction: incorrect attempts and lockouts
    // must persist even though no stock/claim is committed.
    const pin = await verifyResellerSecurityPin(input.reseller_id, body.security_pin)
    if (!isSensitiveResellerPinAccepted(pin)) {
      const failure = getSensitiveResellerPinFailure(pin)
      return NextResponse.json({ error: failure.error }, { status: failure.status })
    }
    const claim = input
    const receipt = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'reward-claim-request:' + claim.client_request_id}))`
      const repeated = await findRewardClaimReplay(tx, claim, ownerId, actorId)
      if (repeated) return repeated
      const [row] = await tx.$queryRaw<ClaimReceipt[]>`
        INSERT INTO product_reward_claims(client_request_id,proof_id,owner_id,actor_id,reseller_id,product_id,terminal_id,shift_id,quantity)
        VALUES(${claim.client_request_id}::uuid,${proof.id}::uuid,${ownerId},${actorId},${claim.reseller_id},${claim.product_id},${claim.terminal_id}::uuid,${claim.shift_id}::uuid,${claim.quantity})
        RETURNING id::text,client_request_id::text,reseller_id,product_id,quantity,product_name_snapshot product_name,
          outlet_name_snapshot outlet_name,actor_name_snapshot cashier_name,stock_after,released_at
      `
      const [stock] = await tx.$queryRaw<{ available_stock: number }[]>`
        SELECT GREATEST(0,quantity-reserved_quantity)::int available_stock FROM inventory
        WHERE owner_id=${ownerId} AND product_id=${claim.product_id}
      `
      row.available_stock = stock.available_stock
      await createRequiredAuditLog(tx, { user_id: actorId, user_name: user.actor_name || user.full_name,
        user_role: user.is_staff ? 'staff' : 'city', activity_type: 'product_reward_claim_released', category: 'product',
        description: `Released ${claim.quantity} earned reward bottle(s). Reference RC-${row.id}.`,
        metadata: { claim_id: row.id, owner_id: ownerId, reseller_id: claim.reseller_id, product_id: claim.product_id, quantity: claim.quantity },
        status: 'completed', ...getClientInfo(req) })
      return claimReceipt(row)
    }, { timeout: 20000 })
    return NextResponse.json({ receipt })
  } catch (error) {
    if (input && ownerId) {
      try {
        const replay = await findRewardClaimReplay(prisma, input, ownerId, actorId)
        if (replay) return NextResponse.json({ receipt: replay, replayed: true })
      } catch { /* A conflicting request must not reveal another receipt. */ }
    }
    const message = error instanceof Error ? error.message : ''
    if (message === 'Invalid reward claim.') return NextResponse.json({ error: message }, { status: 400 })
    const known = ['Not enough unclaimed reward bottles.', 'Not enough available outlet stock.', 'Scan the reseller Member ID again for this claim.',
      'Open your own cashier shift before releasing rewards.', 'An authorized POS cashier is required.', 'Active reseller not found.', 'POS terminal is unavailable.',
      'An active branch or city outlet is required.', 'This claim reference was already used for a different release.']
    const detail = known.find(text => message.includes(text))
    if (detail) return NextResponse.json({ error: detail }, { status: 409 })
    console.error('[REWARD CLAIM RELEASE]', error)
    return NextResponse.json({ error: 'Unable to complete reward release. Retry with the same claim reference; stock is deducted only once.' }, { status: 500 })
  }
}
