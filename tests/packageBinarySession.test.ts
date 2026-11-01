import test from 'node:test'
import assert from 'node:assert/strict'
import { planPackageBinarySession } from '../src/app/lib/packageBinarySession'

test('closed session rejects new volume on either leg without consuming old carryover', () => {
  for (const leg of ['left', 'right'] as const) {
    assert.deepEqual(planPackageBinarySession({ left: 300, right: 1200, sourcePoints: 600, leg, pointsPerPair: 600, remainingPairs: 0 }), {
      acceptedPoints: 0, flushedPoints: 600, completedPairs: 0, consumedPoints: 0, leftPoints: 300, rightPoints: 1200,
    })
  }
})

test('transaction reaching the session limit rejects its surplus including unmatched remainder', () => {
  assert.deepEqual(planPackageBinarySession({ left: 200, right: 3000, sourcePoints: 3000, leg: 'left', pointsPerPair: 600, remainingPairs: 1 }), {
    acceptedPoints: 400, flushedPoints: 2600, completedPairs: 1, consumedPoints: 600, leftPoints: 0, rightPoints: 2400,
  })
})

test('open session retains unmatched incoming volume and unlimited mode preserves matching', () => {
  assert.equal(planPackageBinarySession({ left: 0, right: 0, sourcePoints: 600, leg: 'left', pointsPerPair: 600, remainingPairs: 5 }).leftPoints, 600)
  assert.equal(planPackageBinarySession({ left: 0, right: 6000, sourcePoints: 6000, leg: 'left', pointsPerPair: 600, remainingPairs: null }).completedPairs, 10)
})
