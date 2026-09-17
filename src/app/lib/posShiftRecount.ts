import type { Prisma } from '@prisma/client'
import { notificationUuid } from './notificationUuid'

export class PosShiftRecountConflictError extends Error {}

export async function returnPosShiftForRecount(tx: Prisma.TransactionClient, input: { shiftId: string; ownerId: string; notes: string }) {
  const returnedShift = await tx.posShift.findFirst({
    where: { id: input.shiftId, owner_id: input.ownerId, status: 'locally_closed' },
    select: { id: true, opened_by_id: true },
  })
  const returned = await tx.posShift.updateMany({
    where: { id: input.shiftId, owner_id: input.ownerId, status: 'locally_closed' },
    data: { status: 'needs_review', closing_explanation: input.notes },
  })
  if (!returnedShift || returned.count !== 1) throw new PosShiftRecountConflictError('The linked cashier shift is no longer awaiting review. No return was saved; refresh before trying again.')
  const notice = {
    user_id: returnedShift.opened_by_id,
    type: 'pos_shift_recount_required',
    title: 'Shift returned for recount',
    message: `Your manager returned this shift for recount. Note: ${input.notes}`,
    entity_type: 'pos_shift',
    entity_id: returnedShift.id,
    action_url: `/dashboard/city/pos/history?shift_id=${returnedShift.id}`,
  }
  const id = notificationUuid(`pos-shift-recount:${returnedShift.id}`)
  await tx.notification.upsert({
    where: { id },
    create: { id, ...notice },
    update: { ...notice, read_at: null, created_at: new Date() },
  })
}
