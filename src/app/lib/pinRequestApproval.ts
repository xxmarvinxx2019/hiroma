import type { Prisma } from '@prisma/client'

type ApprovalInput = {
  requestId: string
  paymentStatus?: string
  pins: Prisma.PinCreateManyInput[]
  registrationProducts: Array<{
    product_id: string
    quantity: number
    srp_snapshot: number
    reseller_price_snapshot: number
    unit_acquisition_cost_snapshot: number
  }>
  updatedAt: Date
}

export async function claimPendingPinRequestAndCreatePins(
  tx: Prisma.TransactionClient,
  input: ApprovalInput,
) {
  const claimed = await tx.pinRequest.updateMany({
    where: { id: input.requestId, status: 'pending' },
    data: {
      status: 'approved',
      ...(input.paymentStatus && { payment_status: input.paymentStatus }),
      updated_at: input.updatedAt,
    },
  })

  if (claimed.count !== 1) return false

  await tx.pin.createMany({
    data: input.pins.map((pin) => ({
      ...pin,
      funding_pin_request_id: input.requestId,
    })),
  })
  const createdPins = await tx.pin.findMany({
    where: { pin_code: { in: input.pins.map((pin) => pin.pin_code) } },
    select: { id: true },
  })
  if (createdPins.length !== input.pins.length) {
    throw new Error('PIN_REQUEST_ISSUANCE_INCOMPLETE')
  }
  await tx.pinRegistrationProductSnapshot.createMany({
    data: createdPins.flatMap((pin) => input.registrationProducts.map((product) => ({
      pin_id: pin.id,
      product_id: product.product_id,
      quantity: product.quantity,
      srp_snapshot: product.srp_snapshot,
      reseller_price_snapshot: product.reseller_price_snapshot,
      unit_acquisition_cost_snapshot: product.unit_acquisition_cost_snapshot,
    }))),
  })
  return true
}
