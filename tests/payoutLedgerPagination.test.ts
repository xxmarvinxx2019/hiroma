import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const route = readFileSync(new URL('../src/app/api/admin/commission-testing/payout-ledger/route.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../src/app/dashboard/admin/commission-testing/payout-ledger/page.tsx', import.meta.url), 'utf8')

test('payout ledger bounds page size and paginates after all database filters', () => {
  assert.match(route, /Math\.min\(Math\.max\(requestedPageSize,1\),100\)/)
  assert.match(route, /LIMIT \$\{pageSize\} OFFSET \$\{offset\}/)
  assert.doesNotMatch(route, /LIMIT 500/)
})

test('full filtered summary remains separate from the paginated detail query', () => {
  assert.match(route, /COUNT\(\*\)::int payout_count/)
  assert.match(route, /total_count:totalCount/)
  assert.match(route, /total_pages:Math\.max\(1,Math\.ceil\(totalCount\/pageSize\)\)/)
})

test('admin UI exposes record range and bounded previous/next navigation', () => {
  assert.match(page, /page_size=100/)
  assert.match(page, /Showing \{data\.pagination\.total_count/)
  assert.match(page, />\s*Previous\s*</)
  assert.match(page, />\s*Next\s*</)
  assert.match(page, /Page \{data\.pagination\.page\} of \{data\.pagination\.total_pages\}/)
})
