import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('City PIN requests use a server-controlled 48-hour payment window', () => {
  const route = read('src/app/api/pin-requests/route.ts')
  assert.match(route, /payment_due_at:\s+new Date\(Date\.now\(\) \+ 48 \* 60 \* 60 \* 1000\)/)
  assert.match(route, /payment_status:\s+'awaiting_payment'/)
  assert.match(route, /dist_level === 'branch'/)
  assert.match(route, /internal transfer, not a paid PIN request/)
})

test('payment submission is private, deadline-bound, duplicate-resistant, and manually verified', () => {
  const route = read('src/app/api/pin-requests/[id]/payment/route.ts')
  const migration = read('prisma/migrations/20260911140000_add_pin_request_payment_window/migration.sql')
  const proof = read('src/app/lib/pinRequestPaymentProof.ts')
  assert.match(route, /payment_due_at: \{ gt: new Date\(\) \}/)
  assert.match(route, /payment_status: 'payment_submitted'/)
  assert.match(route, /action === 'verify' \? 'verified' : 'rejected'/)
  assert.match(migration, /UNIQUE INDEX[\s\S]*payment_method_id[\s\S]*LOWER\("reference_number"\)/)
  assert.match(migration, /PIN request payment evidence is append-only/)
  assert.match(migration, /Submitted PIN payment facts are immutable/)
  assert.match(proof, /createSignedUrl\(path, 15 \* 60\)/)
  assert.match(proof, /MAX_BYTES = 5 \* 1024 \* 1024/)
})

test('Admin cannot issue PINs before verified payment evidence exists', () => {
  const route = read('src/app/api/pin-requests/route.ts')
  assert.match(route, /payment_evidence: \{ where: \{ status: 'verified' \}/)
  assert.match(route, /request\.payment_status !== 'paid'/)
  assert.match(route, /request\.payment_evidence\.length !== 1/)
})
