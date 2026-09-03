import type { PosRegistrationIntakeStatus, Prisma } from '@prisma/client'
import { consumeAvailableStock } from '@/app/lib/inventoryReservation'
import { recordInventoryOutEvents } from '@/app/lib/inventoryEvent'
import { parseRegistrationPinSnapshot } from '@/app/lib/registrationPinSnapshot'
import {
  lockPosRegistrationApplicant,
  resolvePosRegistrationIdentityHash,
} from '@/app/lib/posRegistrationApplicant'

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
  const identityProbe = await tx.posRegistrationIntake.findFirst({
    where: { id: input.intakeId, owner_id: input.ownerId },
    select: {
      applicant_full_name: true,
      applicant_mobile: true,
      identity_document_hash: true,
      identity_document_type: true,
      identity_document_reference: true,
    },
  })
  if (!identityProbe) throw new Error('POS_REGISTRATION_NOT_FOUND')
  const identityDocumentHash =
    resolvePosRegistrationIdentityHash(identityProbe)
  if (!identityDocumentHash) throw new Error('POS_REGISTRATION_IDENTITY_INVALID')
  await lockPosRegistrationApplicant(tx, identityDocumentHash)

  const locked = await tx.$queryRaw<
    Array<{
      id: string
      status: PosRegistrationIntakeStatus
      released_at: Date | null
      package_id: string
      receipt_number: string
      applicant_full_name: string
      registration_snapshot: unknown
      applicant_mobile: string
      identity_document_hash: string | null
      identity_document_type: string | null
      identity_document_reference: string | null
    }>
  >`SELECT id, status, released_at, package_id, receipt_number, applicant_full_name, registration_snapshot,
           applicant_mobile, identity_document_hash, identity_document_type, identity_document_reference
    FROM pos_registration_intakes
    WHERE id = ${input.intakeId}::uuid AND owner_id = ${input.ownerId}
    FOR UPDATE`

  const intake = locked[0]
  if (!intake) throw new Error('POS_REGISTRATION_NOT_FOUND')
  if (resolvePosRegistrationIdentityHash(intake) !== identityDocumentHash) {
    throw new Error('POS_REGISTRATION_IDENTITY_INVALID')
  }
  if (intake.released_at) return { replayed: true, releasedAt: intake.released_at }
  if (!['draft_intake', 'payment_verified_ready_for_release'].includes(intake.status)) {
    throw new Error('POS_REGISTRATION_NOT_READY_FOR_RELEASE')
  }

  const snapshot = parseRegistrationPinSnapshot(intake.registration_snapshot)
  if (snapshot.packageId !== intake.package_id) throw new Error('POS_REGISTRATION_SNAPSHOT_MISMATCH')
  const productRows = await tx.product.findMany({
    where: { id: { in: snapshot.products.map((item) => item.product_id) } },
    select: { id: true, name: true },
  })
  if (productRows.length !== snapshot.productLineCount) throw new Error('POS_REGISTRATION_PACKAGE_EMPTY')
  const productNames = new Map(productRows.map((item) => [item.id, item.name]))
  await consumeAvailableStock(tx, input.ownerId, snapshot.products)
  const releasedAt = new Date()
  await tx.posRegistrationIntake.update({
    where: { id: intake.id },
    data: {
      status: 'released_pending_encoding',
      released_at: releasedAt,
      released_by_id: input.actorId,
      identity_document_hash: identityDocumentHash,
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
    reason: `${snapshot.packageName} products released through POS for ${intake.applicant_full_name}`,
    items: snapshot.products.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_cost: item.unit_acquisition_cost_snapshot,
    })),
    metadata: {
      receipt_number: intake.receipt_number,
      package_id: intake.package_id,
      package_name_snapshot: snapshot.packageName,
      acquisition_tier_snapshot: snapshot.acquisitionTier,
      released_products: snapshot.products.map((item) => ({
        product_id: item.product_id,
        product_name: productNames.get(item.product_id) || 'Product',
        quantity: item.quantity,
      })),
    },
  })
  return { replayed: false, releasedAt }
}
