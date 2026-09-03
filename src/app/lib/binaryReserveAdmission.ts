import type { Prisma } from '@prisma/client'

export const BINARY_RESERVE_LOCK_KEY = 'binary-reserve-funding'

export type BinaryReserveAdmissionMode = 'monitor' | 'enforce'

export type BinaryReserveAdmissionPolicy = {
  mode: BinaryReserveAdmissionMode
  minimumAvailableReserve: number
  minimumCoveragePercent: number
}

export type BinaryReserveHealth = {
  availableReserve: number
  earmarkedReserve: number
  payableLiability: number
  unfundedAmount: number
  unfundedCount: number
  unusedPinExposure: number
  unusedPinCount: number
  carryoverPoints: number
  recentEventCount: number
  recentMaximumEventPayable: number
  recentMaximumEventRecipients: number
}

export type BinaryReserveAdmissionDecision = BinaryReserveHealth & {
  mode: BinaryReserveAdmissionMode
  requestedBinaryAllocation: number
  projectedAvailableReserve: number
  projectedTotalReserveHeld: number
  coveragePercent: number
  minimumAvailableReserve: number
  minimumCoveragePercent: number
  status: 'healthy' | 'warning' | 'blocked'
  allowed: boolean
  reasons: Array<
    | 'UNFUNDED_HISTORY_DETECTED'
    | 'BELOW_MINIMUM_AVAILABLE_RESERVE'
    | 'BELOW_MINIMUM_COVERAGE'
  >
}

type HealthRow = {
  available_reserve: string | number | null
  earmarked_reserve: string | number | null
  payable_liability: string | number | null
  unfunded_amount: string | number | null
  unfunded_count: number | null
  unused_pin_exposure: string | number | null
  unused_pin_count: number | null
  carryover_points: string | number | null
  recent_event_count: number | null
  recent_maximum_event_payable: string | number | null
  recent_maximum_event_recipients: number | null
}

function amount(value: unknown, name = 'Reserve amount') {
  const parsed = Number(value ?? 0)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a finite non-negative number.`)
  }
  return parsed
}

function count(value: unknown, name: string) {
  const parsed = Number(value ?? 0)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`)
  }
  return parsed
}

const centavos = (value: number) => Math.round(value * 100)

function parseNonNegativeAmount(
  value: string | undefined,
  name: string,
  fallback: number,
) {
  if (value == null || value.trim() === '') return fallback
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${name} must be a non-negative amount with at most two decimal places.`)
  }
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite amount.`)
  }
  return parsed
}

function parseCoveragePercent(
  value: string | undefined,
  fallback: number,
) {
  if (value == null || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 100 || parsed > 10_000) {
    throw new Error('BINARY_RESERVE_MIN_COVERAGE_PERCENT must be between 100 and 10000.')
  }
  return parsed
}

export function readBinaryReserveAdmissionPolicy(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): BinaryReserveAdmissionPolicy {
  const rawMode = (environment.BINARY_RESERVE_ADMISSION_MODE || 'monitor').trim().toLowerCase()
  if (rawMode !== 'monitor' && rawMode !== 'enforce') {
    throw new Error('BINARY_RESERVE_ADMISSION_MODE must be monitor or enforce.')
  }

  if (
    rawMode === 'enforce' &&
    !environment.BINARY_RESERVE_MIN_AVAILABLE_PHP &&
    !environment.BINARY_RESERVE_MIN_COVERAGE_PERCENT
  ) {
    throw new Error(
      'Enforcement requires an explicitly approved reserve amount or coverage threshold.',
    )
  }

  return {
    mode: rawMode,
    minimumAvailableReserve: parseNonNegativeAmount(
      environment.BINARY_RESERVE_MIN_AVAILABLE_PHP,
      'BINARY_RESERVE_MIN_AVAILABLE_PHP',
      0,
    ),
    minimumCoveragePercent: parseCoveragePercent(
      environment.BINARY_RESERVE_MIN_COVERAGE_PERCENT,
      100,
    ),
  }
}

