import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const adminPins = readFileSync('src/app/api/admin/pins/route.ts', 'utf8')
const pinRequests = readFileSync('src/app/api/pin-requests/route.ts', 'utf8')
const reserveRoute = readFileSync(
  'src/app/api/admin/commission-testing/reserve-ledger/route.ts',
  'utf8',
)

test('direct PIN issuance checks reserve admission inside its transaction', () => {
  assert.match(
    adminPins,
    /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*assessPinIssuanceAgainstBinaryReserve\(\s*tx,/,
  )
  assert.match(adminPins, /BinaryReserveAdmissionError/)
  assert.match(adminPins, /status: 503/)
})

test('paid PIN request approval uses the same in-transaction reserve boundary', () => {
  assert.match(
    pinRequests,
    /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*assessPinIssuanceAgainstBinaryReserve\(\s*tx,/,
  )
  assert.match(pinRequests, /snapshot\.binaryAllocation \* request\.quantity/)
})

test('reserve health remains admin-only and exposes policy status', () => {
  assert.match(reserveRoute, /user\.role!=='admin'/)
  assert.match(reserveRoute, /loadBinaryReserveHealth/)
  assert.match(reserveRoute, /reserve_admission:reserveAdmission/)
})
