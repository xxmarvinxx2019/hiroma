import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { maskVerificationName, PUBLIC_VERIFICATION_WINDOW_LIMIT, PUBLIC_VERIFICATION_WINDOW_MINUTES } from '../src/app/lib/publicVerificationPolicy'

const helper = readFileSync(new URL('../src/app/lib/publicVerificationProtection.ts', import.meta.url), 'utf8')
const memberRoute = readFileSync(new URL('../src/app/api/public/member-verification/[memberId]/route.ts', import.meta.url), 'utf8')
const distributorRoute = readFileSync(new URL('../src/app/api/public/distributor-verification/[memberId]/route.ts', import.meta.url), 'utf8')

test('public verification uses a bounded shared database window', () => {
  assert.equal(PUBLIC_VERIFICATION_WINDOW_MINUTES, 5)
  assert.equal(PUBLIC_VERIFICATION_WINDOW_LIMIT, 30)
  assert.match(helper, /INSERT INTO public_verification_rate_limits/)
  assert.match(helper, /ON CONFLICT \(bucket_key, window_start\) DO UPDATE/)
  assert.match(helper, /LEAST\(public_verification_rate_limits\.request_count \+ 1, 31\)/)
})

test('public names are masked while remaining recognizable for verification', () => {
  assert.equal(maskVerificationName('Noel Aring'), 'N*** A****')
  assert.equal(maskVerificationName('A B'), 'A* B*')
})

test('both public verification routes enforce the shared limiter', () => {
  for (const route of [memberRoute, distributorRoute]) {
    assert.match(route, /consumePublicVerificationAllowance\(request\.headers\)/)
    assert.match(route, /status: 429/)
    assert.match(route, /'Retry-After': '300'/)
    assert.match(route, /maskVerificationName/)
  }
})

test('member lookup no longer exposes a distinct 404 existence oracle', () => {
  assert.doesNotMatch(memberRoute, /Member not found[\s\S]*status: 404/)
  assert.match(memberRoute, /verified: false[\s\S]*status: 'not_verified'/)
})

test('distributor lookup no longer exposes a distinct 404 existence oracle', () => {
  assert.doesNotMatch(distributorRoute, /Distributor not found[\s\S]*status: 404/)
  assert.match(distributorRoute, /verified: false[\s\S]*full_name: null/)
})
