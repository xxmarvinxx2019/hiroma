import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { canAccessRewardStock, loadRewardStockWorkspace, parseRewardStockDispatch } from '@/app/lib/rewardStockReplacement'
import { UUID_PATTERN } from '@/app/lib/productRewardClaims'
import { boundedPage } from '@/app/lib/pagination'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!canAccessRewardStock(user) || !user) return NextResponse.json({ error: 'Inventory access is required.' }, { status: 403 })
    const data = await prisma.$transaction(tx => loadRewardStockWorkspace(tx, user, boundedPage(req.nextUrl.searchParams.get('page')), req.nextUrl.searchParams.get('search') || ''), { isolationLevel: 'RepeatableRead' })
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    console.error('[REWARD STOCK WORKSPACE]', error)
    return NextResponse.json({ error: 'Unable to load reward stock replacements. Check database setup and connection.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!canAccessRewardStock(user, true) || !user) return NextResponse.json({ error: 'Inventory management access is required.' }, { status: 403 })
    const actor = user.actor_id || user.id
    const body = await req.json()
    const result = await prisma.$transaction(async tx => {
      if (body.action === 'receive') {
        if (typeof body.dispatch_id !== 'string' || !UUID_PATTERN.test(body.dispatch_id)) throw new Error('Invalid replacement receipt.')
        const [shipment] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM reward_stock_dispatches WHERE id=${body.dispatch_id}::uuid AND recipient_id=${user.id} FOR UPDATE
        `
        if (!shipment) throw new Error('Only the recipient can confirm this replacement delivery.')
        const [existing] = await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM reward_stock_receipts WHERE dispatch_id=${body.dispatch_id}::uuid`
        if (existing) return { reference: `RR-${existing.id}`, replayed: true, action: 'received' }
        const [receipt] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO reward_stock_receipts(dispatch_id,actor_id) VALUES(${body.dispatch_id}::uuid,${actor}) RETURNING id::text
        `
        await createRequiredAuditLog(tx, { user_id: actor, user_name: user.actor_name || user.full_name,
          user_role: user.is_staff ? 'staff' : user.role, activity_type: 'reward_stock_replacement_received', category: 'product',
          description: `Confirmed physical receipt of reward stock shipment RS-${shipment.id}.`, metadata: { dispatch_id: shipment.id, receipt_id: receipt.id, owner_id: user.id },
          status: 'completed', ...getClientInfo(req) })
        return { reference: `RR-${receipt.id}`, action: 'received' }
      }
      if (body.action !== 'dispatch') throw new Error('Invalid replacement action.')
      const input = parseRewardStockDispatch(body)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'reward-stock-request:' + input.client_request_id}))`
      const [prior] = await tx.$queryRaw<{ id: string; supplier_id: string; recipient_id: string; actor_id: string; product_id: string; quantity: number; kind: string }[]>`
        SELECT id::text,supplier_id,recipient_id,actor_id,product_id,quantity,kind FROM reward_stock_dispatches WHERE client_request_id=${input.client_request_id}::uuid
      `
      if (prior) {
        if (prior.supplier_id !== user.id || prior.actor_id !== actor || prior.recipient_id !== input.recipient_id || prior.product_id !== input.product_id || prior.quantity !== input.quantity || prior.kind !== input.kind) {
          throw new Error('This dispatch reference belongs to a different stock replacement.')
        }
        return { reference: `RS-${prior.id}`, replayed: true, action: 'dispatched' }
      }
      const [shipment] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO reward_stock_dispatches(client_request_id,supplier_id,recipient_id,actor_id,product_id,kind,quantity)
        VALUES(${input.client_request_id}::uuid,${user.id},${input.recipient_id},${actor},${input.product_id},${input.kind},${input.quantity}) RETURNING id::text
      `
      await createRequiredAuditLog(tx, { user_id: actor, user_name: user.actor_name || user.full_name,
        user_role: user.is_staff ? 'staff' : user.role, activity_type: 'reward_stock_replacement_dispatched', category: 'product',
        description: `Dispatched ${input.quantity} reward replacement bottle(s). Reference RS-${shipment.id}.`,
        metadata: { dispatch_id: shipment.id, supplier_id: user.id, ...input }, status: 'completed', ...getClientInfo(req) })
      return { reference: `RS-${shipment.id}`, action: 'dispatched' }
    }, { timeout: 20000 })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const known = ['Invalid replacement dispatch.', 'Invalid replacement receipt.', 'Invalid replacement action.',
      'This dispatch reference belongs to a different stock replacement.', 'Only the recipient can confirm this replacement delivery.',
      'Only Hiroma or an authorized upstream supplier can replace this stock.', 'Replacement recipient is unavailable.', 'Replacement product is unavailable.',
      'Not enough available supplier stock.', 'Not enough pending replacement bottles.', 'Only the authorized recipient can confirm this delivery.', 'This replacement delivery was already received.']
    const detail = known.find(text => message.includes(text))
    if (detail) return NextResponse.json({ error: detail }, { status: detail.startsWith('Invalid') ? 400 : 409 })
    console.error('[REWARD STOCK ACTION]', error)
    return NextResponse.json({ error: 'Unable to complete stock replacement. Retry the same action/reference to avoid duplicate dispatch.' }, { status: 500 })
  }
}
