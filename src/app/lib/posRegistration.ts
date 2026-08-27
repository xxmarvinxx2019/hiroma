import type { PosRegistrationIntakeStatus, Prisma } from '@prisma/client'
import { consumeAvailableStock } from '@/app/lib/inventoryReservation'
import { recordInventoryOutEvents } from '@/app/lib/inventoryEvent'

export const POS_REGISTRATION_TRANSITIONS: Record<PosRegistrationIntakeStatus, PosRegistrationIntakeStatus[]> = {
  draft_intake: ['pending_payment_verification', 'released_pending_encoding', 'needs_correction', 'cancelled_refund_required'],
  pending_payment_verification: ['payment_verified_ready_for_release', 'payment_rejected', 'needs_correction'],
  payment_verified_ready_for_release: ['released_pending_encoding', 'needs_correction', 'cancelled_refund_required'],
  released_pending_encoding: ['encoding_in_progress', 'needs_correction'],
  encoding_in_progress: ['registration_completed', 'needs_correction'],
  registration_completed: [],
  needs_correction: ['pending_payment_verification', 'payment_verified_ready_for_release', 'released_pending_encoding'],
  payment_rejected: ['pending_payment_verification', 'cancelled_refund_required'],
  cancelled_refund_required: [],
}

export function canTransitionRegistration(
  from: PosRegistrationIntakeStatus,
  to: PosRegistrationIntakeStatus,
) {
  return POS_REGISTRATION_TRANSITIONS[from].includes(to)
}

export async function releasePosRegistrationPackage(
  tx: Prisma.TransactionClient,
  input: {
    intakeId: string
    ownerId: string
    actorId: string
    actorName: string
  },
) {
  const locked = await tx.$queryRaw<
    Array<{
      id: string
      status: PosRegistrationIntakeStatus
      released_at: Date | null
      package_id: string
      receipt_number: string
      applicant_full_name: string
    }>
  >`SELECT id, status, released_at, package_id, receipt_number, applicant_full_name
    FROM pos_registration_intakes
    WHERE id = ${input.intakeId}::uuid AND owner_id = ${input.ownerId}
    FOR UPDATE`

  const intake = locked[0]
  if (!intake) throw new Error('POS_REGISTRATION_NOT_FOUND')
  if (intake.released_at) return { replayed: true, releasedAt: intake.released_at }
  if (!['draft_intake', 'payment_verified_ready_for_release'].includes(intake.status)) {
    throw new Error('POS_REGISTRATION_NOT_READY_FOR_RELEASE')
  }

  const packageRow = await tx.package.findUnique({
    where: { id: intake.package_id },
    select: {
      name: true,
      products: {
        select: {
          product_id: true,
          quantity: true,
          product: { select: { city_price: true, branch_price: true, cost_price: true } },
        },
      },
    },
  })
  if (!packageRow || packageRow.products.length === 0) throw new Error('POS_REGISTRATION_PACKAGE_EMPTY')

  const owner = await tx.user.findUnique({
    where: { id: input.ownerId },
    select: { distributor_profile: { select: { dist_level: true } } },
  })
  await consumeAvailableStock(tx, input.ownerId, packageRow.products)
  const releasedAt = new Date()
  await tx.posRegistrationIntake.update({
    where: { id: intake.id },
    data: {
      status: 'released_pending_encoding',
      released_at: releasedAt,
      released_by_id: input.actorId,
    },
  })
  await tx.posRegistrationEvent.create({
    data: {
      intake_id: intake.id,
      actor_id: input.actorId,
      from_status: intake.status,
      to_status: 'released_pending_encoding',
      action: 'package_released',
      metadata: { receipt_number: intake.receipt_number },
    },
  })
  await recordInventoryOutEvents(tx, {
    ownerId: input.ownerId,
    actorId: input.actorId,
    actorName: input.actorName,
    eventType: 'registration_package_release',
    referenceType: 'pos_registration_intake',
    referenceId: intake.id,
    reason: `${packageRow.name} products released through POS for ${intake.applicant_full_name}`,
    items: packageRow.products.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_cost:
        owner?.distributor_profile?.dist_level === 'branch'
          ? Number(item.product.branch_price) || Number(item.product.cost_price)
          : Number(item.product.city_price) || Number(item.product.cost_price),
    })),
    metadata: { receipt_number: intake.receipt_number, package_id: intake.package_id },
  })
  return { replayed: false, releasedAt }
}
