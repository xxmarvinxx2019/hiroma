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
  assert.match(queue, /migrateLegacyRows\(scope, Boolean\(sameLegacyScope\)\)/)
  assert.match(queue, /!registration\.offline_scope_id && claimUnscoped/)
  assert.match(queue, /!sale\.offline_scope_id && claimUnscoped/)
  assert.match(queue, /localStorage\.getItem\(SEALED_SCOPE_KEY\) !== '1'/)
})

test('offline payloads and bootstrap are encrypted with a non-exportable terminal-scoped key', () => {
  assert.match(queue, /crypto\.subtle\.generateKey\([\s\S]*'AES-GCM'[\s\S]*false,[\s\S]*\['encrypt', 'decrypt'\]/)
  assert.match(queue, /navigator\.locks\.request/)
  assert.match(queue, /encrypted_payload: await encryptOfflineValue/)
  assert.match(queue, /protectedBootstrap = await encryptOfflineValue/)
  assert.match(queue, /crypto\.subtle\.decrypt/)
  assert.doesNotMatch(queue, /store\.put\(\{ \.\.\.sale, offline_scope_id:/)
  assert.doesNotMatch(queue, /store\.put\(\{ \.\.\.row, offline_scope_id:/)
})
