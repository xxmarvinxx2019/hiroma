import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/app/lib/auth'
import prisma from '@/app/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user || user.role !== 'city') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await prisma.distributorProfile.findUnique({
      where: { user_id: user.id },
      select: { dist_level: true },
    })
    if (profile?.dist_level !== 'branch') {
      return NextResponse.json({ error: 'Incoming internal transfers are available to Hiroma Branch accounts only.' }, { status: 403 })
    }

    const pending = await prisma.inventoryTransfer.count({
      where: { recipient_id: user.id, status: 'in_transit' },
    })
    if (req.nextUrl.searchParams.get('summary') === 'pending') {
      return NextResponse.json({ pending })
    }

    const status = req.nextUrl.searchParams.get('status') || 'all'
    const transfers = await prisma.inventoryTransfer.findMany({
      where: {
        recipient_id: user.id,
        ...(status !== 'all' ? { status } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    })
    const transferIds = transfers.map((transfer) => transfer.id)
    const movements = transferIds.length > 0
      ? await prisma.inventoryMovement.findMany({
          where: { transfer_id: { in: transferIds } },
          select: { transfer_id: true, quantity: true, accepted_quantity: true, damaged_quantity: true, missing_quantity: true },
        })
      : []
    const totals = new Map<string, { expected: number; accepted: number; damaged: number; missing: number }>()
    for (const movement of movements) {
      if (!movement.transfer_id) continue
      const total = totals.get(movement.transfer_id) || { expected: 0, accepted: 0, damaged: 0, missing: 0 }
      total.expected += movement.quantity
      total.accepted += movement.accepted_quantity || 0
      total.damaged += movement.damaged_quantity || 0
      total.missing += movement.missing_quantity || 0
      totals.set(movement.transfer_id, total)
    }

    return NextResponse.json({
      transfers: transfers.map((transfer) => ({
        id: transfer.id,
        reference_number: transfer.reference_number,
        status: transfer.status,
        notes: transfer.notes,
        dispatched_at: transfer.dispatched_at,
        received_at: transfer.received_at,
        receiving_notes: transfer.receiving_notes,
        created_at: transfer.created_at,
        totals: totals.get(transfer.id) || { expected: 0, accepted: 0, damaged: 0, missing: 0 },
      })),
      pending,
    })
  } catch (error) {
    console.error('[INCOMING TRANSFERS ERROR]', error)
    return NextResponse.json({ error: 'Unable to load incoming transfers.' }, { status: 500 })
  }
}
