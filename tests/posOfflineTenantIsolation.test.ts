import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const queue = readFileSync('src/app/lib/posOfflineQueue.ts', 'utf8')
const pos = readFileSync('src/app/dashboard/city/pos/page.tsx', 'utf8')
const registration = readFileSync('src/app/dashboard/city/pos/new-registration/page.tsx', 'utf8')
const cityLayout = readFileSync('src/app/dashboard/city/layout.tsx', 'utf8')
const autoLogout = readFileSync('src/app/hooks/useAutoLogout.ts', 'utf8')
const login = readFileSync('src/app/login/page.tsx', 'utf8')

test('offline queues and bootstrap cache are owner-and-terminal scoped', () => {
  assert.match(queue, /offline_scope_id: posOfflineScopeId\(scope\)/)
  assert.match(queue, /filterQueuedRecordsForScope\(rows, scope\)/)
  assert.match(queue, /if \(!row \|\| !queuedRecordBelongsToScope\(row, scope\)\) return/)
  assert.match(queue, /`bootstrap:\$\{posOfflineScopeId\(scope\)\}`/)
  assert.doesNotMatch(registration, /hiroma_pos_bootstrap/)
  assert.doesNotMatch(pos, /setData\(\(current\) => current \|\| cached\)/)
})

test('account transitions seal the active offline scope without deleting durable records', () => {
  assert.match(queue, /localStorage\.removeItem\(ACTIVE_SCOPE_KEY\)/)
  assert.match(queue, /localStorage\.setItem\(SEALED_SCOPE_KEY, '1'\)/)
  assert.doesNotMatch(queue, /deleteDatabase/)
  assert.match(cityLayout, /sealPosOfflineScope\(\);\s*await fetch\("\/api\/auth\/logout"/)
  assert.match(autoLogout, /sealPosOfflineScope\(\)/)
  assert.ok((login.match(/sealPosOfflineScope\(\)/g) || []).length >= 3)
})

test('legacy records are claimed only when the cached bootstrap matches the authenticated scope', () => {
  assert.match(queue, /sameLegacyScope/)
  assert.match(queue, /if \(sameLegacyScope\) await migrateLegacyRows\(scope\)/)
  assert.match(queue, /localStorage\.getItem\(SEALED_SCOPE_KEY\) !== '1'/)
})
