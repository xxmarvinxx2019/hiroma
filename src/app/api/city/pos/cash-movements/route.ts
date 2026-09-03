import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import { createRequiredAuditLog, formatMemberId, getClientInfo } from '@/app/lib/auditLog'
import { notifyPosReviewers } from '@/app/lib/posNotifications'
import prisma from '@/app/lib/prisma'
import { calculateShiftCashSales } from '@/app/lib/posCashSales'

const PURPOSES = {
  paid_in: new Set(['change_fund', 'cash_float', 'correction', 'other']),
  paid_out: new Set(['bank_deposit', 'petty_cash', 'supplier_payment', 'correction', 'other']),
} as const

function clean(value: unknown, limit = 500) { return typeof value === 'string' ? value.trim().slice(0, limit) : '' }
function validUuid(value: unknown) {
  const normalized = clean(value, 36).toLowerCase()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized) ? normalized : ''
}
function validAmount(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000 ? Math.round(amount * 100) / 100 : null
}
function canApprove(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return Boolean(user && user.role === 'city' && (!user.is_staff || user.permissions?.includes('pos_approve')))
}

async function accessibleShift(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, shiftId: string, audit: boolean) {
  const actorId = user.actor_id || user.id
  return prisma.posShift.findFirst({
    where: { id: shiftId, owner_id: user.id, ...(audit && canApprove(user) ? {} : { opened_by_id: actorId }) },
    select: { id: true, terminal_id: true, status: true, opening_cash: true, opened_at: true },
  })
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const shiftId = clean(req.nextUrl.searchParams.get('shift_id'), 80)
  const audit = req.nextUrl.searchParams.get('view') === 'audit'
  if (!shiftId) return NextResponse.json({ error: 'Shift is required.' }, { status: 400 })
  const shift = await accessibleShift(user, shiftId, audit)
  if (!shift) return NextResponse.json({ error: 'Shift not found.' }, { status: 404 })

  const [movements, cashSales, cashRefunds] = await Promise.all([
    prisma.posCashMovement.findMany({
      where: { shift_id: shift.id, owner_id: user.id }, orderBy: { requested_at: 'desc' },
      select: { id: true, movement_type: true, status: true, amount: true, purpose: true, notes: true, reference: true, requested_at: true, reviewed_at: true, review_notes: true, requested_by_id: true, reviewed_by_id: true, requested_by: { select: { full_name: true, username: true } }, reviewed_by: { select: { full_name: true, username: true } } },
    }),
    calculateShiftCashSales(prisma, shift.id),
    prisma.posAdjustmentRequest.aggregate({ where: { request_type: 'refund', status: 'approved', transaction: { shift_id: shift.id, payment_method_snapshot: 'cash', status: { in: ['approved', 'finalized'] } } }, _sum: { amount_snapshot: true } }),
  ])
  const paidIn = movements.filter(row => row.movement_type === 'paid_in' && ['applied', 'approved'].includes(row.status)).reduce((sum, row) => sum + Number(row.amount), 0)
  const paidOut = movements.filter(row => row.movement_type === 'paid_out' && row.status === 'approved').reduce((sum, row) => sum + Number(row.amount), 0)
  return NextResponse.json({
    access: { can_approve: canApprove(user), view: audit && canApprove(user) ? 'audit' : 'mine' },
    shift: { ...shift, opening_cash: Number(shift.opening_cash) },
    summary: { opening_cash: Number(shift.opening_cash), cash_sales: cashSales.total, product_cash_sales: cashSales.productCash, registration_cash_sales: cashSales.registrationCash, cash_refunds: Number(cashRefunds._sum.amount_snapshot || 0), paid_in: paidIn, paid_out: paidOut, pending_paid_out: movements.filter(row => row.movement_type === 'paid_out' && row.status === 'pending').length },
    movements: movements.map(row => ({ ...row, amount: Number(row.amount), requested_by_name: row.requested_by.full_name || row.requested_by.username, reviewed_by_name: row.reviewed_by?.full_name || row.reviewed_by?.username || null })),
  })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  try {
    const body = await req.json()
    const actorId = user.actor_id || user.id
    const clientRequestId = validUuid(body.client_request_id)
    const shiftId = clean(body.shift_id, 80)
    const type = body.movement_type === 'paid_in' ? 'paid_in' : body.movement_type === 'paid_out' ? 'paid_out' : ''
    const amount = validAmount(body.amount)
    const purpose = clean(body.purpose, 80)
    const notes = clean(body.notes)
    const reference = clean(body.reference, 160) || null
    if (!clientRequestId || !shiftId || !type || amount == null || !PURPOSES[type].has(purpose as never) || notes.length < 5) return NextResponse.json({ error: 'Enter a valid request, amount, purpose, and explanation of at least 5 characters.' }, { status: 400 })
    let result: { movement: { id: string; status: string; amount: Prisma.Decimal }; replayed: boolean }
    try {
      result = await prisma.$transaction(async tx => {
      const existing = await tx.posCashMovement.findUnique({ where: { client_request_id: clientRequestId }, select: { id: true, owner_id: true, requested_by_id: true, shift_id: true, status: true, amount: true } })
      if (existing) {
        if (existing.owner_id !== user.id || existing.requested_by_id !== actorId || existing.shift_id !== shiftId) throw new Error('POS_CASH_REQUEST_CONFLICT')
        return { movement: { id: existing.id, status: existing.status, amount: existing.amount }, replayed: true }
      }
      const shift = await tx.posShift.findFirst({ where: { id: shiftId, owner_id: user.id, opened_by_id: actorId, status: 'open' }, select: { id: true, terminal_id: true } })
      if (!shift) throw new Error('POS_SHIFT_NOT_OPEN')
      const movement = await tx.posCashMovement.create({ data: { client_request_id: clientRequestId, owner_id: user.id, shift_id: shift.id, terminal_id: shift.terminal_id, requested_by_id: actorId, movement_type: type, status: type === 'paid_in' ? 'applied' : 'pending', amount: new Prisma.Decimal(amount), purpose, notes, reference }, select: { id: true, status: true, amount: true } })
      const client = getClientInfo(req)
      await createRequiredAuditLog(tx, { user_id: actorId, user_name: user.actor_name || user.full_name || user.username, user_role: user.is_staff ? 'staff' : user.role, member_id: formatMemberId(actorId, user.is_staff ? 'staff' : user.role), activity_type: type === 'paid_in' ? 'pos_cash_paid_in_applied' : 'pos_cash_paid_out_requested', category: 'order', description: `${type === 'paid_in' ? 'Paid in' : 'Paid out'} ${amount.toFixed(2)} for ${purpose}.`, metadata: { cash_movement_id: movement.id, shift_id: shift.id, movement_type: type, amount, purpose, reference }, ...client, status: type === 'paid_in' ? 'completed' : 'under_review' })
      return { movement, replayed: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      const existing = await prisma.posCashMovement.findFirst({ where: { client_request_id: clientRequestId, owner_id: user.id, requested_by_id: actorId, shift_id: shiftId }, select: { id: true, status: true, amount: true } })
      if (!existing) throw error
      result = { movement: existing, replayed: true }
    }
    if (type === 'paid_out' && !result.replayed) await notifyPosReviewers({ ownerId: user.id, actorId, permission: 'pos_approve', type: 'pos_cash_paid_out_pending', title: 'Cash paid-out request needs review', message: `A ${amount.toFixed(2)} paid-out request is waiting for an independent decision.`, entityType: 'pos_cash_movement', entityId: result.movement.id, actionUrl: '/dashboard/city/pos/history?view=audit' })
    return NextResponse.json({ movement: { ...result.movement, amount: Number(result.movement.amount) }, replayed: result.replayed }, { status: result.replayed ? 200 : 201 })
  } catch (error) {
    console.error('[POS CASH MOVEMENT]', error)
    if (error instanceof Error && error.message === 'POS_SHIFT_NOT_OPEN') return NextResponse.json({ error: 'Only the assigned cashier can record cash movement while this shift is open.' }, { status: 409 })
    if (error instanceof Error && error.message === 'POS_CASH_REQUEST_CONFLICT') return NextResponse.json({ error: 'This cash-movement request ID is already bound to another operation.' }, { status: 409 })
    return NextResponse.json({ error: 'Unable to record this cash movement safely.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || !canApprove(user)) return NextResponse.json({ error: 'You are not authorized to review paid-out requests.' }, { status: 403 })
  const actorId = user.actor_id || user.id
  try {
    const body = await req.json()
    const movementId = clean(body.movement_id, 80)
    const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : ''
    const notes = clean(body.notes)
    if (!movementId || !action || notes.length < 5) return NextResponse.json({ error: 'Enter a review note of at least 5 characters before deciding.' }, { status: 400 })
    const result = await prisma.$transaction(async tx => {
      const movement = await tx.posCashMovement.findFirst({ where: { id: movementId, owner_id: user.id, movement_type: 'paid_out', status: 'pending' } })
      if (!movement) throw new Error('POS_CASH_MOVEMENT_NOT_PENDING')
      if (movement.requested_by_id === actorId) throw new Error('POS_SELF_APPROVAL')
      const claimed = await tx.posCashMovement.updateMany({ where: { id: movement.id, status: 'pending' }, data: { status: action === 'approve' ? 'approved' : 'rejected', reviewed_by_id: actorId, reviewed_at: new Date(), review_notes: notes } })
      if (claimed.count !== 1) throw new Error('POS_CASH_MOVEMENT_NOT_PENDING')
      const client = getClientInfo(req)
      await createRequiredAuditLog(tx, { user_id: actorId, user_name: user.actor_name || user.full_name || user.username, user_role: user.is_staff ? 'staff' : user.role, member_id: formatMemberId(actorId, user.is_staff ? 'staff' : user.role), activity_type: action === 'approve' ? 'pos_cash_paid_out_approved' : 'pos_cash_paid_out_rejected', category: 'order', description: `Paid-out request ${action === 'approve' ? 'approved' : 'rejected'}: ${notes}`, metadata: { cash_movement_id: movement.id, shift_id: movement.shift_id, requester_id: movement.requested_by_id, reviewer_id: actorId, amount: Number(movement.amount) }, ...client, status: 'completed' })
      return { status: action === 'approve' ? 'approved' : 'rejected' }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[POS CASH MOVEMENT REVIEW]', error)
    if (error instanceof Error && error.message === 'POS_SELF_APPROVAL') return NextResponse.json({ error: 'Maker–approver control: a different authorized account must review this paid-out request.' }, { status: 403 })
    if (error instanceof Error && error.message === 'POS_CASH_MOVEMENT_NOT_PENDING') return NextResponse.json({ error: 'This paid-out request is no longer pending.' }, { status: 409 })
    return NextResponse.json({ error: 'Unable to save this cash-movement decision safely.' }, { status: 500 })
  }
}
