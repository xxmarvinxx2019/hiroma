import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { getSupportAttachmentUrl } from '@/app/lib/supportAttachment'

type SupportStaffTicketPermission = 'support_center:view' | 'support_center:reply'

async function accessTicket(id: string, requiredStaffPermission: SupportStaffTicketPermission) {
  const user = await getCurrentUser()
  if (!user) return null
  const ticket = await prisma.supportRequest.findUnique({ where: { id }, include: { submitter: { select: { full_name: true, username: true } }, attachments: true, messages: { orderBy: { created_at: 'asc' }, select: { id: true, author_name: true, author_role: true, message: true, created_at: true } } } })
  if (!ticket) return null
  const isAgent = Boolean(
    user.is_staff
    && user.permissions?.includes(requiredStaffPermission)
    && ticket.assigned_to === user.actor_id
  )
  const isAdmin = user.role === 'admin' && !user.is_staff
  const isOwner = user.role === 'reseller' && ticket.user_id === user.id
  if (!(isAdmin || isAgent || isOwner)) return null
  const attachments = await Promise.all(ticket.attachments.map(async attachment => ({ ...attachment, url: await getSupportAttachmentUrl(attachment.storage_path) })))
  return { user, ticket: { ...ticket, attachments }, isAdmin, isAgent, isOwner }
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const result = await accessTicket(id, 'support_center:view')
  if (!result) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 })
  const typing = result.ticket.status === 'resolved' ? [] : await prisma.supportTyping.findMany({ where: { request_id: id, actor_id: { not: result.user.actor_id || result.user.id }, expires_at: { gt: new Date() } }, select: { name: true } })
  return NextResponse.json({ ticket: result.ticket, typing }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await accessTicket(id, 'support_center:reply')
  if (!result) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 })
  const body = await request.json().catch(() => null)
  if (typeof body?.typing !== 'boolean') return NextResponse.json({ error: 'Invalid typing status.' }, { status: 400 })
  const actor_id = result.user.actor_id || result.user.id
  if (!body.typing || result.ticket.status === 'resolved') {
    await prisma.supportTyping.deleteMany({ where: { request_id: id, actor_id } })
  } else {
    const data = { name: result.isOwner ? result.user.full_name : 'Hiroma Support', expires_at: new Date(Date.now() + 5000) }
    await prisma.supportTyping.upsert({ where: { request_id_actor_id: { request_id: id, actor_id } }, create: { request_id: id, actor_id, ...data }, update: data })
  }
  return NextResponse.json({ success: true })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; const result = await accessTicket(id, 'support_center:reply')
    if (!result) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 })
    const { user, ticket, isAgent, isAdmin } = result; const body = await request.json()
    if (ticket.status === 'resolved') return NextResponse.json({ error: 'This ticket is permanently resolved. Create a new ticket for further assistance.' }, { status: 409 })
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 3000) : ''
    if (message.length < 2) return NextResponse.json({ error: 'Please enter a reply.' }, { status: 400 })
    const authorId = user.actor_id || user.id
    const duplicate = await prisma.supportMessage.findFirst({
      where: { request_id: ticket.id, author_id: authorId, message, created_at: { gte: new Date(Date.now() - 15_000) } },
      select: { id: true },
    })
    if (duplicate) return NextResponse.json({ error: 'This reply was already sent.' }, { status: 409 })
    await prisma.$transaction([
      prisma.supportTyping.deleteMany({ where: { request_id: ticket.id, actor_id: authorId } }),
      prisma.supportMessage.create({ data: { request_id: ticket.id, author_id: authorId, author_name: user.full_name, author_role: isAdmin ? 'admin' : isAgent ? 'support' : 'member', message } }),
      prisma.supportRequest.update({ where: { id: ticket.id }, data: { status: isAdmin || isAgent ? 'reviewing' : 'new' } }),
    ])
    return NextResponse.json({ success: true })
  } catch (error) { console.error('[SUPPORT REPLY POST]', error); return NextResponse.json({ error: 'Unable to send reply.' }, { status: 500 }) }
}
