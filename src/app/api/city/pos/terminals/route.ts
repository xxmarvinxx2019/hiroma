import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import { createPosEnrollmentCode, hashPosEnrollmentCode, POS_ENROLLMENT_TTL_MS } from '@/app/lib/posEnrollment'
import { getSensitiveResellerPinFailure, isSensitiveResellerPinAccepted, verifyResellerSecurityPin } from '@/app/lib/resellerSecurityPin'

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
  const now = new Date()
  const enrollments = await prisma.posTerminalEnrollment.findMany({
    where: { owner_id: owner.id, used_at: null, revoked_at: null, expires_at: { gt: now } },
    orderBy: { created_at: 'desc' },
    select: { id: true, terminal_name: true, expires_at: true, created_at: true },
  })
  return NextResponse.json({ terminals, enrollments })
}

export async function POST(req: NextRequest) {
  try {
    const owner = await getOwner()
    if (!owner) return NextResponse.json({ error: 'Owner access required.' }, { status: 403 })
    const body = await req.json()
    const pinVerification = await verifyResellerSecurityPin(owner.id, body.security_pin)
    if (!isSensitiveResellerPinAccepted(pinVerification)) {
      const failure = getSensitiveResellerPinFailure(pinVerification)
      return NextResponse.json({ error: failure.error }, { status: failure.status })
    }
    const terminalName = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 120) : ''
    if (terminalName.length < 2) return NextResponse.json({ error: 'Enter a terminal name such as Counter 1.' }, { status: 400 })
    const duplicate = await prisma.posTerminal.findFirst({ where: { owner_id: owner.id, name: { equals: terminalName, mode: 'insensitive' } }, select: { id: true } })
    if (duplicate) return NextResponse.json({ error: 'A POS terminal already uses this name.' }, { status: 409 })

    const code = createPosEnrollmentCode()
    const expiresAt = new Date(Date.now() + POS_ENROLLMENT_TTL_MS)
    const { ip_address, device } = getClientInfo(req)
    const enrollment = await prisma.$transaction(async (tx) => {
      await tx.posTerminalEnrollment.updateMany({
        where: { owner_id: owner.id, terminal_name: { equals: terminalName, mode: 'insensitive' }, used_at: null, revoked_at: null },
        data: { revoked_at: new Date() },
      })
      const created = await tx.posTerminalEnrollment.create({ data: {
        owner_id: owner.id, created_by_id: owner.id, terminal_name: terminalName,
        code_hash: hashPosEnrollmentCode(code), expires_at: expiresAt,
      }, select: { id: true } })
      await createRequiredAuditLog(tx, {
        user_id: owner.id, user_name: owner.full_name, user_role: owner.role, member_id: formatMemberId(owner.id, owner.role),
        activity_type: 'pos_terminal_enrollment_created', category: 'admin', description: `${owner.full_name} authorized POS enrollment for ${terminalName}`,
        metadata: { enrollment_id: created.id, terminal_name: terminalName, expires_at: expiresAt.toISOString() },
        ip_address, device, risk_level: 'medium', status: 'completed',
      })
      return created
    })
    return NextResponse.json({ enrollment_id: enrollment.id, code, terminal_name: terminalName, expires_at: expiresAt.toISOString() }, { status: 201 })
  } catch (error) {
    console.error('[POS ENROLLMENT CREATE ERROR]', error)
    return NextResponse.json({ error: 'Unable to create a POS enrollment safely.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const owner = await getOwner()
    if (!owner) return NextResponse.json({ error: 'Owner access required.' }, { status: 403 })
    const body = await req.json()
    const enrollmentId = typeof body.enrollment_id === 'string' ? body.enrollment_id : ''
    const current = await prisma.posTerminalEnrollment.findFirst({ where: { id: enrollmentId, owner_id: owner.id, used_at: null, revoked_at: null }, select: { id: true, terminal_name: true } })
    if (!current) return NextResponse.json({ error: 'Active enrollment not found.' }, { status: 404 })
    const { ip_address, device } = getClientInfo(req)
    await prisma.$transaction(async (tx) => {
      const revoked = await tx.posTerminalEnrollment.updateMany({
        where: { id: current.id, owner_id: owner.id, used_at: null, revoked_at: null }, data: { revoked_at: new Date() },
      })
      if (revoked.count !== 1) throw new Error('Enrollment state changed concurrently.')
      await createRequiredAuditLog(tx, {
        user_id: owner.id, user_name: owner.full_name, user_role: owner.role, member_id: formatMemberId(owner.id, owner.role),
        activity_type: 'pos_terminal_enrollment_cancelled', category: 'admin', description: `${owner.full_name} cancelled POS enrollment for ${current.terminal_name}`,
        metadata: { enrollment_id: current.id, terminal_name: current.terminal_name }, ip_address, device, risk_level: 'medium', status: 'completed',
      })
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[POS ENROLLMENT CANCEL ERROR]', error)
    return NextResponse.json({ error: 'Unable to cancel this enrollment.' }, { status: 500 })
  }
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
