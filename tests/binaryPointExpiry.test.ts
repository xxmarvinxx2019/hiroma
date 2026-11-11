import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_BINARY_POINT_EXPIRY_YEARS,
  validateBinaryPointExpiryYears,
} from '../src/app/lib/binaryPointExpiry'

const migration = readFileSync('prisma/migrations/20260924150000_add_binary_point_expiry_ledger/migration.sql', 'utf8')
const settlement = readFileSync('src/app/lib/binaryCommission.ts', 'utf8')
const expiry = readFileSync('src/app/lib/binaryPointExpiry.ts', 'utf8')
const setting = readFileSync('src/app/api/admin/settings/binary-point-expiry/route.ts', 'utf8')
const cron = readFileSync('src/app/api/cron/expire-binary-points/route.ts', 'utf8')
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: Array<{ path: string }> }

test('Package Binary points default to a configurable three-year term', () => {
  assert.equal(DEFAULT_BINARY_POINT_EXPIRY_YEARS, 3)
  assert.equal(validateBinaryPointExpiryYears(3), 3)
  assert.equal(validateBinaryPointExpiryYears(5), 5)
  assert.throws(() => validateBinaryPointExpiryYears(0))
  assert.throws(() => validateBinaryPointExpiryYears(3.5))
  assert.throws(() => validateBinaryPointExpiryYears(21))
})

test('dated point lots preserve source, leg, generation, and expiration evidence', () => {
  assert.match(migration, /CREATE TABLE "binary_point_lots"/)
  assert.match(migration, /"generated_at" TIMESTAMPTZ/)
  assert.match(migration, /"expires_at" TIMESTAMPTZ/)
  assert.match(migration, /CREATE TABLE "binary_point_consumptions"/)
  assert.match(migration, /CREATE TABLE "binary_point_expirations"/)
  assert.match(migration, /'legacy_backfill'/)
  assert.match(migration, /CURRENT_TIMESTAMP \+ INTERVAL '3 years'/)
  assert.match(migration, /binary_point_lots_balance_check/)
  assert.match(migration, /Binary point consumption and expiration evidence is append-only/)
  assert.match(migration, /Binary point lot backfill does not reconcile/)
})

test('pair settlement expires due lots first and consumes valid points FIFO', () => {
  const expireAt = settlement.indexOf('expireBinaryPointLotsForUser')
  const profilesAt = settlement.indexOf('const profiles =')
  const createLotAt = settlement.indexOf('createBinaryPointLot(tx')
  const pairEventAt = settlement.indexOf('const pairEvent = await tx.binaryPairEvent.create')
  const consumeAt = settlement.indexOf('consumeBinaryPointLots(tx')
  const profileUpdateAt = settlement.indexOf('await tx.resellerProfile.update')
  assert.ok(expireAt >= 0 && expireAt < profilesAt)
  assert.ok(createLotAt >= 0 && createLotAt < pairEventAt)
  assert.ok(pairEventAt < consumeAt && consumeAt < profileUpdateAt)
  assert.match(expiry, /ORDER BY generated_at,id/)
  assert.match(expiry, /expires_at>\$\{input\.now\}/)
  assert.match(expiry, /Dated binary point lots do not cover the aggregate carryover/)
})

test('expiry is owner-controlled, PIN-confirmed, audited, and runs daily', () => {
  assert.match(setting, /user\.is_staff !== true/)
  assert.match(setting, /verifyResellerSecurityPin/)
  assert.match(setting, /binary_point_expiry_policy_changed/)
  assert.match(setting, /make_interval\(years=>\$\{years\}\)/)
  assert.match(cron, /CRON_SECRET/)
  assert.match(cron, /MEMBER_BATCH_SIZE = 10_000/)
  assert.match(cron, /binaryPointExpiration\.createMany/)
  assert.match(cron, /pg_advisory_xact_lock\(hashtext\('binary:' \|\| user_id\)\)/)
  assert.ok(vercel.crons.some((item) => item.path === '/api/cron/expire-binary-points'))
})
