import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { deleteExpiredResolvedSupportTickets } from '@/app/lib/supportRetention'

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'reseller') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    await deleteExpiredResolvedSupportTickets(user.id)
    const tickets = await prisma.supportRequest.findMany({ where: { user_id: user.id }, orderBy: { updated_at: 'desc' }, include: { assignee: { select: { full_name: true } }, messages: { orderBy: { created_at: 'asc' }, select: { id: true, author_name: true, author_role: true, message: true, created_at: true } } } })
    return NextResponse.json({ tickets })
  } catch (error) {
    console.error('[RESELLER SUPPORT TICKETS]', error)
    return NextResponse.json({ error: 'Unable to load support tickets.' }, { status: 500 })
  }
}
