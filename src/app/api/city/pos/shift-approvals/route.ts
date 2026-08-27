import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET() {
  try {
    const user = await getCurrentUser()
    const authorized = Boolean(user && user.role === 'city' && (!user.is_staff || user.permissions?.includes('pos_approve')))
    if (!user || !authorized) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
    const actorId = user.actor_id || user.id
    const rows = await prisma.inventoryAuditSession.findMany({
      where: { owner_id: user.id, scope: 'shift_closing', status: 'submitted', pos_shift_id: { not: null } },
      orderBy: { submitted_at: 'asc' },
      include: {
        pos_shift: {
          select: {
            id: true,
            opening_cash: true,
            expected_cash_snapshot: true,
            counted_cash: true,
            variance_snapshot: true,
            opened_at: true,
            closing_submitted_at: true,
            closing_explanation: true,
            opened_by: { select: { id: true, full_name: true, username: true } },
            terminal: { select: { name: true, receipt_code: true } },
            _count: { select: { transactions: true } },
          },
        },
        items: { orderBy: { product_name_snapshot: 'asc' } },
      },
    })
    return NextResponse.json({
      approvals: rows.filter((row) => row.pos_shift).map((row) => ({
        id: row.id,
        reference: row.reference_number,
        submitted_at: row.submitted_at,
        notes: row.pos_shift!.closing_explanation,
        can_review: row.started_by !== actorId,
        cashier: {
          id: row.pos_shift!.opened_by.id,
          full_name: row.pos_shift!.opened_by.full_name || row.pos_shift!.opened_by.username,
          username: row.pos_shift!.opened_by.username,
        },
        terminal: row.pos_shift!.terminal ? { name: row.pos_shift!.terminal.name, code: row.pos_shift!.terminal.receipt_code } : null,
        shift: {
          id: row.pos_shift!.id,
          opened_at: row.pos_shift!.opened_at,
          receipt_count: row.pos_shift!._count.transactions,
          opening_cash: Number(row.pos_shift!.opening_cash),
          expected_cash: Number(row.pos_shift!.expected_cash_snapshot || 0),
          counted_cash: Number(row.pos_shift!.counted_cash || 0),
          variance: Number(row.pos_shift!.variance_snapshot || 0),
        },
        items: row.items.map((item) => ({
          id: item.id,
          product_name: item.product_name_snapshot,
          expected_quantity: item.expected_quantity,
          counted_quantity: item.counted_quantity,
          damaged_quantity: item.damaged_quantity,
          expired_quantity: item.expired_quantity,
          variance_quantity: item.variance_quantity,
          variance_value: Number(item.variance_value || 0),
        })),
      })),
    })
  } catch (error) {
    console.error('[POS SHIFT APPROVALS]', error)
    return NextResponse.json({ error: 'Unable to load Branch shift approvals.' }, { status: 500 })
  }
}
