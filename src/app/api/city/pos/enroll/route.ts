import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { consumePosEnrollmentAttempt, hashPosEnrollmentCode, normalizePosEnrollmentCode } from '@/app/lib/posEnrollment'
import { createRequiredAuditLog, getClientInfo } from '@/app/lib/auditLog'

function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Authorized Branch or City POS access is required.' }, { status: 401 })
    const actorId = user.actor_id || user.id
    const { ip_address, device } = getClientInfo(req)
    const bucket = `pos-enroll:${actorId}:${ip_address}`.slice(0, 96)
    if (!(await consumePosEnrollmentAttempt(bucket))) {
      return NextResponse.json({ error: 'Too many enrollment attempts. Wait 15 minutes before trying again.' }, { status: 429, headers: { 'Retry-After': '900' } })
    }
    const body = await req.json()
    const code = normalizePosEnrollmentCode(body.code)
    const installationId = clean(body.installation_id, 120)
    const platform = clean(body.platform, 80) || null
    if (code.length !== 12 || !installationId) return NextResponse.json({ error: 'Enter the complete enrollment code on this device.' }, { status: 400 })

    const existingTerminal = await prisma.posTerminal.findUnique({ where: { installation_id: installationId }, select: { id: true, owner_id: true, is_active: true } })
    if (existingTerminal) {
      if (existingTerminal.owner_id !== user.id) return NextResponse.json({ error: 'This browser installation is already assigned to another location.' }, { status: 409 })
      return NextResponse.json({ success: true, already_enrolled: true, terminal_id: existingTerminal.id })
    }

    const now = new Date()
    const enrollment = await prisma.posTerminalEnrollment.findUnique({ where: { code_hash: hashPosEnrollmentCode(code) } })
    if (!enrollment || enrollment.owner_id !== user.id || enrollment.used_at || enrollment.revoked_at || enrollment.expires_at <= now) {
      return NextResponse.json({ error: 'This enrollment code is invalid, expired, cancelled, or belongs to another location.' }, { status: 400 })
    }
    const terminalId = randomUUID()
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.posTerminalEnrollment.updateMany({
        where: { id: enrollment.id, owner_id: user.id, used_at: null, revoked_at: null, expires_at: { gt: now } },
        data: { used_at: now },
      })
      if (claimed.count !== 1) throw new Error('ENROLLMENT_ALREADY_CLAIMED')
      const terminal = await tx.posTerminal.create({ data: {
        id: terminalId, owner_id: user.id, installation_id: installationId, name: enrollment.terminal_name,
        platform, receipt_code: terminalId.replaceAll('-', '').slice(-7).toUpperCase(),
      }, select: { id: true, name: true, receipt_code: true } })
      await tx.posTerminalEnrollment.update({ where: { id: enrollment.id }, data: { enrolled_terminal_id: terminal.id } })
      await createRequiredAuditLog(tx, {
        user_id: actorId, user_name: user.actor_name || user.full_name, user_role: user.is_staff ? 'staff' : user.role,
        activity_type: 'pos_terminal_enrolled', category: 'admin', description: `${terminal.name} was enrolled as an authorized POS device`,
        metadata: { enrollment_id: enrollment.id, terminal_id: terminal.id, terminal_name: terminal.name, receipt_code: terminal.receipt_code },
        ip_address, device, risk_level: 'medium', status: 'completed',
      })
      await tx.notification.create({ data: {
        user_id: user.id, type: 'pos_terminal_enrolled', title: 'New POS terminal enrolled',
        message: `${terminal.name} was successfully enrolled by ${user.actor_name || user.full_name}.`,
        entity_type: 'pos_terminal', entity_id: terminal.id, action_url: '/dashboard/city/pos/settings',
      } })
      return terminal
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json({ success: true, terminal: result })
  } catch (error) {
    if (error instanceof Error && error.message === 'ENROLLMENT_ALREADY_CLAIMED') return NextResponse.json({ error: 'This enrollment code has already been used.' }, { status: 409 })
    console.error('[POS TERMINAL ENROLL ERROR]', error)
    return NextResponse.json({ error: 'Unable to enroll this POS device safely.' }, { status: 500 })
  }
}
