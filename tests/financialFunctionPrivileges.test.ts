import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync(
  new URL('../prisma/migrations/20260813140000_restrict_financial_function_execution/migration.sql', import.meta.url),
  'utf8',
)

const internalFunctions = [
  'allocate_direct_referral_payout',
  'allocate_binary_payout',
  'allocate_product_binary_payout',
  'consume_product_binary_funding',
]

test('all argument-taking financial mutation helpers revoke PUBLIC execution', () => {
  for (const name of internalFunctions) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+\\) FROM PUBLIC;`))
  }
  assert.equal((migration.match(/FROM PUBLIC;/g) ?? []).length, internalFunctions.length)
})

test('hardening changes privileges only, not financial function behavior', () => {
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION|UPDATE |INSERT INTO|DELETE FROM|ALTER TABLE/)
  assert.doesNotMatch(migration, /GRANT .* (anon|authenticated|PUBLIC)/i)
})
