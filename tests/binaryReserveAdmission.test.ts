import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluateBinaryReserveAdmission,
  readBinaryReserveAdmissionPolicy,
  type BinaryReserveHealth,
} from '../src/app/lib/binaryReserveAdmission'

const healthy: BinaryReserveHealth = {
  availableReserve: 1_200,
  earmarkedReserve: 300,
  payableLiability: 300,
  unfundedAmount: 0,
  unfundedCount: 0,
  unusedPinExposure: 1_980,
  unusedPinCount: 3,
  carryoverPoints: 20_000,
  recentEventCount: 20,
  recentMaximumEventPayable: 1_500,
  recentMaximumEventRecipients: 5,
}

test('monitor mode reports a warning without interrupting PIN issuance', () => {
  const decision = evaluateBinaryReserveAdmission({
    health: { ...healthy, availableReserve: 100 },
    requestedBinaryAllocation: 200,
    policy: {
      mode: 'monitor',
      minimumAvailableReserve: 1_000,
      minimumCoveragePercent: 100,
    },
  })

  assert.equal(decision.status, 'warning')
  assert.equal(decision.allowed, true)
  assert.equal(decision.projectedAvailableReserve, 300)
  assert.deepEqual(decision.reasons, ['BELOW_MINIMUM_AVAILABLE_RESERVE'])
})

test('enforce mode pauses PIN issuance before the cashier settlement boundary', () => {
  const decision = evaluateBinaryReserveAdmission({
    health: { ...healthy, availableReserve: 100 },
    requestedBinaryAllocation: 200,
    policy: {
      mode: 'enforce',
      minimumAvailableReserve: 1_000,
      minimumCoveragePercent: 100,
    },
  })

  assert.equal(decision.status, 'blocked')
  assert.equal(decision.allowed, false)
  assert.deepEqual(decision.reasons, ['BELOW_MINIMUM_AVAILABLE_RESERVE'])
})

test('new paid PIN allocation is included in the issuance projection', () => {
  const decision = evaluateBinaryReserveAdmission({
    health: { ...healthy, availableReserve: 800 },
    requestedBinaryAllocation: 200,
    policy: {
      mode: 'enforce',
      minimumAvailableReserve: 1_000,
      minimumCoveragePercent: 100,
    },
  })

  assert.equal(decision.status, 'healthy')
  assert.equal(decision.allowed, true)
  assert.equal(decision.projectedAvailableReserve, 1_000)
})

test('historical unfunded consumption always raises a policy signal', () => {
  const decision = evaluateBinaryReserveAdmission({
    health: { ...healthy, unfundedAmount: 1, unfundedCount: 1 },
    requestedBinaryAllocation: 10_000,
    policy: {
      mode: 'enforce',
      minimumAvailableReserve: 0,
      minimumCoveragePercent: 100,
    },
  })

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('UNFUNDED_HISTORY_DETECTED'))
})

test('enforcement cannot be enabled without an explicit approved threshold', () => {
  assert.throws(
    () => readBinaryReserveAdmissionPolicy({ BINARY_RESERVE_ADMISSION_MODE: 'enforce' }),
    /explicitly approved reserve amount or coverage threshold/,
  )
})

test('policy parser rejects unsafe or malformed thresholds', () => {
  assert.throws(
    () => readBinaryReserveAdmissionPolicy({
      BINARY_RESERVE_ADMISSION_MODE: 'monitor',
      BINARY_RESERVE_MIN_AVAILABLE_PHP: '-1',
    }),
    /non-negative amount/,
  )
  assert.throws(
    () => readBinaryReserveAdmissionPolicy({
      BINARY_RESERVE_ADMISSION_MODE: 'monitor',
      BINARY_RESERVE_MIN_COVERAGE_PERCENT: '99',
    }),
    /between 100 and 10000/,
  )
})

test('corrupt negative accounting inputs fail closed', () => {
  assert.throws(
    () => evaluateBinaryReserveAdmission({
      health: { ...healthy, availableReserve: -0.01 },
      requestedBinaryAllocation: 0,
      policy: {
        mode: 'monitor',
        minimumAvailableReserve: 0,
        minimumCoveragePercent: 100,
      },
    }),
    /Available reserve must be a finite non-negative number/,
  )
})