export function evaluateBinaryReserveAdmission(input: {
  health: BinaryReserveHealth
  requestedBinaryAllocation: number
  policy: BinaryReserveAdmissionPolicy
}): BinaryReserveAdmissionDecision {
  const requestedBinaryAllocation = amount(
    input.requestedBinaryAllocation,
    'Requested binary allocation',
  )
  const projectedAvailableReserve =
    amount(input.health.availableReserve, 'Available reserve') +
    requestedBinaryAllocation
  const projectedTotalReserveHeld =
    projectedAvailableReserve +
    amount(input.health.earmarkedReserve, 'Earmarked reserve')
  const payableLiability = amount(
    input.health.payableLiability,
    'Payable liability',
  )
  const coveragePercent = payableLiability === 0
    ? 100
    : (projectedTotalReserveHeld / payableLiability) * 100
  const reasons: BinaryReserveAdmissionDecision['reasons'] = []

  if (centavos(input.health.unfundedAmount) > 0 || input.health.unfundedCount > 0) {
    reasons.push('UNFUNDED_HISTORY_DETECTED')
  }
  if (
    centavos(projectedAvailableReserve) <
    centavos(input.policy.minimumAvailableReserve)
  ) {
    reasons.push('BELOW_MINIMUM_AVAILABLE_RESERVE')
  }
  if (coveragePercent + Number.EPSILON < input.policy.minimumCoveragePercent) {
    reasons.push('BELOW_MINIMUM_COVERAGE')
  }

  const blocked = input.policy.mode === 'enforce' && reasons.length > 0
  return {
    ...input.health,
    mode: input.policy.mode,
    requestedBinaryAllocation,
    projectedAvailableReserve,
    projectedTotalReserveHeld,
    coveragePercent,
    minimumAvailableReserve: input.policy.minimumAvailableReserve,
    minimumCoveragePercent: input.policy.minimumCoveragePercent,
    status: blocked ? 'blocked' : reasons.length > 0 ? 'warning' : 'healthy',
    allowed: !blocked,
    reasons,
  }
}

