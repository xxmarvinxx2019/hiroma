import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

function money(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1_000_000 ? Math.round(parsed * 100) / 100 : null
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const body = await req.json()
    const terminalId = typeof body.terminal_id === 'string' ? body.terminal_id : ''
    const openingCash = money(body.opening_cash)
    if (!terminalId || openingCash == null) return NextResponse.json({ error: 'A valid terminal and opening cash amount are required.' }, { status: 400 })
    const actorId = user.actor_id || user.id
    const terminal = await prisma.posTerminal.findFirst({ where: { id: terminalId, owner_id: user.id, is_active: true }, select: { id: true } })
    if (!terminal) return NextResponse.json({ error: 'This POS terminal is not assigned to your location.' }, { status: 403 })
    try {
      const shift = await prisma.posShift.create({
        data: { owner_id: user.id, terminal_id: terminal.id, opened_by_id: actorId, active_terminal_key: terminal.id, opening_cash: new Prisma.Decimal(openingCash) },
        select: { id: true, status: true, opening_cash: true, opened_at: true },
      })
      return NextResponse.json({ shift }, { status: 201 })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const current = await prisma.posShift.findFirst({ where: { terminal_id: terminal.id, status: 'open' }, select: { id: true, opened_at: true } })
        return NextResponse.json({ error: 'This terminal already has an open shift.', current_shift: current }, { status: 409 })
      }
      throw error
    }
  } catch (error) {
    console.error('[POS OPEN SHIFT]', error)
    return NextResponse.json({ error: 'Unable to open the POS shift.' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const body = await req.json()
    const shiftId = typeof body.shift_id === 'string' ? body.shift_id : ''
    const countedCash = money(body.counted_cash)
    if (!shiftId || countedCash == null) return NextResponse.json({ error: 'Shift and counted cash are required.' }, { status: 400 })
    const actorId = user.actor_id || user.id
    const result = await prisma.$transaction(async (tx) => {
      const shift = await tx.posShift.findFirst({ where: { id: shiftId, owner_id: user.id, opened_by_id: actorId, status: 'open' }, select: { id: true, opening_cash: true } })
      if (!shift) return null
      const pending = await tx.posTransaction.count({ where: { shift_id: shift.id, status: { in: ['pending_sync', 'syncing', 'synced_pending_review', 'needs_correction'] } } })
      if (pending > 0) return { blocked: true as const, pending }
      const cashSales = await tx.posTransaction.aggregate({ where: { shift_id: shift.id, payment_method_snapshot: 'cash', status: { in: ['approved', 'finalized'] } }, _sum: { total_snapshot: true } })
      const expected = Number(shift.opening_cash) + Number(cashSales._sum.total_snapshot || 0)
      return tx.posShift.update({
        where: { id: shift.id },
        data: { closed_by_id: actorId, status: 'finalized', active_terminal_key: null, counted_cash: new Prisma.Decimal(countedCash), expected_cash_snapshot: new Prisma.Decimal(expected), variance_snapshot: new Prisma.Decimal(countedCash - expected), local_closed_at: new Date(), server_finalized_at: new Date() },
        select: { id: true, status: true, expected_cash_snapshot: true, counted_cash: true, variance_snapshot: true, server_finalized_at: true },
      })
    })
    if (!result) return NextResponse.json({ error: 'Open shift not found or already closed.' }, { status: 409 })
    if ('blocked' in result) return NextResponse.json({ error: `This shift cannot close because ${result.pending} transaction${result.pending === 1 ? ' is' : 's are'} not fully synchronized. Reconnect, finish synchronization, and resolve any transaction needing attention.`, code: 'SHIFT_SYNC_INCOMPLETE', pending_transactions: result.pending }, { status: 409 })
    return NextResponse.json({ shift: result })
  } catch (error) {
    console.error('[POS CLOSE SHIFT]', error)
    return NextResponse.json({ error: 'Unable to close the POS shift.' }, { status: 500 })
  }
}
