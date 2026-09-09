import assert from 'node:assert/strict'
import test from 'node:test'
import { getNextPayoutSchedule, validatePayoutSchedule } from '../src/app/lib/payoutSchedule'

test('uses the Asia/Manila calendar and closes a batch at the start of cutoff day', () => {
  const beforeCutoff = getNextPayoutSchedule([15, 31], { '15': '18', '31': '3' }, new Date('2026-09-14T15:59:59.000Z'))
  assert.equal(beforeCutoff.batchId, 'PAYOUT-20260915')
  assert.equal(beforeCutoff.payoutDate.toISOString(), '2026-09-18T00:00:00.000Z')

  const cutoffStarted = getNextPayoutSchedule([15, 31], { '15': '18', '31': '3' }, new Date('2026-09-14T16:00:00.000Z'))
  assert.equal(cutoffStarted.batchId, 'PAYOUT-20260930')
  assert.equal(cutoffStarted.payoutDate.toISOString(), '2026-10-03T00:00:00.000Z')
})

test('schedule validation rejects duplicate cutoffs and missing or invalid mappings', () => {
  assert.throws(() => validatePayoutSchedule([15, 15], { '15': '18' }), /unique/)
  assert.throws(() => validatePayoutSchedule([15, 31], { '15': '18' }), /exactly one/)
  assert.throws(() => validatePayoutSchedule([15], { '15': '32' }), /1 to 31/)
})

test('end-of-month cutoff works in shorter months', () => {
  const schedule = getNextPayoutSchedule([31], { '31': '3' }, new Date('2027-02-27T15:59:59.000Z'))
  assert.equal(schedule.batchId, 'PAYOUT-20270228')
  assert.equal(schedule.payoutDate.toISOString(), '2027-03-03T00:00:00.000Z')
})