export async function loadBinaryReserveHealth(
  tx: Prisma.TransactionClient,
  options: { lock?: boolean } = {},
): Promise<BinaryReserveHealth> {
  if (options.lock) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${BINARY_RESERVE_LOCK_KEY}))`
  }

  const [row] = await tx.$queryRaw<HealthRow[]>`
    WITH funded AS (
      SELECT consumption.commission_id, SUM(consumption.amount)::numeric funded_amount
      FROM binary_reserve_consumptions consumption
      JOIN commissions commission ON commission.id = consumption.commission_id
      WHERE consumption.is_unfunded = false
        AND commission.is_pair_overflow = false
      GROUP BY consumption.commission_id
    ), released AS (
      SELECT lot.commission_id, SUM(consumption.amount)::numeric released_amount
      FROM binary_payout_consumptions consumption
      JOIN binary_payable_lots lot ON lot.id = consumption.payable_lot_id
      JOIN payouts payout ON payout.id = consumption.payout_id
      WHERE payout.status = 'released'
      GROUP BY lot.commission_id
    ), forfeited AS (
      SELECT lot.commission_id, SUM(forfeiture.amount)::numeric forfeited_amount
      FROM payable_lot_forfeitures forfeiture
      JOIN binary_payable_lots lot ON lot.id = forfeiture.binary_lot_id
      WHERE forfeiture.source_type = 'binary'
      GROUP BY lot.commission_id
    ), recent_events AS (
      SELECT
        event.source_kind,
        event.source_event_id,
        COUNT(*)::int recipients,
        SUM(event.payable_amount)::numeric payable_amount
      FROM binary_pair_events event
      WHERE event.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
      GROUP BY event.source_kind, event.source_event_id
    )
    SELECT
      COALESCE((
        SELECT SUM(remaining_amount) FROM binary_reserve_lots
        WHERE remaining_amount > 0
      ), 0)::text available_reserve,
      COALESCE((
        SELECT SUM(GREATEST(
          funded.funded_amount
          - COALESCE(released.released_amount, 0)
          - COALESCE(forfeited.forfeited_amount, 0),
          0
        ))
        FROM funded
        LEFT JOIN released ON released.commission_id = funded.commission_id
        LEFT JOIN forfeited ON forfeited.commission_id = funded.commission_id
      ), 0)::text earmarked_reserve,
      GREATEST(
        COALESCE((SELECT SUM(original_amount) FROM binary_payable_lots), 0)
        - COALESCE((
          SELECT SUM(consumption.amount)
          FROM binary_payout_consumptions consumption
          JOIN payouts payout ON payout.id = consumption.payout_id
          WHERE payout.status = 'released'
        ), 0)
        - COALESCE((
          SELECT SUM(amount) FROM payable_lot_forfeitures
          WHERE source_type = 'binary'
        ), 0),
        0
      )::text payable_liability,
      COALESCE((
        SELECT SUM(consumption.amount)
        FROM binary_reserve_consumptions consumption
        JOIN commissions commission ON commission.id = consumption.commission_id
        WHERE consumption.is_unfunded = true
          AND commission.is_pair_overflow = false
      ), 0)::text unfunded_amount,
      COALESCE((
        SELECT COUNT(*)
        FROM binary_reserve_consumptions consumption
        JOIN commissions commission ON commission.id = consumption.commission_id
        WHERE consumption.is_unfunded = true
          AND commission.is_pair_overflow = false
      ), 0)::int unfunded_count,
      COALESCE((
        SELECT SUM(CASE
          WHEN pin_type = 'upgrade' THEN upgrade_binary_allocation_snapshot
          ELSE registration_binary_allocation_snapshot
        END)
        FROM pins
        WHERE status = 'unused'
      ), 0)::text unused_pin_exposure,
      COALESCE((SELECT COUNT(*) FROM pins WHERE status = 'unused'), 0)::int unused_pin_count,
      COALESCE((
        SELECT SUM(COALESCE(left_points, 0) + COALESCE(right_points, 0))
        FROM reseller_profiles
      ), 0)::text carryover_points,
      COALESCE((SELECT COUNT(*) FROM recent_events), 0)::int recent_event_count,
      COALESCE((SELECT MAX(payable_amount) FROM recent_events), 0)::text recent_maximum_event_payable,
      COALESCE((SELECT MAX(recipients) FROM recent_events), 0)::int recent_maximum_event_recipients
  `

  return {
    availableReserve: amount(row?.available_reserve, 'Available reserve'),
    earmarkedReserve: amount(row?.earmarked_reserve, 'Earmarked reserve'),
    payableLiability: amount(row?.payable_liability, 'Payable liability'),
    unfundedAmount: amount(row?.unfunded_amount, 'Unfunded amount'),
    unfundedCount: count(row?.unfunded_count, 'Unfunded count'),
    unusedPinExposure: amount(row?.unused_pin_exposure, 'Unused PIN exposure'),
    unusedPinCount: count(row?.unused_pin_count, 'Unused PIN count'),
    carryoverPoints: amount(row?.carryover_points, 'Carryover points'),
    recentEventCount: count(row?.recent_event_count, 'Recent event count'),
    recentMaximumEventPayable: amount(
      row?.recent_maximum_event_payable,
      'Recent maximum event payable',
    ),
    recentMaximumEventRecipients: count(
      row?.recent_maximum_event_recipients,
      'Recent maximum event recipients',
    ),
  }
}

export class BinaryReserveAdmissionError extends Error {
  readonly code = 'BINARY_RESERVE_ADMISSION_BLOCKED'

  constructor(readonly decision: BinaryReserveAdmissionDecision) {
    super('PIN issuance is temporarily paused by the protected reserve policy.')
    this.name = 'BinaryReserveAdmissionError'
  }
}

export async function assessPinIssuanceAgainstBinaryReserve(
  tx: Prisma.TransactionClient,
  requestedBinaryAllocation: number,
  policy = readBinaryReserveAdmissionPolicy(),
) {
  const health = await loadBinaryReserveHealth(tx, { lock: true })
  const decision = evaluateBinaryReserveAdmission({
    health,
    requestedBinaryAllocation,
    policy,
  })
  if (!decision.allowed) throw new BinaryReserveAdmissionError(decision)
  return decision
}
