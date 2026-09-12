import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

const OPEN_STATUSES = new Set(['pending', 'processing', 'ready_for_pickup'])
async function participantOrder(id: string, accountId: string) {
  return prisma.order.findFirst({ where: { id, OR: [{ buyer_id: accountId }, { seller_id: accountId }] }, select: {
    id: true, order_number: true, order_type: true, is_non_member_sale: true, buyer_id: true, seller_id: true, status: true,
    buyer: { select: { role: true } }, seller: { select: { role: true, distributor_profile: { select: { dist_level: true } } } },
  } })
}
function eligible(order: Awaited<ReturnType<typeof participantOrder>>) {
  return Boolean(order && order.order_type === 'online' && !order.is_non_member_sale && order.buyer.role === 'reseller' && order.seller.role === 'city' && ['city', 'branch'].includes(order.seller.distributor_profile?.dist_level || ''))
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const accountId = user.owner_id || user.id
  const { id } = await context.params
  const order = await participantOrder(id, accountId)
  if (!eligible(order)) return NextResponse.json({ error: 'Order conversation not found.' }, { status: 404 })
  const messages = await prisma.orderMessage.findMany({ where: { order_id: id }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }], take: 500, select: { id: true, sender_id: true, sender_name: true, sender_role: true, message: true, created_at: true } })
  return NextResponse.json({ messages, closed: !OPEN_STATUSES.has(order!.status), status: order!.status, accountId })
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const accountId = user.owner_id || user.id
    const actorId = user.actor_id || user.id
    const { id } = await context.params
    const order = await participantOrder(id, accountId)
    if (!eligible(order)) return NextResponse.json({ error: 'Order conversation not found.' }, { status: 404 })
    if (!OPEN_STATUSES.has(order!.status)) return NextResponse.json({ error: 'This order conversation is closed.' }, { status: 409 })
    const body = await req.json().catch(() => ({}))
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message || message.length > 2000) return NextResponse.json({ error: 'Message must contain 1 to 2,000 characters.' }, { status: 400 })
    const duplicate = await prisma.orderMessage.findFirst({ where: { order_id: id, sender_id: actorId, message, created_at: { gte: new Date(Date.now() - 15_000) } }, select: { id: true } })
    if (duplicate) return NextResponse.json({ error: 'This message was already sent.' }, { status: 409 })
    const recipientId = accountId === order!.buyer_id ? order!.seller_id : order!.buyer_id
    const created = await prisma.$transaction(async tx => {
      const fresh = await tx.order.findUnique({ where: { id }, select: { status: true } })
      if (!fresh || !OPEN_STATUSES.has(fresh.status)) throw new Error('ORDER_CHAT_CLOSED')
      const row = await tx.orderMessage.create({ data: { order_id: id, sender_id: actorId, sender_name: user.actor_name || user.full_name, sender_role: accountId === order!.buyer_id ? 'reseller' : order!.seller.distributor_profile!.dist_level, message } })
      await tx.notification.create({ data: { user_id: recipientId, type: 'order_message', title: `New message for ${order!.order_number || 'your order'}`, message: `${user.actor_name || user.full_name}: ${message.slice(0, 180)}`, entity_type: 'order', entity_id: id, action_url: accountId === order!.buyer_id ? '/dashboard/city/orders' : '/dashboard/reseller/orders' } })
      return row
    })
    return NextResponse.json({ message: created }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && (error.message.includes('ORDER_CHAT_CLOSED') || error.message.includes('Order conversation is closed'))) return NextResponse.json({ error: 'This order conversation is already closed.' }, { status: 409 })
    console.error('[ORDER MESSAGE POST ERROR]', error)
    return NextResponse.json({ error: 'Unable to send the order message.' }, { status: 500 })
  }
}
