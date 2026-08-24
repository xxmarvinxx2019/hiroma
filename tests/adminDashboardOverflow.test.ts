import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('admin dashboard exposes audited all-time retained overflow', () => {
  const route = read('src/app/api/admin/stats/route.ts')
  const page = read('src/app/dashboard/admin/page.tsx')

  assert.match(route, /where:\s*\{\s*is_pair_overflow:\s*true\s*\}/)
  assert.match(route, /retainedOverflow\s*=\s*Number\(retainedOverflowRaw\._sum\.amount/)
  assert.match(route, /retainedOverflowEvents\s*=\s*retainedOverflowRaw\._count\.id/)
  assert.match(page, /label="Retained Overflow"/)
  assert.match(page, /commission-testing\/flushout-report/)
  assert.match(page, /all-time audited events/)
})
