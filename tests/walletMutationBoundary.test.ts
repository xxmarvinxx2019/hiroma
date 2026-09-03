import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const entry = path.join(directory, name)
    if (statSync(entry).isDirectory()) return sourceFiles(entry)
    return /\.(?:ts|tsx)$/.test(name) ? [entry] : []
  })
}

test('application code cannot mutate wallet balances outside the ledger boundary', () => {
  let zeroBalanceInitializations = 0

  for (const file of sourceFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8')
    const label = path.relative(sourceRoot, file)

    assert.doesNotMatch(
      source,
      /\.wallet\.(?:update|upsert|delete|updateMany|createMany|deleteMany)\s*\(/,
      `${label} directly mutates a wallet instead of appending a ledger event`,
    )
    assert.doesNotMatch(
      source,
      /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?wallets"?/i,
      `${label} contains a raw wallet-table mutation`,
    )

    for (const match of source.matchAll(/\.wallet\.create\s*\(/g)) {
      zeroBalanceInitializations += 1
      const initialization = source.slice(match.index, match.index + 500)
      assert.match(initialization, /\bbalance:\s*0\b/, `${label} wallet creation must start with zero balance`)
      assert.match(initialization, /\btotal_earned:\s*0\b/, `${label} wallet creation must start with zero earnings`)
      assert.match(initialization, /\btotal_withdrawn:\s*0\b/, `${label} wallet creation must start with zero withdrawals`)
      assert.doesNotMatch(initialization, /\b(?:increment|decrement)\s*:/, `${label} wallet creation cannot embed a balance delta`)
    }
  }

  assert.equal(zeroBalanceInitializations, 2, 'Only the two active account-creation flows initialize empty wallets')
})

test('only the canonical commission helper can insert commission records', () => {
  const canonicalWriter = path.normalize('app/lib/commissionCredit.ts')
  let canonicalInsertCount = 0

  for (const file of sourceFiles(sourceRoot)) {
    const source = readFileSync(file, 'utf8')
    const label = path.normalize(path.relative(sourceRoot, file))
    const rawMutation = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?commissions"?/i

    if (label === canonicalWriter) {
      canonicalInsertCount += source.match(/INSERT\s+INTO\s+"commissions"/gi)?.length ?? 0
      assert.doesNotMatch(source, /\.commission\.(?:create|createMany|update|upsert|delete|updateMany|deleteMany)\s*\(/)
      assert.doesNotMatch(source, /\b(?:UPDATE|DELETE\s+FROM)\s+"?commissions"?/i)
      continue
    }

    assert.doesNotMatch(
      source,
      /\.commission\.(?:create|createMany|update|upsert|delete|updateMany|deleteMany)\s*\(/,
      `${label} writes commissions directly instead of using commissionCredit.ts`,
    )
    assert.doesNotMatch(
      source,
      rawMutation,
      `${label} contains a raw commission-table mutation outside commissionCredit.ts`,
    )
  }

  assert.equal(canonicalInsertCount, 1, 'commissionCredit.ts must remain the single commission insertion boundary')
})
