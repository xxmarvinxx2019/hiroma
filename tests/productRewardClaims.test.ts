import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import test from 'node:test'
import { parseRewardClaim, hashRewardClaimProof } from '../src/app/lib/productRewardClaims'

const valid = () => ({ client_request_id: randomUUID(), terminal_id: randomUUID(), shift_id: randomUUID(),
  reseller_id: 'member', product_id: 'bottle', quantity: 1, scan_proof: randomBytes(32).toString('base64url') })

test('claim input restricts identifiers, positive whole quantities and purpose-specific proof shape', () => {
  const body = valid()
  assert.deepEqual(parseRewardClaim(body), body)
  for (const quantity of [0, -1, 1.5, '1', 101, NaN]) assert.throws(() => parseRewardClaim({ ...body, quantity }), /Invalid reward claim/)
  for (const key of ['client_request_id', 'terminal_id', 'shift_id', 'reseller_id', 'product_id', 'scan_proof']) {
    assert.throws(() => parseRewardClaim({ ...body, [key]: '' }), /Invalid reward claim/)
  }
})

test('claim parser never carries the reseller PIN into a persisted input or idempotency payload', () => {
  const parsed = parseRewardClaim({ ...valid(), security_pin: '123456', captured_offline: true })
  assert.equal('security_pin' in parsed, false)
  assert.equal('captured_offline' in parsed, false)
  assert.match(hashRewardClaimProof(parsed.scan_proof), /^[a-f0-9]{64}$/)
  assert.notEqual(hashRewardClaimProof(parsed.scan_proof), parsed.scan_proof)
})
