import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'

async function getOwner() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city' || user.is_staff) return null
  return user
}

export async function GET() {
  const owner = await getOwner()
  if (!owner) return NextResponse.json({ error: 'Owner access required.' }, { status: 403 })
  const terminals = await prisma.posTerminal.findMany({
    where: { owner_id: owner.id }, orderBy: { updated_at: 'desc' },
    select: { id: true, name: true, receipt_code: true, platform: true, is_active: true, last_synced_at: true, created_at: true, updated_at: true,
      shifts: { orderBy: { opened_at: 'desc' }, take: 1, select: { status: true, opened_at: true } } },
  })
  return NextResponse.json({ terminals })
}

export async function PATCH(req: NextRequest) {
  try {
    const owner = await getOwner()
    if (!owner) return NextResponse.json({ error: 'Owner access required.' }, { status: 403 })
    const body = await req.json()
    const terminalId = typeof body.terminal_id === 'string' ? body.terminal_id : ''
    const action = body.action === 'deactivate' || body.action === 'reactivate' ? body.action : null
    if (!terminalId || !action) return NextResponse.json({ error: 'A valid terminal and action are required.' }, { status: 400 })
    const desiredActive = action === 'reactivate'
    const current = await prisma.posTerminal.findFirst({ where: { id: terminalId, owner_id: owner.id }, select: { id: true, name: true, receipt_code: true, is_active: true } })
    if (!current) return NextResponse.json({ error: 'POS device not found.' }, { status: 404 })
    if (current.is_active === desiredActive) return NextResponse.json({ success: true, unchanged: true })
    const { ip_address, device } = getClientInfo(req)
    await prisma.$transaction(async (tx) => {
      const updated = await tx.posTerminal.updateMany({ where: { id: terminalId, owner_id: owner.id, is_active: current.is_active }, data: { is_active: desiredActive } })
      if (updated.count !== 1) throw new Error('POS terminal state changed concurrently.')
      await createRequiredAuditLog(tx, {
        user_id: owner.id, user_name: owner.full_name, user_role: owner.role, member_id: formatMemberId(owner.id, owner.role),
        activity_type: desiredActive ? 'pos_terminal_reactivated' : 'pos_terminal_deactivated', category: 'admin',
        description: `${owner.full_name} ${desiredActive ? 'reactivated' : 'deactivated'} POS device ${current.name}`,
        metadata: { terminal_id: current.id, receipt_code: current.receipt_code, previous_active: current.is_active, is_active: desiredActive },
        ip_address, device, risk_level: 'medium', status: 'completed',
      })
    })
    return NextResponse.json({ success: true, is_active: desiredActive })
  } catch (error) {
    console.error('[POS TERMINAL MANAGEMENT ERROR]', error)
    return NextResponse.json({ error: 'Unable to update this POS device safely.' }, { status: 500 })
  }
}
