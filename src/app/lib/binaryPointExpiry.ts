import { Prisma } from '@prisma/client'

export const DEFAULT_BINARY_POINT_EXPIRY_YEARS = 3
export const MIN_BINARY_POINT_EXPIRY_YEARS = 1
export const MAX_BINARY_POINT_EXPIRY_YEARS = 20

type PointLeg = 'left' | 'right'

type ExpiringLot = {
  id: string
  leg: PointLeg
  remaining_points: number
  generated_at: Date
  expires_at: Date
  expiry_years: number
}

type ConsumableLot = {
  id: string
  remaining_points: number
}

export function validateBinaryPointExpiryYears(value: unknown) {
  const years = Number(value)
  if (!Number.isInteger(years) || years < MIN_BINARY_POINT_EXPIRY_YEARS || years > MAX_BINARY_POINT_EXPIRY_YEARS) {
    throw new Error(`Point expiry must be a whole number from ${MIN_BINARY_POINT_EXPIRY_YEARS} to ${MAX_BINARY_POINT_EXPIRY_YEARS} years.`)
  }
  return years
}

export async function getBinaryPointExpiryYears(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<{ value: string }[]>`
    SELECT value FROM system_settings
    WHERE key='binary_point_expiry_years'
    LIMIT 1
  `
  const configured = Number(rows[0]?.value)
  return Number.isInteger(configured)
    && configured >= MIN_BINARY_POINT_EXPIRY_YEARS
    && configured <= MAX_BINARY_POINT_EXPIRY_YEARS
    ? configured
    : DEFAULT_BINARY_POINT_EXPIRY_YEARS
}

function addCalendarYears(value: Date, years: number) {
  const result = new Date(value)
  const originalDay = result.getUTCDate()
  const targetYear = result.getUTCFullYear() + years
  const month = result.getUTCMonth()
  result.setUTCDate(1)
  result.setUTCFullYear(targetYear)
  result.setUTCMonth(month)
  const lastDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(originalDay, lastDay))
  return result
}

export async function expireBinaryPointLotsForUser(
  tx: Prisma.TransactionClient,
  userId: string,
  now = new Date(),
) {
  const lots = await tx.$queryRaw<ExpiringLot[]>`
    SELECT id::text,leg,remaining_points,generated_at,expires_at,expiry_years
    FROM binary_point_lots
    WHERE recipient_user_id=${userId}
      AND remaining_points>0
      AND expires_at<=${now}
    ORDER BY expires_at,id
    FOR UPDATE
  `
  if (lots.length === 0) return { left: 0, right: 0, lots: 0 }

  let left = 0
  let right = 0
  for (const lot of lots) {
    const points = Number(lot.remaining_points)
    if (!Number.isInteger(points) || points <= 0) throw new Error('Invalid expiring binary point lot.')
    const changed = await tx.binaryPointLot.updateMany({
      where: { id: lot.id, remaining_points: points },
      data: { remaining_points: 0 },
    })
    if (changed.count !== 1) throw new Error('Binary point lot changed while expiring.')
    await tx.binaryPointExpiration.create({
      data: {
        point_lot_id: lot.id,
        recipient_user_id: userId,
        leg: lot.leg,
        points,
        generated_at: lot.generated_at,
        scheduled_at: lot.expires_at,
        expired_at: now,
        expiry_years: lot.expiry_years,
      },
    })
    if (lot.leg === 'left') left += points
    else right += points
  }

  const updated = await tx.$executeRaw`
    UPDATE reseller_profiles
    SET left_points=COALESCE(left_points,0)-${left},
        right_points=COALESCE(right_points,0)-${right}
    WHERE user_id=${userId}
      AND COALESCE(left_points,0)>=${left}
      AND COALESCE(right_points,0)>=${right}
  `
  if (updated !== 1) throw new Error('Expired point lots do not reconcile with the member carryover balance.')
  return { left, right, lots: lots.length }
}

export async function createBinaryPointLot(
  tx: Prisma.TransactionClient,
  input: {
    recipientUserId: string
    sourceUserId: string
    sourceKind: 'registration' | 'upgrade'
    sourceEventId: string
    leg: PointLeg
    points: number
    generatedAt: Date
    expiryYears: number
  },
) {
  return tx.binaryPointLot.create({
    data: {
      recipient_user_id: input.recipientUserId,
      source_user_id: input.sourceUserId,
      source_kind: input.sourceKind,
      source_event_id: input.sourceEventId,
      leg: input.leg,
      original_points: input.points,
      remaining_points: input.points,
      generated_at: input.generatedAt,
      expires_at: addCalendarYears(input.generatedAt, input.expiryYears),
      expiry_years: input.expiryYears,
    },
  })
}

export async function consumeBinaryPointLots(
  tx: Prisma.TransactionClient,
  input: {
    recipientUserId: string
    leg: PointLeg
    points: number
    pairEventId: string
    now: Date
  },
) {
  let remaining = input.points
  if (remaining === 0) return
  const lots = await tx.$queryRaw<ConsumableLot[]>`
    SELECT id::text,remaining_points
    FROM binary_point_lots
    WHERE recipient_user_id=${input.recipientUserId}
      AND leg=${input.leg}
      AND remaining_points>0
      AND expires_at>${input.now}
    ORDER BY generated_at,id
    FOR UPDATE
  `
  for (const lot of lots) {
    if (remaining === 0) break
    const available = Number(lot.remaining_points)
    const points = Math.min(available, remaining)
    const changed = await tx.binaryPointLot.updateMany({
      where: { id: lot.id, remaining_points: available },
      data: { remaining_points: { decrement: points } },
    })
    if (changed.count !== 1) throw new Error('Binary point lot changed while pairing.')
    await tx.binaryPointConsumption.create({
      data: {
        point_lot_id: lot.id,
        binary_pair_event_id: input.pairEventId,
        points,
        consumed_at: input.now,
      },
    })
    remaining -= points
  }
  if (remaining !== 0) throw new Error('Dated binary point lots do not cover the aggregate carryover used for pairing.')
}
