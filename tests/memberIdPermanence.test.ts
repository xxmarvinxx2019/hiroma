import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const generator = readFileSync(new URL('../src/app/lib/memberId.ts', import.meta.url), 'utf8')
const migration = readFileSync(
  new URL('../prisma/migrations/20260901090000_preserve_member_id_sequences/migration.sql', import.meta.url),
  'utf8',
)
const registryMigration = readFileSync(
  new URL('../prisma/migrations/20260902151000_add_member_id_issuance_registry/migration.sql', import.meta.url),
  'utf8',
)
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')

test('member ID allocation does not derive the next sequence from live users', () => {
  assert.doesNotMatch(generator, /SELECT MAX\([\s\S]*FROM users/i)
  assert.match(generator, /INSERT INTO member_id_sequences/i)
  assert.match(generator, /ON CONFLICT \(year\) DO UPDATE/i)
  assert.match(generator, /RETURNING last_sequence AS allocated_sequence/i)
  assert.match(generator, /INSERT INTO member_id_issuances/i)
  assert.match(generator, /runtime_allocation/i)
})

test('member ID sequence ledger is initialized from existing IDs and survives user deletion', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "member_id_sequences"/i)
  assert.match(migration, /MAX\(split_part\("member_id", '-', 3\)::integer\)/i)
  assert.doesNotMatch(migration, /REFERENCES\s+"users"/i)
})

test('immutable issuance tombstones survive deletion and gate every new user ID', () => {
  assert.match(schema, /model MemberIdSequence[\s\S]*@@map\("member_id_sequences"\)/)
  assert.match(schema, /model MemberIdIssuance[\s\S]*@@map\("member_id_issuances"\)/)
  assert.match(registryMigration, /CREATE TABLE "member_id_issuances"/)
  assert.match(registryMigration, /member_id_issuances_append_only/)
  assert.match(registryMigration, /users_require_member_id_issuance/)
  assert.doesNotMatch(registryMigration, /REFERENCES\s+"users"/i)
})

test('cutover recovers deleted-ID evidence and blocks an existing collision', () => {
  assert.match(registryMigration, /FROM "audit_logs"/)
  assert.match(registryMigration, /COUNT\(DISTINCT subject_id\) > 1/)
  assert.match(registryMigration, /Member IDs already associated with multiple accounts require reconciliation/)
  assert.match(registryMigration, /operator_reconciled/)
  assert.match(registryMigration, /GREATEST\([\s\S]*"member_id_sequences"\."last_sequence"/)
})
