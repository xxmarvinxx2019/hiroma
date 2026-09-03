import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

test('reseller APIs do not expose payable or flash-out accounting counters', () => {
  for (const path of [
    'src/app/api/reseller/stats/route.ts',
    'src/app/api/reseller/tree/route.ts',
  ]) {
    const route = read(path)
    assert.doesNotMatch(route, /lifetime_payable/)
    assert.doesNotMatch(route, /lifetime_flashout/)
    assert.match(route, /lifetime_pairs/)
  }
})

test('reseller client types contain only approved Product Binary summary fields', () => {
  for (const path of [
    'src/app/dashboard/reseller/page.tsx',
    'src/app/dashboard/reseller/tree/page.tsx',
  ]) {
    const page = read(path)
    assert.doesNotMatch(page, /lifetime_payable/)
    assert.doesNotMatch(page, /lifetime_flashout/)
    assert.match(page, /lifetime_pairs/)
  }
})

test('server-side Product Binary accounting still records payable and flash-out totals', () => {
  const engine = read('src/app/lib/productBinary.ts')
  assert.match(
    engine,
    /closingLifetimePayable = openingLifetimePayable \+ payablePairs/,
  )
  assert.match(
    engine,
    /closingLifetimeFlashout = openingLifetimeFlashout \+ capFlashPairs \+ inactivePairs/,
  )
  assert.match(engine, /lifetime_payable=\$\{closingLifetimePayable\}/)
  assert.match(engine, /lifetime_flashout=\$\{closingLifetimeFlashout\}/)
})
