import assert from 'node:assert/strict'
import test from 'node:test'
import { matchesReleasedPayout } from '../src/app/lib/payoutEvidence'

test('a resumed import skips only a released payout with matching bank evidence', () => {
  const disbursedAt = new Date('2026-11-03T02:00:00Z')
  const payout = { status: 'released', disbursement_provider: ' BDO ', external_reference: 'abc  123', disbursed_amount: '500.00', disbursed_at: disbursedAt }
  const evidence = { provider: 'bdo', reference: 'ABC 123', amount: 500, disbursedAt }
  assert.equal(matchesReleasedPayout(payout, evidence), true)
  assert.equal(matchesReleasedPayout({ ...payout, status: 'approved' }, evidence), false)
  for (const changed of [{ provider: 'gcash' }, { reference: 'OTHER' }, { amount: 501 }, { disbursedAt: null }, { disbursedAt: new Date(disbursedAt.getTime() + 1) }]) {
    assert.equal(matchesReleasedPayout(payout, { ...evidence, ...changed }), false)
  }
})
